import { describe, expect, it } from 'vitest';
import { buildEligibility, preventsSamePrize } from './eligibility';
import type { List, ListEntry, Prize, Winner } from '$lib/types';

function entry(id: string, data: Record<string, string> = {}): ListEntry {
  return { id, data };
}

function list(listId: string, entries: ListEntry[], settings?: Partial<List['metadata']>): List {
  return {
    listId,
    entries,
    metadata: {
      listId,
      name: listId,
      timestamp: 0,
      entryCount: entries.length,
      ...settings
    }
  };
}

const prize: Prize = { prizeId: 'p1', name: 'Bicycle', quantity: 5, description: '', timestamp: 0 };

function winner(entryId: string, prizeName: string, listId = 'a'): Winner {
  return {
    winnerId: `w-${entryId}`,
    entryId,
    displayName: entryId,
    prize: prizeName,
    timestamp: 0,
    listId,
    listName: listId,
    historyId: 'h1',
    pickedUp: false,
    pickupTimestamp: null,
    position: 1,
    data: {}
  };
}

describe('buildEligibility', () => {
  it('counts every entry when nothing excludes anything', () => {
    const result = buildEligibility([list('a', [entry('1'), entry('2')])], undefined, [], false);
    expect(result.candidates).toHaveLength(2);
    expect(result.excluded).toBe(0);
  });

  it('collapses the same person appearing in two selected lists', () => {
    const result = buildEligibility(
      [list('a', [entry('1'), entry('2')]), list('b', [entry('2'), entry('3')])],
      undefined,
      [],
      false
    );
    expect(result.candidates.map((candidate) => candidate.entry.id)).toEqual(['1', '2', '3']);
    expect(result.excluded).toBe(1);
  });

  it('keeps every entry that has no id, because nothing can be matched against it', () => {
    const result = buildEligibility([list('a', [entry(''), entry('')])], undefined, [], false);
    expect(result.candidates).toHaveLength(2);
    expect(result.excluded).toBe(0);
  });

  it('excludes people who already won this prize when the global rule is on', () => {
    const result = buildEligibility(
      [list('a', [entry('1'), entry('2')])],
      prize,
      [winner('1', 'Bicycle')],
      true
    );
    expect(result.candidates.map((candidate) => candidate.entry.id)).toEqual(['2']);
    expect(result.excluded).toBe(1);
  });

  it('ignores winners of a different prize', () => {
    const result = buildEligibility([list('a', [entry('1')])], prize, [winner('1', 'Scooter')], true);
    expect(result.candidates).toHaveLength(1);
  });

  it('applies the rule per list, so a list that keeps its winners enforces it on its own', () => {
    // This is the flag that used to be written and never read: a list configured to keep its
    // winners could hand the same person the same prize over and over.
    const keepsWinners = list('a', [entry('1')], {
      listSettings: { removeWinnersFromList: false, preventWinningSamePrize: true }
    });
    const result = buildEligibility([keepsWinners], prize, [winner('1', 'Bicycle')], false);
    expect(result.candidates).toHaveLength(0);
    expect(result.excluded).toBe(1);
  });

  it('records where each candidate came from without touching the entry', () => {
    const source = entry('1');
    const result = buildEligibility([list('a', [source], { nameConfig: '{x}' })], undefined, [], false);
    expect(result.candidates[0]?.listId).toBe('a');
    expect(result.candidates[0]?.nameConfig).toBe('{x}');
    expect(source).toEqual({ id: '1', data: {} });
  });
});

describe('preventsSamePrize', () => {
  it('is false for a list with no settings at all', () => {
    expect(preventsSamePrize(list('a', []))).toBe(false);
  });

  it('is always true for a list that keeps its winners', () => {
    expect(
      preventsSamePrize(
        list('a', [], { listSettings: { removeWinnersFromList: false, preventWinningSamePrize: false } })
      )
    ).toBe(true);
  });

  it('honours the flag for a list that removes its winners', () => {
    expect(
      preventsSamePrize(
        list('a', [], { listSettings: { removeWinnersFromList: true, preventWinningSamePrize: true } })
      )
    ).toBe(true);
    expect(
      preventsSamePrize(
        list('a', [], { listSettings: { removeWinnersFromList: true, preventWinningSamePrize: false } })
      )
    ).toBe(false);
  });
});
