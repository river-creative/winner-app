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

vi.mock('$lib/api/client', () => ({
  batchSave: (...a: unknown[]) => batchSave(...a),
  getAll: (...a: unknown[]) => getAll(...a),
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
      settings: 1
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
      settings: 0
    });
    expect(batchSave).toHaveBeenCalledWith([]);
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
