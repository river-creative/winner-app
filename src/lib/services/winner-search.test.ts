import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Winner } from '$lib/types';

// The family fallback is the only part of this module that reaches the network. Mocked so the
// rest can be tested as the pure lookup it is, and so the fallback's own contract is explicit.
const mpFindFamilyMembers = vi.fn<(idCard: string) => Promise<{ familyIdCards?: string[] }>>();
vi.mock('$lib/api/client', () => ({
  mpFindFamilyMembers: (idCard: string) => mpFindFamilyMembers(idCard)
}));

const { findByName, findByTicketCode, isMPIdCard, isTicketCode, search } = await import('./winner-search');

function winner(overrides: Partial<Winner> & { entryId: string; displayName: string }): Winner {
  return {
    winnerId: `w-${overrides.entryId}-${overrides.prize ?? 'x'}`,
    prize: 'Bicycle',
    timestamp: 0,
    listId: 'l1',
    listName: 'Main',
    historyId: 'h1',
    pickedUp: false,
    pickupTimestamp: null,
    position: 1,
    data: {},
    ...overrides
  };
}

beforeEach(() => {
  mpFindFamilyMembers.mockReset();
  mpFindFamilyMembers.mockResolvedValue({ familyIdCards: [] });
});

describe('isTicketCode', () => {
  it('accepts both formats in circulation', () => {
    expect(isTicketCode('HWFXaOUlVT')).toBe(true); // generated entry id
    expect(isTicketCode('A-369008')).toBe(true); // Ministry Platform id card
  });

  it('rejects anything too short or containing punctuation', () => {
    expect(isTicketCode('short')).toBe(false);
    expect(isTicketCode('has space')).toBe(false);
    expect(isTicketCode('')).toBe(false);
  });

  /**
   * The reason `search` cannot stop at a missed code: plenty of surnames satisfy the
   * 8-24 alphanumeric rule, so "looks like a code" is not "is a code".
   */
  it('also matches ordinary surnames, which is why the fall-through exists', () => {
    expect(isTicketCode('Whitmore')).toBe(true);
    expect(isTicketCode('Delacroix')).toBe(true);
    // Only from 8 characters, so a short surname was never mistaken for a code.
    expect(isTicketCode('Okonkwo')).toBe(false);
  });

  it('distinguishes the MP shape, which alone gets the household fallback', () => {
    expect(isMPIdCard('A-369008')).toBe(true);
    expect(isMPIdCard('HWFXaOUlVT')).toBe(false);
    expect(isMPIdCard('Whitmore')).toBe(false);
  });
});

describe('findByTicketCode', () => {
  it('returns the person and every prize under that code', async () => {
    const winners = [
      winner({ entryId: 'A-369008', displayName: 'Ada Lovelace', prize: 'Bicycle' }),
      winner({ entryId: 'A-369008', displayName: 'Ada Lovelace', prize: 'Kettle' })
    ];

    const result = await findByTicketCode('A-369008', winners);
    expect(result?.kind).toBe('person');
    if (result?.kind !== 'person') throw new Error('expected a person result');
    expect(result.person.winner.displayName).toBe('Ada Lovelace');
    expect(result.person.prizes).toHaveLength(2);
    expect(result.person.prizeCount).toBe(2);
  });

  it('shows only the first person when one code carries two names', async () => {
    const winners = [
      winner({ entryId: 'A-369008', displayName: 'Ada Lovelace' }),
      winner({ entryId: 'A-369008', displayName: 'Grace Hopper' })
    ];

    const result = await findByTicketCode('A-369008', winners);
    if (result?.kind !== 'person') throw new Error('expected a person result');
    expect(result.person.winner.displayName).toBe('Ada Lovelace');
    expect(result.person.prizes).toHaveLength(1);
  });

  it('falls back to the household for an MP card with no direct win', async () => {
    mpFindFamilyMembers.mockResolvedValue({ familyIdCards: ['A-111111'] });
    const winners = [winner({ entryId: 'A-111111', displayName: 'Grace Hopper' })];

    const result = await findByTicketCode('A-369008', winners);
    expect(result?.kind).toBe('family');
    if (result?.kind !== 'family') throw new Error('expected a family result');
    expect(result.scannedIdCard).toBe('A-369008');
    expect(result.people).toHaveLength(1);
  });

  it('matches a household member on the raw idCard field as well as the entry id', async () => {
    mpFindFamilyMembers.mockResolvedValue({ familyIdCards: ['A-111111'] });
    const winners = [
      winner({ entryId: 'generated-id-1', displayName: 'Grace Hopper', data: { idCard: 'A-111111' } })
    ];

    const result = await findByTicketCode('A-369008', winners);
    expect(result?.kind).toBe('family');
  });

  it('never asks Ministry Platform about a generated entry id', async () => {
    await findByTicketCode('HWFXaOUlVT', []);
    expect(mpFindFamilyMembers).not.toHaveBeenCalled();
  });

  it('degrades to "no winner" when Ministry Platform is unreachable', async () => {
    mpFindFamilyMembers.mockRejectedValue(new Error('MP down'));
    // Swallowed on purpose; the console noise is not what is under test.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(findByTicketCode('A-369008', [])).resolves.toBeNull();
  });
});

describe('findByName', () => {
  const winners = [
    winner({ entryId: 'e1', displayName: 'Ada Lovelace', prize: 'Bicycle' }),
    winner({ entryId: 'e1', displayName: 'Ada Lovelace', prize: 'Kettle' }),
    winner({ entryId: 'e2', displayName: 'Grace Hopper' })
  ];

  it('groups one person with several prizes into a single result', () => {
    const people = findByName('ada', winners);
    expect(people).toHaveLength(1);
    expect(people[0]?.prizes).toHaveLength(2);
  });

  it('requires every word of the term to appear, in any order', () => {
    expect(findByName('lovelace ada', winners)).toHaveLength(1);
    expect(findByName('ada hopper', winners)).toHaveLength(0);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(findByName('  GRACE  ', winners)).toHaveLength(1);
  });

  it('returns nothing for an empty term rather than everything', () => {
    expect(findByName('   ', winners)).toHaveLength(0);
  });
});

/**
 * The behaviour a volunteer actually depends on: a surname shaped like a ticket code must not
 * end the search. This is the regression `dbb5e9d` fixed in the old app.
 */
describe('search', () => {
  const winners = [winner({ entryId: 'e1', displayName: 'Marcus Whitmore' })];

  it('falls through from a missed ticket code to a name search', async () => {
    const outcome = await search('Whitmore', winners);
    expect(outcome.kind).toBe('person');
    if (outcome.kind !== 'person') throw new Error('expected a person result');
    expect(outcome.person.winner.displayName).toBe('Marcus Whitmore');
  });

  it('reports "no winner" quoting the code only when both lookups miss', async () => {
    const outcome = await search('ZZZZZZZZ', winners);
    expect(outcome).toEqual({ kind: 'noWinner', ticketCode: 'ZZZZZZZZ' });
  });

  it('prefers an exact code match over a name that happens to contain it', async () => {
    const rows = [
      winner({ entryId: 'Whitmore', displayName: 'Ada Lovelace' }),
      winner({ entryId: 'e9', displayName: 'Marcus Whitmore' })
    ];
    const outcome = await search('Whitmore', rows);
    if (outcome.kind !== 'person') throw new Error('expected a person result');
    expect(outcome.person.winner.displayName).toBe('Ada Lovelace');
  });

  it('returns the picker when a name matches several people', async () => {
    const rows = [
      winner({ entryId: 'e1', displayName: 'Ada Lovelace' }),
      winner({ entryId: 'e2', displayName: 'Ada Byron' })
    ];
    const outcome = await search('ada', rows);
    expect(outcome.kind).toBe('people');
  });

  it('reports an unmatched typed name as noResults, not noWinner', async () => {
    const outcome = await search('nobody here', winners);
    expect(outcome).toEqual({ kind: 'noResults', term: 'nobody here' });
  });
});
