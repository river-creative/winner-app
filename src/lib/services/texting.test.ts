import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Winner } from '$lib/types';

/**
 * The SMS path, minus the gateway.
 *
 * A real send cannot be exercised here — it costs money, it cannot be recalled, and it needs a
 * phone number belonging to someone who agreed to receive it. Everything on *this* side of the
 * gateway can be, and that is where the module's history of defects lives: its own header records
 * three incidents, all of which are guarded below.
 *
 * The phone-field precedence in particular is load-bearing. Reordering that list changes which
 * number a real person is texted on, and nothing else in the app would notice.
 */

const sendQueuedText = vi.fn();
const batchSave = vi.fn();
const markSmsSent = vi.fn();
const patchWinner = vi.fn();
const commit = vi.fn();
const warning = vi.fn();

vi.mock('$lib/api/client', () => ({
  sendQueuedText: (...a: unknown[]) => sendQueuedText(...a),
  batchSave: (...a: unknown[]) => batchSave(...a)
}));

vi.mock('$lib/state/draw.svelte', () => ({ draw: { markSmsSent: (n: number) => markSmsSent(n) } }));

vi.mock('$lib/state/toasts.svelte', () => ({
  toasts: {
    warning: (m: string) => warning(m),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    fromError: vi.fn()
  }
}));

// `withProgress` just runs the body; the progress UI is not what is under test.
vi.mock('$lib/state/ui.svelte', () => ({
  ui: { withProgress: (_t: string, _m: string, fn: (r: () => void) => Promise<void>) => fn(() => {}) }
}));

const templates = [
  {
    templateId: 'tmpl_default',
    name: 'Default',
    message: 'Hi {firstName}, you won {prize}!',
    isDefault: true
  }
];
const prizes: Array<{ prizeId: string; name: string; templateId?: string }> = [];

vi.mock('$lib/state/data.svelte', () => ({
  data: {
    get templates() {
      return templates;
    },
    get prizes() {
      return prizes;
    },
    get defaultTemplate() {
      return templates.find((t) => t.isDefault);
    },
    templateById: (id: string) => templates.find((t) => t.templateId === id),
    patchWinner: (...a: unknown[]) => patchWinner(...a),
    commit: (...a: unknown[]) => commit(...a),
    reportWriteFailure: vi.fn()
  }
}));

const { findPhoneNumber, cleanPhoneNumber, personaliseMessage, sendSmsToWinners } = await import('./texting');

function winner(overrides: Partial<Winner> = {}): Winner {
  return {
    winnerId: 'w1',
    entryId: 'E-1',
    displayName: 'Jane Abernathy',
    prize: 'A Bike',
    timestamp: 1,
    listId: 'l1',
    listName: 'List',
    historyId: 'h1',
    pickedUp: false,
    pickupTimestamp: null,
    position: 1,
    data: { mobilePhone: '813-555-0142', firstName: 'Jane' },
    ...overrides
  } as Winner;
}

beforeEach(() => {
  vi.clearAllMocks();
  batchSave.mockResolvedValue({ results: [], writeResults: {} });
  commit.mockResolvedValue({ results: [], writeResults: {} });
});

describe('findPhoneNumber', () => {
  // The order of PHONE_FIELDS decides which number a real person receives a message on.
  it('prefers phoneNumber over every other spelling', () => {
    const w = winner({ data: { phoneNumber: '111', phone: '222', mobile: '333', mobilePhone: '444' } });
    expect(findPhoneNumber(w)).toBe('111');
  });

  it("falls through the list in order, and handles MP's capitalised headers", () => {
    expect(findPhoneNumber(winner({ data: { mobile: '333', mobilePhone: '444' } }))).toBe('333');
    expect(findPhoneNumber(winner({ data: { MobilePhone: '555' } }))).toBe('555');
  });

  it('treats a blank field as absent rather than as a number', () => {
    expect(findPhoneNumber(winner({ data: { phoneNumber: '   ', phone: '222' } }))).toBe('222');
    expect(findPhoneNumber(winner({ data: {} }))).toBeNull();
  });
});

describe('cleanPhoneNumber', () => {
  it('strips formatting and adds the country code to a ten-digit number', () => {
    expect(cleanPhoneNumber('(813) 555-0142')).toBe('18135550142');
  });

  it('leaves an already-prefixed number alone', () => {
    expect(cleanPhoneNumber('1-813-555-0142')).toBe('18135550142');
  });

  it('does not invent a country code for something that is not ten digits', () => {
    expect(cleanPhoneNumber('555-0142')).toBe('5550142');
  });
});

describe('personaliseMessage', () => {
  it('fills the four documented placeholders', () => {
    const out = personaliseMessage('{name} / {firstName} / {prize} / {ticketCode}', winner());
    expect(out).toBe('Jane Abernathy / Jane / A Bike / E-1');
  });

  // The old code resolved {firstName} to the whole display name, so "Hi Jane Abernathy," went out
  // wherever a template meant to be friendly.
  it('prefers a real first-name column over splitting the display name', () => {
    expect(personaliseMessage('{firstName}', winner({ data: { firstName: 'Janey' } }))).toBe('Janey');
    expect(personaliseMessage('{firstName}', winner({ data: {} }))).toBe('Jane');
  });

  it("resolves any other placeholder from the winner's own row", () => {
    expect(personaliseMessage('{orderId}', winner({ data: { orderId: 'ORD-9' } }))).toBe('ORD-9');
  });

  // A visible {orderId} in a message is a bug report; a silently deleted one is not.
  it('leaves an unresolvable placeholder standing', () => {
    expect(personaliseMessage('code {nope}', winner({ data: {} }))).toBe('code {nope}');
  });
});

describe('sendSmsToWinners', () => {
  it('refuses with nothing to send to, and says so', async () => {
    expect(await sendSmsToWinners([])).toBeNull();
    expect(warning).toHaveBeenCalled();
    expect(sendQueuedText).not.toHaveBeenCalled();
  });

  it('sends one message per winner and reports the count', async () => {
    sendQueuedText.mockResolvedValue({ status: 'queued', messageId: 'm1' });
    const results = await sendSmsToWinners([winner(), winner({ winnerId: 'w2', entryId: 'E-2' })]);

    expect(sendQueuedText).toHaveBeenCalledTimes(2);
    expect(results?.sent).toBe(2);
    expect(results?.failed).toHaveLength(0);
    expect(sendQueuedText.mock.calls[0]?.[1]).toBe('18135550142');
    expect(sendQueuedText.mock.calls[0]?.[2]).toBe('Hi Jane, you won A Bike!');
  });

  // The old path filtered these out before building the recipient list, so the operator was never
  // told that someone had been skipped.
  it('reports a winner with no phone as a failure rather than omitting them', async () => {
    sendQueuedText.mockResolvedValue({ status: 'queued', messageId: 'm1' });
    const results = await sendSmsToWinners([winner({ data: {} })]);

    expect(sendQueuedText).not.toHaveBeenCalled();
    expect(results?.sent).toBe(0);
    expect(results?.failed).toEqual([expect.objectContaining({ error: 'No phone number' })]);
  });

  // The endpoint answers 200 with an `error` field when the gateway itself refused, so a
  // successful HTTP response is not on its own a successful send.
  it('treats a 200 carrying an error as a failed send', async () => {
    sendQueuedText.mockResolvedValue({ error: 'gateway refused' });
    const results = await sendSmsToWinners([winner()]);

    expect(results?.sent).toBe(0);
    expect(results?.failed[0]?.error).toBe('gateway refused');
  });

  // Undo must stop being offered the moment a message has actually gone out — it cannot be recalled.
  it('marks the draw un-undoable only when something was actually sent', async () => {
    sendQueuedText.mockResolvedValue({ status: 'sent', messageId: 'm1' });
    await sendSmsToWinners([winner()]);
    expect(markSmsSent).toHaveBeenCalledWith(1);

    vi.clearAllMocks();
    commit.mockResolvedValue({ results: [], writeResults: {} });
    await sendSmsToWinners([winner({ data: {} })]);
    expect(markSmsSent).not.toHaveBeenCalled();
  });

  // data/winners.json has no locking: N per-winner writes each read the whole array and write it
  // back, so most of them are lost. Statuses have to go out together.
  it('writes every status in a single batch, not one call per winner', async () => {
    sendQueuedText.mockResolvedValue({ status: 'queued', messageId: 'm1' });
    await sendSmsToWinners([winner(), winner({ winnerId: 'w2', entryId: 'E-2' })]);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[0]).toHaveLength(2);
  });
});
