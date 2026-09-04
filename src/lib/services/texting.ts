/**
 * Sending SMS to the winners of the draw currently on screen.
 *
 * Three things this fixes over src/js/modules/texting.js:
 *
 *  1. **The sends are awaited.** The old code fired every request without awaiting it and
 *     reported "dispatched: N" from a counter it incremented before the network was touched, so
 *     a gateway outage looked like a clean run.
 *  2. **One batch write, not one per winner.** `data/winners.json` has no locking — each
 *     `POST /api/winners` reads the whole array and writes it back — so N concurrent per-winner
 *     writes silently lost most of their own updates. Statuses go out in a single batch.
 *  3. **A winner with no phone number is a reported failure, not a silent omission.** The old
 *     path filtered them out before building the recipient list *and* pushed a failure for them
 *     from a branch that could therefore never run.
 */

import * as api from '$lib/api/client';
import { data } from '$lib/state/data.svelte';
import { draw } from '$lib/state/draw.svelte';
import { toasts } from '$lib/state/toasts.svelte';
import { ui } from '$lib/state/ui.svelte';
import type { BatchSaveOperation, SmsInfo, SmsSendResults, SmsStatus, Winner } from '$lib/types';

/**
 * Where a phone number can live on an imported row, in priority order.
 *
 * CSV imports camelise their headers and Ministry Platform imports do not, which is why both
 * casings are here. Preserved exactly from the old module: reordering this changes which number
 * a real person receives a message on.
 */
const PHONE_FIELDS = [
  'phoneNumber',
  'phone',
  'mobile',
  'mobilePhone',
  'cellPhone',
  'cell',
  'telephone',
  'Phone',
  'Mobile',
  'MobilePhone',
  'CellPhone'
] as const;

/** 20 ms between requests — at most 50 a second, which is what the gateway accepts. */
const SEND_INTERVAL_MS = 20;

const PLACEHOLDER = /\{([^}]+)\}/g;

const SMS_STATUSES: ReadonlySet<string> = new Set<SmsStatus>([
  'pending',
  'sending',
  'queued',
  'sent',
  'delivered',
  'bounced',
  'failed',
  'cancelled',
  'unknown'
]);

/** Guards against a second send while one is in flight — a double-tap must not double-text. */
let sending = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** The first non-empty phone field on a winner's row, or `null` when they have none. */
export function findPhoneNumber(winner: Winner): string | null {
  for (const field of PHONE_FIELDS) {
    const value = winner.data[field];
    if (value && value.trim()) return value;
  }
  return null;
}

/** Digits only, with a US country code added when exactly ten digits remain. */
export function cleanPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `1${digits}` : digits;
}

function firstNameOf(winner: Winner, displayName: string): string {
  // A real first-name column wins over splitting the display name. The old code never looked:
  // `{firstName}` always resolved to the whole display name, so "Hi Jane Abernathy," went out
  // wherever a template meant to be friendly.
  const explicit = winner.data['firstName'] ?? winner.data['first_name'] ?? winner.data['First Name'];
  if (explicit && explicit.trim()) return explicit.trim();

  return displayName.trim().split(/\s+/)[0] || 'Winner';
}

/**
 * Fill a template's placeholders.
 *
 * The four documented ones first, then any remaining `{key}` from the winner's own row. A
 * placeholder that resolves to nothing is left standing rather than deleted — a visible
 * `{orderId}` in a test message is a bug report; a silently missing one is not.
 */
export function personaliseMessage(template: string, winner: Winner): string {
  const displayName = winner.displayName || 'Winner';

  const explicit: Record<string, string> = {
    name: displayName,
    firstName: firstNameOf(winner, displayName),
    prize: winner.prize || 'your prize',
    ticketCode: winner.data['ticketCode'] || winner.entryId || winner.winnerId
  };

  return template.replace(PLACEHOLDER, (match: string, rawKey: string) => {
    const key = rawKey.trim();
    return explicit[key] ?? winner.data[key] ?? match;
  });
}

/** The prize's own template when it has one, otherwise the default. */
function messageTemplateFor(winner: Winner): string | null {
  // `winner.prize` is the prize *name*, not its id — that is what the record has always stored.
  const prize = data.prizes.find((candidate) => candidate.name === winner.prize);

  if (prize?.templateId) {
    const specific = data.templateById(prize.templateId);
    if (specific?.message) return specific.message;
  }

  return data.defaultTemplate?.message ?? null;
}

function toSmsStatus(value: string): SmsStatus {
  return SMS_STATUSES.has(value) ? (value as SmsStatus) : 'queued';
}

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------

/**
 * Text every winner of the draw on screen.
 *
 * Returns `null` when the send was refused before it began — the caller shows no results dialog
 * in that case, because the toast already said why.
 */
export async function sendSmsToWinners(winners: Winner[]): Promise<SmsSendResults | null> {
  if (sending) {
    toasts.warning('Messages are already being sent. Please wait…');
    return null;
  }
  if (winners.length === 0) {
    toasts.warning('There are no current winners to send messages to.');
    return null;
  }
  if (data.templates.length === 0) {
    toasts.warning('No SMS templates found. Please create a template in the Templates tab.');
    return null;
  }

  sending = true;

  const results: SmsSendResults = { total: winners.length, sent: 0, successful: [], failed: [] };
  /** One `sms` sub-object per winner, written to the server in a single batch at the end. */
  const statuses = new Map<string, SmsInfo>();

  try {
    await ui.withProgress('Sending messages', `Sending 1 of ${winners.length}…`, async (report) => {
      for (const [index, winner] of winners.entries()) {
        report(Math.round((index / winners.length) * 100), `Sending ${index + 1} of ${winners.length}…`);

        const fail = (error: string): void => {
          results.failed.push({ winner, error });
          statuses.set(winner.winnerId, { status: 'failed', sentAt: Date.now(), error });
        };

        const rawPhone = findPhoneNumber(winner);
        const phone = rawPhone ? cleanPhoneNumber(rawPhone) : '';
        if (!phone) {
          fail('No phone number');
          continue;
        }

        const template = messageTemplateFor(winner);
        if (!template) {
          fail('No SMS template for this prize');
          continue;
        }

        try {
          const job = await api.sendQueuedText(winner.winnerId, phone, personaliseMessage(template, winner));
          // The endpoint answers 200 with an `error` field when the gateway itself refused, so
          // a successful HTTP response is not on its own a successful send.
          if (job.error) throw new Error(job.error);

          results.sent++;
          results.successful.push({ winner, phone });
          statuses.set(winner.winnerId, {
            status: toSmsStatus(job.status),
            messageId: job.messageId,
            sentAt: Date.now()
          });
        } catch (error) {
          fail(error instanceof Error && error.message ? error.message : 'Send failed');
        }

        if (index < winners.length - 1) await sleep(SEND_INTERVAL_MS);
      }

      // Before the write, and before anything can throw: these messages cannot be recalled, so
      // the draw must stop offering undo the moment one of them has actually gone out.
      if (results.sent > 0) draw.markSmsSent(results.sent);

      report(100, 'Saving statuses…');
      try {
        await persistStatuses(winners, statuses);
      } catch (error) {
        // The messages are already sent; failing to record that is bad, but it is not a reason
        // to tell the operator the send failed.
        toasts.fromError(error, 'Messages were sent, but their status could not be saved.');
      }
    });
  } finally {
    sending = false;
  }

  return results;
}

/** Write every winner's `sms` sub-object in one batch, then mirror it into the local store. */
async function persistStatuses(winners: Winner[], statuses: Map<string, SmsInfo>): Promise<void> {
  const operations: BatchSaveOperation[] = [];
  const written: Array<[string, SmsInfo]> = [];

  for (const winner of winners) {
    const sms = statuses.get(winner.winnerId);
    if (!sms) continue;

    // `POST /api/winners` REPLACES the stored document, so the whole record has to go out.
    //
    // It is built from the winner handed in — the draw's own copy — and not from
    // `data.winnerById()`, because the store's copies are enriched at load time: `listName`
    // carries an " (Archived)" suffix and `isArchivedList` is bolted on. Writing one of those
    // back would persist both. The delete is the belt to that braces.
    const record: Winner = { ...winner, sms };
    delete record.isArchivedList;

    operations.push({ collection: 'winners', data: record as unknown as Record<string, unknown> });
    written.push([winner.winnerId, sms]);
  }

  if (operations.length === 0) return;

  // One batch, never one request per winner — see the module header.
  await data.commit(operations);

  // Only after the write succeeded, so a failure cannot leave the console showing a status the
  // server does not have.
  for (const [winnerId, sms] of written) data.patchWinner(winnerId, { sms });
}
