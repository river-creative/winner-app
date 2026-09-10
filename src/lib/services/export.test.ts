import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Backup and restore, minus the network.
 *
 * Restore is the most destructive button in the app: it writes over every collection at once.
 * That is exactly why it cannot be exercised against production — and why the logic deciding
 * *what* it writes should not be the only part with no coverage.
 *
 * These assert on the operations handed to `batchSave` rather than on any stored state, so the
 * shape of the write is pinned without anything being written.
 */

const batchSave = vi.fn();
const getAll = vi.fn();
const mpGetQueries = vi.fn();
const mpCreateQuery = vi.fn();
const mpUpdateQuery = vi.fn();

vi.mock('$lib/api/client', () => ({
  batchSave: (...a: unknown[]) => batchSave(...a),
  getAll: (...a: unknown[]) => getAll(...a),
  // MP queries are not a collection — they have their own endpoints, which is exactly why they
  // went missing from every backup before 1.2.
  mpGetQueries: (...a: unknown[]) => mpGetQueries(...a),
  mpCreateQuery: (...a: unknown[]) => mpCreateQuery(...a),
  mpUpdateQuery: (...a: unknown[]) => mpUpdateQuery(...a),
  createBackup: vi.fn(),
  getBackups: vi.fn(),
  getBackup: vi.fn(),
  deleteBackup: vi.fn()
}));

const { buildBackupPayload, restoreBackup } = await import('./export');

const backup = (over: Record<string, unknown> = {}) => ({
  version: '2.0.0',
  lists: [],
  prizes: [],
  winners: [],
  history: [],
  templates: [],
  archive: [],
  settings: {},
  ...over
});

const list = (over: Record<string, unknown> = {}) => ({
  listId: 'l1',
  metadata: { listId: 'l1', name: 'A list', timestamp: 1, entryCount: 1, lastSyncAt: 1788000000000 },
  entries: [{ id: 'e1', data: {} }],
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  batchSave.mockResolvedValue({ results: [], writeResults: {} });
  mpGetQueries.mockResolvedValue([]);
  mpCreateQuery.mockResolvedValue({});
  mpUpdateQuery.mockResolvedValue({});
});

describe('buildBackupPayload', () => {
  // Found by inspecting a real production backup: `archive` was missing from it. Archived lists
  // are how a winner whose source list is gone still renders "(Archived)" instead of "Unknown",
  // so a backup without them is not a complete picture of the app.
  it('collects every collection the app stores, archive included', async () => {
    getAll.mockImplementation(async (collection: string) =>
      collection === 'settings' ? [{ key: 'preSelectionDelay', value: 3 }] : [{ id: collection }]
    );

    const payload = await buildBackupPayload();

    expect(getAll.mock.calls.map(([c]) => c).sort()).toEqual([
      'archive',
      'history',
      'lists',
      'prizes',
      'settings',
      'templates',
      'winners'
    ]);
    expect(payload.archive).toEqual([{ id: 'archive' }]);
  });

  // Found the same way as `archive`: by reading a real production payload. MP queries are not a
  // collection, so a payload assembled from `getAll` could never contain them — and a restore
  // onto a fresh instance left the app unable to import from Ministry Platform at all.
  it('collects the MP queries, which no collection call can reach', async () => {
    getAll.mockResolvedValue([]);
    mpGetQueries.mockResolvedValue([{ id: 'main-event', name: 'Main Event' }]);

    const payload = await buildBackupPayload();

    expect(payload.mpQueries).toEqual([{ id: 'main-event', name: 'Main Event' }]);
    expect(payload.version).toBe('1.2');
  });

  // The queries are the one part fetched outside the collection batch, so they are the one part
  // that can fail on its own. Losing them must not cost the operator the rest of the backup.
  it('still produces a payload when the MP queries cannot be read', async () => {
    getAll.mockResolvedValue([]);
    mpGetQueries.mockRejectedValue(new Error('MP unreachable'));

    const payload = await buildBackupPayload();

    expect(payload.mpQueries).toEqual([]);
    expect(payload.lists).toEqual([]);
  });
});

describe('restoreBackup', () => {
  // Restoring an arbitrary JSON file over every collection is how a backup feature destroys data.
  it('refuses anything that is not a backup, before writing a single operation', async () => {
    for (const bad of [null, undefined, 42, 'a string', {}, { lists: [] }]) {
      await expect(restoreBackup(bad)).rejects.toThrow(/not a Winner App backup/);
    }
    expect(batchSave).not.toHaveBeenCalled();
  });

  it('writes every collection in one batch, not one call per collection', async () => {
    await restoreBackup(
      backup({
        lists: [list()],
        prizes: [{ prizeId: 'p1', name: 'P', quantity: 1, description: '', timestamp: 1 }],
        winners: [{ winnerId: 'w1' }],
        history: [{ historyId: 'h1' }],
        templates: [{ templateId: 't1' }],
        archive: [{ listId: 'a1', metadata: { listId: 'a1', name: 'Gone' }, archivedAt: 1 }],
        settings: { preSelectionDelay: 3, selectionMode: 'sequential' }
      })
    );

    expect(batchSave).toHaveBeenCalledTimes(1);
    const ops = batchSave.mock.calls[0]?.[0] as Array<{ collection: string }>;
    const byCollection = ops.reduce<Record<string, number>>((acc, o) => {
      acc[o.collection] = (acc[o.collection] ?? 0) + 1;
      return acc;
    }, {});
    expect(byCollection).toEqual({
      lists: 1,
      prizes: 1,
      winners: 1,
      history: 1,
      templates: 1,
      archive: 1,
      settings: 2
    });
  });

  it('reports back exactly what it restored', async () => {
    const summary = await restoreBackup(
      backup({ lists: [list(), list({ listId: 'l2' })], winners: [{ winnerId: 'w1' }], settings: { a: 1 } })
    );
    expect(summary).toEqual({
      lists: 2,
      prizes: 0,
      winners: 1,
      history: 0,
      templates: 0,
      archive: 0,
      settings: 1,
      mpQueries: 0
    });
  });

  // A falsy or pre-1971 lastSyncAt used to render as "Synced 12/31/1969" on every list that had
  // never actually synced.
  it('normalises a bogus lastSyncAt to null rather than to the epoch', async () => {
    await restoreBackup(
      backup({
        lists: [
          list({ listId: 'zero', metadata: { ...list().metadata, listId: 'zero', lastSyncAt: 0 } }),
          list({ listId: 'epoch', metadata: { ...list().metadata, listId: 'epoch', lastSyncAt: 123 } }),
          list({
            listId: 'real',
            metadata: { ...list().metadata, listId: 'real', lastSyncAt: 1788000000000 }
          })
        ]
      })
    );

    const ops = batchSave.mock.calls[0]?.[0] as Array<{
      collection: string;
      data: { listId: string; metadata: { lastSyncAt: number | null } };
    }>;
    const syncOf = (id: string) =>
      ops.find((o) => o.collection === 'lists' && o.data.listId === id)?.data.metadata.lastSyncAt;
    expect(syncOf('zero')).toBeNull();
    expect(syncOf('epoch')).toBeNull();
    expect(syncOf('real')).toBe(1788000000000);
  });

  it('accepts a backup whose optional collections are absent', async () => {
    const summary = await restoreBackup({ version: '2.0.0' });
    expect(summary).toEqual({
      lists: 0,
      prizes: 0,
      winners: 0,
      history: 0,
      templates: 0,
      archive: 0,
      settings: 0,
      mpQueries: 0
    });
    expect(batchSave).toHaveBeenCalledWith([]);
    // No queries in the payload means the MP endpoints are never touched — a pre-1.2 backup must
    // not read or write them just to discover there is nothing to do.
    expect(mpGetQueries).not.toHaveBeenCalled();
  });

  // Upsert, not blind create: restoring onto a live instance must not duplicate the queries the
  // operator is already using, and must still bring back one that was deleted.
  it('updates an MP query that still exists and creates one that does not', async () => {
    mpGetQueries.mockResolvedValue([{ id: 'kept', name: 'Kept' }]);

    const summary = await restoreBackup(
      backup({
        mpQueries: [
          { id: 'kept', name: 'Kept, renamed' },
          { id: 'gone', name: 'Deleted since the backup' }
        ]
      })
    );

    expect(mpUpdateQuery).toHaveBeenCalledWith('kept', { id: 'kept', name: 'Kept, renamed' });
    expect(mpCreateQuery).toHaveBeenCalledWith({ id: 'gone', name: 'Deleted since the backup' });
    expect(summary.mpQueries).toBe(2);
  });

  // The collections write atomically in one batch; the queries cannot ride it. A query that
  // fails must not turn a restore that recovered every list into a thrown error.
  it('counts a failed query rather than losing the whole restore', async () => {
    mpGetQueries.mockResolvedValue([]);
    mpCreateQuery.mockRejectedValueOnce(new Error('refused')).mockResolvedValueOnce({});

    const summary = await restoreBackup(
      backup({ lists: [list()], mpQueries: [{ id: 'bad' }, { id: 'good' }] })
    );

    expect(summary.lists).toBe(1);
    expect(summary.mpQueries).toBe(1);
  });

  // Backups taken before 1.1 have no `archive` key at all, and one of them is sitting on
  // production right now. Restoring it must write the collections it does have rather than fail.
  it('restores a 1.0 backup, which predates the archive collection', async () => {
    const summary = await restoreBackup({
      version: '1.0',
      lists: [list()],
      prizes: [],
      winners: [{ winnerId: 'w1' }],
      history: [],
      templates: [],
      settings: {}
    });

    expect(summary.archive).toBe(0);
    expect(summary.lists).toBe(1);
    const ops = batchSave.mock.calls[0]?.[0] as Array<{ collection: string }>;
    expect(ops.some((o) => o.collection === 'archive')).toBe(false);
    expect(ops.some((o) => o.collection === 'lists')).toBe(true);
  });
});
