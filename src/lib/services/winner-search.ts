/**
 * Looking a winner up from the pickup desk — by scanned ticket code, or by typed name.
 *
 * Kept free of Svelte and of the camera so it can be reasoned about (and tested) on its own:
 * the caller hands it the winners snapshot it should search, and gets back a discriminated
 * union that maps one-to-one onto the three screens and two dialogs the scanner has.
 */

import * as api from '$lib/api/client';
import type { Winner } from '$lib/types';

/** One prize row of a person's result. Mirrors the fields the pickup screen reads and writes. */
export interface PrizeRecord {
  winnerId: string;
  prize: string;
  timestamp: number;
  pickedUp: boolean;
  /** Epoch milliseconds. Older records hold an ISO string; read through `toEpoch()`. */
  pickupTimestamp: number | string | null;
  pickupStation: string | null;
}

/** One person and every prize they won. Several winner records collapse into one of these. */
export interface PersonResult {
  winner: Winner;
  prizes: PrizeRecord[];
  prizeCount: number;
  pendingCount: number;
}

export type ScanLookup =
  | { kind: 'person'; person: PersonResult }
  /** The scanned card is not a winner, but people in the same MP household are. */
  | { kind: 'family'; scannedIdCard: string; people: PersonResult[] };

export type ScanSearchOutcome =
  | ScanLookup
  /** Several people matched a name search; the operator picks one. */
  | { kind: 'people'; people: PersonResult[] }
  /** A ticket code that matched neither a winner, a household, nor a name. */
  | { kind: 'noWinner'; ticketCode: string }
  /** A name search with nothing to show. */
  | { kind: 'noResults'; term: string };

/**
 * Ticket code formats, both of which are in circulation:
 *   - 8–24 alphanumeric, mixed case (e.g. "HWFXaOUlVT") — generated entry ids
 *   - `[A-Z]-\d{5,7}` (e.g. "A-369008") — Ministry Platform id cards
 */
const ALPHANUMERIC_CODE = /^[a-zA-Z0-9]{8,24}$/;
const MP_ID_CARD = /^[A-Z]-\d{5,7}$/;

export function isTicketCode(input: string): boolean {
  return ALPHANUMERIC_CODE.test(input) || MP_ID_CARD.test(input);
}

/** Only the MP shape gets the household fallback; a generated entry id has no household. */
export function isMPIdCard(input: string): boolean {
  return MP_ID_CARD.test(input);
}

/**
 * Exact `entryId` match, with the Ministry Platform household fallback.
 *
 * This is the path a scan takes. `null` means "no winner and no winning relative", which is
 * what puts the No Winner Found dialog on screen.
 */
export async function findByTicketCode(ticketCode: string, winners: Winner[]): Promise<ScanLookup | null> {
  const matching = winners.filter((winner) => winner.entryId === ticketCode);
  const representative = matching[0];

  if (!representative) {
    // No direct match — try the family fallback, but only for MP id cards.
    if (isMPIdCard(ticketCode)) {
      const people = await findFamilyWinners(ticketCode, winners);
      if (people.length > 0) return { kind: 'family', scannedIdCard: ticketCode, people };
    }
    return null;
  }

  // Two people sharing a ticket code is a data fault, not something to render: show only the
  // first person's prizes rather than mixing two people's into one card.
  const sameName = matching.filter((winner) => winner.displayName === representative.displayName);
  if (sameName.length !== matching.length) {
    console.warn(`Found prizes for different people under one ticket code: ${ticketCode}`);
  }

  return { kind: 'person', person: toPerson(representative, sameName) };
}

/**
 * People in the scanned card's Ministry Platform household who won prizes.
 *
 * A failure here is deliberately swallowed: MP being unreachable must degrade a scan to "no
 * winner found", never break the lookup that already succeeded on the local data.
 */
export async function findFamilyWinners(idCard: string, winners: Winner[]): Promise<PersonResult[]> {
  try {
    const result = await api.mpFindFamilyMembers(idCard);
    const familyIdCards = result.familyIdCards ?? [];
    if (familyIdCards.length === 0) return [];

    const people: PersonResult[] = [];
    for (const familyIdCard of familyIdCards) {
      // MP imports keep the raw field names, so an id card can sit on either of these.
      const matching = winners.filter(
        (winner) => winner.entryId === familyIdCard || winner.data?.['idCard'] === familyIdCard
      );
      const representative = matching[0];
      if (representative) people.push(toPerson(representative, matching));
    }
    return people;
  } catch (error) {
    console.error('Could not look up family members in Ministry Platform:', error);
    return [];
  }
}

/**
 * Case-insensitive name search: every word of the term must appear in the display name.
 *
 * Grouped into unique people (by `entryId`) and sorted by name, because one person with four
 * prizes is four winner records and listing them four times is unusable at a pickup desk.
 */
export function findByName(searchTerm: string, winners: Winner[]): PersonResult[] {
  const words = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const grouped = new Map<string, { representative: Winner; records: Winner[] }>();

  for (const winner of winners) {
    if (!winner.displayName) continue;
    const name = winner.displayName.toLowerCase();
    if (!words.every((word) => name.includes(word))) continue;

    const group = grouped.get(winner.entryId);
    if (group) group.records.push(winner);
    else grouped.set(winner.entryId, { representative: winner, records: [winner] });
  }

  return [...grouped.values()]
    .map(({ representative, records }) => toPerson(representative, records))
    .sort((a, b) => a.winner.displayName.localeCompare(b.winner.displayName));
}

/**
 * What the manual search box does: work out whether the input is a code or a name, and answer
 * with the screen to show.
 *
 * The fall-through from a missed ticket code to a name search is load-bearing. A surname is
 * shaped exactly like a ticket code — "Whitmore", "Okonkwo" and "Delacroix" all satisfy the
 * 8–24 alphanumeric rule — so a typed name used to be looked up as a code, miss, and tell the
 * operator there was no such winner. Only when the name search misses too is it really "no
 * winner", and the answer still quotes what was typed.
 */
export async function search(input: string, winners: Winner[]): Promise<ScanSearchOutcome> {
  if (!isTicketCode(input)) return collapse(findByName(input, winners), input);

  const lookup = await findByTicketCode(input, winners);
  if (lookup) return lookup;

  const byName = findByName(input, winners);
  if (byName.length > 0) return collapse(byName, input);

  return { kind: 'noWinner', ticketCode: input };
}

/** One match opens the person straight away; several need the picker; none needs the dialog. */
function collapse(people: PersonResult[], term: string): ScanSearchOutcome {
  const only = people.length === 1 ? people[0] : undefined;
  if (only) return { kind: 'person', person: only };
  if (people.length === 0) return { kind: 'noResults', term };
  return { kind: 'people', people };
}

/**
 * The two extra identity lines the pickup screens show under a winner's name.
 *
 * These are legacy fields. Draws have never written them — the winner card derives its lines
 * from the source list's `infoConfig` — but records restored from an old backup carry them, and
 * the desk has always shown them where they exist, because a department or a phone number is
 * how a volunteer confirms they are handing the prize to the right person.
 */
export function winnerInfoLines(winner: Winner): { info2: string; info3: string } {
  const record = winner as Winner & { info2?: unknown; info3?: unknown };
  return {
    info2: typeof record.info2 === 'string' ? record.info2 : '',
    info3: typeof record.info3 === 'string' ? record.info3 : ''
  };
}

/** Collapse several winner records for one person into the shape the pickup screens render. */
function toPerson(representative: Winner, records: Winner[]): PersonResult {
  const prizes: PrizeRecord[] = records.map((record) => ({
    winnerId: record.winnerId,
    prize: record.prize,
    timestamp: record.timestamp,
    pickedUp: record.pickedUp || false,
    pickupTimestamp: record.pickupTimestamp || null,
    pickupStation: record.pickupStation || null
  }));

  return {
    winner: representative,
    prizes,
    prizeCount: prizes.length,
    pendingCount: prizes.filter((prize) => !prize.pickedUp).length
  };
}
