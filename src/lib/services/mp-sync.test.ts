import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { List, Winner } from '$lib/types';

/**
 * Importing from Ministry Platform, with MP itself replaced by a stub.
 *
 * A real sync pulls live personal data from a production system on someone else's authority, so
 * it is not something to fire off to see what happens. What it does with the records once it has
 * them is entirely this app's logic, and that is where its bugs have been: the loop this replaced
 * only ever compared against ids the list already held, so one query returning the same person
 * twice imported them twice.
 *
 * `mpExecuteQuery` is the only thing stubbed. Everything below the network is real.
 */

const mpExecuteQuery = vi.fn();
const save = vi.fn();
const winners: Winner[] = [];

vi.mock('$lib/api/client', () => ({
  mpExecuteQuery: (...a: unknown[]) => mpExecuteQuery(...a),
  save: (...a: unknown[]) => save(...a),
  batchSave: vi.fn(async () => ({ results: [], writeResults: {} }))
}));

vi.mock('$lib/state/ui.svelte', () => ({
  ui: { withProgress: (_t: string, _m: string, fn: (r: () => void) => unknown) => fn(() => {}) }
}));

vi.mock('$lib/state/data.svelte', () => ({
  data: {
    get winners() {
      return winners;
    },
    get lists() {
      return [];
    },
    upsertList: vi.fn(),
    reportWriteFailure: vi.fn()
  }
}));

vi.mock('$lib/state/settings.svelte', () => ({
  settings: { current: { skipExistingWinners: false, preventDuplicates: true } }
}));

vi.mock('$lib/state/setup.svelte', () => ({
  setup: { deselectList: vi.fn() },
  removesWinners: (l: List) => l.metadata.listSettings?.removeWinnersFromList !== false
}));

vi.mock('$lib/state/toasts.svelte', () => ({
  toasts: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), fromError: vi.fn() }
}));

const { syncListFromMp, mpRecordToRow, fieldNames, entryIdFor } = await import('./lists');

function list(over: Partial<List['metadata']> = {}, entries: Array<{ id: string }> = []): List {
  return {
    listId: 'L1',
    metadata: {
      listId: 'L1',
      name: 'A list',
      timestamp: 1,
      entryCount: entries.length,
      idConfig: { source: 'column', column: 'idCard' },
      mpSource: { queryId: 'q1', queryName: 'Q', params: {}, importedAt: 1 },
      listSettings: { removeWinnersFromList: true, preventWinningSamePrize: false },
      syncCount: 2,
      lastSyncAt: null,
      ...over
    },
    entries: entries.map((e) => ({ ...e, data: {} }))
  } as unknown as List;
}

beforeEach(() => {
  vi.clearAllMocks();
  winners.length = 0;
  save.mockResolvedValue(undefined);
});

describe('mpRecordToRow', () => {
  // MP returns numbers, nulls and dates; every downstream template does string work on them.
  it('stringifies every value and turns null or undefined into an empty string', () => {
    expect(mpRecordToRow({ contactID: 69935, idCard: 'A-1', middle: null, note: undefined })).toEqual({
      contactID: '69935',
      idCard: 'A-1',
      middle: '',
      note: ''
    });
  });
});

describe('fieldNames', () => {
  // An MP record omits the fields it has no value for, so row 0 is not a reliable column list —
  // a field missing from it would be missing from the wizard's chips and its id select too.
  it('takes the union across rows rather than reading row zero', () => {
    expect(fieldNames([{ a: '1' }, { b: '2' }, { a: '3', c: '4' }])).toEqual(['a', 'b', 'c']);
  });

  it('only samples the first N rows', () => {
    const rows = [{ a: '' }, ...Array.from({ length: 60 }, () => ({ late: '' }))];
    expect(fieldNames(rows, 1)).toEqual(['a']);
  });
});

describe('entryIdFor', () => {
  it('reads the configured column', () => {
    expect(entryIdFor({ idCard: 'A-1' }, { source: 'column', column: 'idCard' })).toBe('A-1');
  });

  it('generates something when the row has no id to use', () => {
    expect(entryIdFor({}, { source: 'auto' })).toBeTruthy();
  });
});

describe('syncListFromMp', () => {
  it('refuses a list that did not come from Ministry Platform', async () => {
    await expect(syncListFromMp(list({ mpSource: null }))).rejects.toThrow(
      /not imported from Ministry Platform/
    );
    expect(mpExecuteQuery).not.toHaveBeenCalled();
  });

  it('appends only records the list does not already hold', async () => {
    mpExecuteQuery.mockResolvedValue([{ idCard: 'a' }, { idCard: 'b' }, { idCard: 'c' }]);
    const result = await syncListFromMp(list({}, [{ id: 'a' }]));

    expect(result.added).toBe(2);
    const saved = save.mock.calls[0]?.[1] as List;
    expect(saved.entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  // The loop this replaced only tested against the ids the list already had, so one query
  // returning the same person twice imported them twice.
  it('does not import a duplicate that appears twice within one response', async () => {
    mpExecuteQuery.mockResolvedValue([{ idCard: 'x' }, { idCard: 'x' }, { idCard: 'y' }]);
    const result = await syncListFromMp(list());

    expect(result.added).toBe(2);
    expect((save.mock.calls[0]?.[1] as List).entries.map((e) => e.id)).toEqual(['x', 'y']);
  });

  it('skips records with a blank or missing id column', async () => {
    mpExecuteQuery.mockResolvedValue([{ idCard: '  ' }, { idCard: null }, {}, { idCard: 'real' }]);
    const result = await syncListFromMp(list());

    expect(result.added).toBe(1);
    expect((save.mock.calls[0]?.[1] as List).entries.map((e) => e.id)).toEqual(['real']);
  });

  // Otherwise every sync hands back exactly the people the draw just took out.
  it('does not re-add someone who won from this list', async () => {
    winners.push({ winnerId: 'w1', entryId: 'gone', listId: 'L1' } as Winner);
    mpExecuteQuery.mockResolvedValue([{ idCard: 'gone' }, { idCard: 'fresh' }]);
    const result = await syncListFromMp(list());

    expect(result.added).toBe(1);
    expect((save.mock.calls[0]?.[1] as List).entries.map((e) => e.id)).toEqual(['fresh']);
  });

  it('still re-adds someone who won from a different list', async () => {
    winners.push({ winnerId: 'w1', entryId: 'other', listId: 'SOMEWHERE_ELSE' } as Winner);
    mpExecuteQuery.mockResolvedValue([{ idCard: 'other' }]);

    expect((await syncListFromMp(list())).added).toBe(1);
  });

  it('carries the whole MP record onto the entry, stringified', async () => {
    mpExecuteQuery.mockResolvedValue([{ idCard: 'a', firstName: 'Jo', contactID: 12, blank: null }]);
    await syncListFromMp(list());

    expect((save.mock.calls[0]?.[1] as List).entries[0]?.data).toEqual({
      idCard: 'a',
      firstName: 'Jo',
      contactID: '12',
      blank: ''
    });
  });

  it('keeps entryCount in step with the entries it wrote', async () => {
    mpExecuteQuery.mockResolvedValue([{ idCard: 'a' }, { idCard: 'b' }]);
    await syncListFromMp(list({}, [{ id: 'z' }]));

    const saved = save.mock.calls[0]?.[1] as List;
    expect(saved.metadata.entryCount).toBe(saved.entries.length);
    expect(saved.metadata.entryCount).toBe(3);
  });

  // "Synced, nothing new" and "never synced" are different states, and the card shows the
  // difference.
  it('bumps lastSyncAt and syncCount even when nothing was added', async () => {
    mpExecuteQuery.mockResolvedValue([]);
    const result = await syncListFromMp(list());

    expect(result.added).toBe(0);
    const saved = save.mock.calls[0]?.[1] as List;
    expect(saved.metadata.syncCount).toBe(3);
    expect(saved.metadata.lastSyncAt).toBeGreaterThan(0);
  });

  it('runs the query the list was imported from, with its own parameters', async () => {
    mpExecuteQuery.mockResolvedValue([]);
    await syncListFromMp(
      list({
        mpSource: { queryId: 'main-event', queryName: 'M', params: { eventId: '71510' }, importedAt: 1 }
      })
    );

    expect(mpExecuteQuery).toHaveBeenCalledWith('main-event', { eventId: '71510' });
  });
});
