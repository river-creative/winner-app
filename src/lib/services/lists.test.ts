import { describe, expect, it } from 'vitest';
import { listAsImportSource, skipsExistingWinners, syncExclusionIds } from './lists';
import type { List, ListEntry, Winner } from '$lib/types';

function entry(id: string, data: Record<string, string> = {}): ListEntry {
  return { id, index: 0, data };
}

function list(listId: string, entries: ListEntry[], metadata?: Partial<List['metadata']>): List {
  return {
    listId,
    entries,
    metadata: {
      listId,
      name: listId,
      timestamp: 0,
      entryCount: entries.length,
      ...metadata
    }
  };
}

function winner(entryId: string, listId: string, winnerId = `w-${entryId}`): Winner {
  return {
    winnerId,
    entryId,
    displayName: entryId,
    prize: 'Bicycle',
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

/**
 * The setting is stored per list; the global one is only the default a new list starts from.
 * Resolving that in one place is what stops the wizard showing a value the sync does not apply.
 */
describe('skipsExistingWinners', () => {
  it('uses the list’s own value, in both directions, whatever the global says', () => {
    const on = list('a', [], {
      listSettings: {
        removeWinnersFromList: true,
        preventWinningSamePrize: false,
        skipExistingWinners: true
      }
    });
    const off = list('b', [], {
      listSettings: {
        removeWinnersFromList: true,
        preventWinningSamePrize: false,
        skipExistingWinners: false
      }
    });

    expect(skipsExistingWinners(on, false)).toBe(true);
    expect(skipsExistingWinners(off, true)).toBe(false);
  });

  // A list imported before this became per-list has no value of its own. Blanking it to false
  // would quietly change what its next sync does.
  it('falls back to the global default when the list predates the setting', () => {
    const legacy = list('a', [], {
      listSettings: { removeWinnersFromList: true, preventWinningSamePrize: false }
    });

    expect(skipsExistingWinners(legacy, true)).toBe(true);
    expect(skipsExistingWinners(legacy, false)).toBe(false);
  });

  it('falls back for a list with no listSettings at all', () => {
    expect(skipsExistingWinners(list('a', []), true)).toBe(true);
  });
});

/**
 * The two exclusions answer different questions: one is about this list's own draws, the other
 * about every draw there has ever been.
 */
describe('syncExclusionIds', () => {
  const winners = [winner('mine', 'a'), winner('theirs', 'b')];

  it('excludes nothing when neither rule applies', () => {
    const ids = syncExclusionIds('a', winners, {
      excludeWinnersOfThisList: false,
      excludeAllWinners: false
    });
    expect([...ids]).toEqual([]);
  });

  it('excludes only this list’s winners when that is the only rule', () => {
    const ids = syncExclusionIds('a', winners, {
      excludeWinnersOfThisList: true,
      excludeAllWinners: false
    });
    expect(ids.has('mine')).toBe(true);
    expect(ids.has('theirs')).toBe(false);
  });

  // The point of making the setting mean something after import: a winner from a *different*
  // list is kept out too, which the this-list rule alone never did.
  it('excludes winners from every list when skipExistingWinners is on', () => {
    const ids = syncExclusionIds('a', winners, {
      excludeWinnersOfThisList: false,
      excludeAllWinners: true
    });
    expect(ids.has('mine')).toBe(true);
    expect(ids.has('theirs')).toBe(true);
  });

  // Older winner records used the winner id itself as the record id, which is why the import
  // filter collects both. Sync has to match, or the same person is treated differently by the
  // two paths that add records to a list.
  it('also excludes the legacy winnerId form when skipping all winners', () => {
    const ids = syncExclusionIds('a', [winner('someone', 'b', 'legacy-id')], {
      excludeWinnersOfThisList: false,
      excludeAllWinners: true
    });
    expect(ids.has('legacy-id')).toBe(true);
  });

  it('is not confused by a winner with no entryId', () => {
    const anonymous: Winner = { ...winner('x', 'a'), entryId: '' };
    const ids = syncExclusionIds('a', [anonymous], {
      excludeWinnersOfThisList: true,
      excludeAllWinners: false
    });
    expect(ids.size).toBe(0);
  });
});

/** What the wizard is handed when the gear on a list card opens it. */
describe('listAsImportSource', () => {
  it('takes the union of the entries’ fields, so a sparse first entry hides nothing', () => {
    const source = listAsImportSource(
      list('a', [entry('1', { firstName: 'Ada' }), entry('2', { firstName: 'Alan', phone: '555' })])
    );

    expect(source.headers).toEqual(['firstName', 'phone']);
    expect(source.rows).toHaveLength(2);
  });

  it('carries the list’s name and provenance through', () => {
    const source = listAsImportSource(
      list('a', [entry('1', { id: '1' })], { name: 'Volunteers', originalFilename: 'vols.csv' })
    );

    expect(source.listName).toBe('Volunteers');
    expect(source.fileName).toBe('vols.csv');
    expect(source.mpSource).toBeNull();
  });

  it('survives a list with no entries rather than throwing', () => {
    const source = listAsImportSource(list('a', []));

    expect(source.headers).toEqual([]);
    expect(source.rows).toEqual([]);
  });
});
