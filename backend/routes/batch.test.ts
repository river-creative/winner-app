import { promises as fs } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The write path, over real HTTP, onto a real disk.
 *
 * This is the half that mocks cannot reach. `restoreBackup` is covered on the client side by
 * asserting the operations it builds, but those operations then have to survive the round trip
 * and land correctly as files — and restoring a backup is the single most destructive thing the
 * app can do, so "the write was never actually exercised" is not a gap worth carrying.
 *
 * It cannot be exercised against production for the obvious reason, so the real router is mounted
 * here against a throwaway DATA_DIR. Everything below is genuine: a real Express app on a real
 * port, real requests, and assertions on the bytes left on disk afterwards.
 */

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'winner-batch-'));
const DATA_DIR = path.join(tempRoot, 'data');

vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  DATA_DIR
}));

const { batchRouter } = await import('./batch.js');

let server: Server;
let base: string;

beforeAll(async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(batchRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(tempRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
});

const post = (body: unknown) =>
  fetch(`${base}/batch-save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

const readCollection = async (name: string) =>
  JSON.parse(await fs.readFile(path.join(DATA_DIR, `${name}.json`), 'utf8'));

/** The exact operation shape `restoreBackup` produces. */
const restoreOperations = () => [
  {
    collection: 'lists',
    data: {
      listId: 'l1',
      metadata: { listId: 'l1', name: 'Restored', entryCount: 2, timestamp: 1, lastSyncAt: null },
      entries: [
        { id: 'e1', data: { name: 'One' } },
        { id: 'e2', data: { name: 'Two' } }
      ]
    }
  },
  { collection: 'prizes', data: { prizeId: 'p1', name: 'Prize', quantity: 5, description: '', timestamp: 1 } },
  { collection: 'winners', data: { winnerId: 'w1', displayName: 'A Winner', prize: 'Prize' } },
  { collection: 'history', data: { historyId: 'h1', prize: 'Prize', winners: [] } },
  { collection: 'templates', data: { templateId: 't1', name: 'T', message: 'hi', isDefault: true } },
  {
    collection: 'archive',
    data: { listId: 'a1', metadata: { listId: 'a1', name: 'A deleted list' }, archivedAt: 1 }
  },
  { collection: 'settings', data: { key: 'preSelectionDelay', value: 3 } },
  { collection: 'settings', data: { key: 'selectionMode', value: 'sequential' } }
];

describe('POST /batch-save — the write a restore performs', () => {
  it('lands every collection on disk in one request', async () => {
    const res = await post({ operations: restoreOperations() });
    expect(res.status).toBe(200);

    expect((await readCollection('lists'))[0].entries).toHaveLength(2);
    expect((await readCollection('prizes'))[0].quantity).toBe(5);
    expect((await readCollection('winners'))[0].winnerId).toBe('w1');
    expect((await readCollection('history'))[0].historyId).toBe('h1');
    expect((await readCollection('templates'))[0].templateId).toBe('t1');
    // Archived lists are keyed by listId, not by an id field, so they land in their own file
    // under their own key — worth asserting, because the backup omitted them entirely until 1.1.
    expect((await readCollection('archive'))[0].listId).toBe('a1');
    expect(await readCollection('settings')).toHaveLength(2);
  });

  it('overwrites a document with the same key instead of appending a duplicate', async () => {
    await post({ operations: [{ collection: 'prizes', data: { prizeId: 'p1', name: 'Before', quantity: 1 } }] });
    await post({ operations: [{ collection: 'prizes', data: { prizeId: 'p1', name: 'After', quantity: 9 } }] });

    const prizes = await readCollection('prizes');
    expect(prizes).toHaveLength(1);
    expect(prizes[0]).toMatchObject({ name: 'After', quantity: 9 });
  });

  // A restore must not silently drop records that were already there under other keys.
  it('leaves documents the restore did not mention untouched', async () => {
    await post({ operations: [{ collection: 'winners', data: { winnerId: 'existing', displayName: 'Keep me' } }] });
    await post({ operations: [{ collection: 'winners', data: { winnerId: 'w1', displayName: 'New' } }] });

    const winners = await readCollection('winners');
    expect(winners.map((w: { winnerId: string }) => w.winnerId).sort()).toEqual(['existing', 'w1']);
  });

  // writeCollection serialises into a temp file, fsyncs, then renames. A leftover temp file means
  // the atomic path fell back to something else.
  it('leaves no temp files behind', async () => {
    await post({ operations: restoreOperations() });
    const leftovers = (await fs.readdir(DATA_DIR)).filter((f) => f.endsWith('.tmp') || f.startsWith('.'));
    expect(leftovers).toEqual([]);
  });

  it('rejects an unknown collection without writing anything', async () => {
    const res = await post({ operations: [{ collection: 'not_a_collection', data: { id: 1 } }] });
    expect(res.status).toBe(400);
    await expect(fs.readdir(DATA_DIR)).resolves.toEqual([]);
  });

  it('rejects a non-array operations payload', async () => {
    expect((await post({ operations: 'nope' })).status).toBe(400);
  });
});

describe('POST /batch-save — entry-level operations over HTTP', () => {
  const seed = () =>
    post({
      operations: [
        {
          collection: 'lists',
          data: {
            listId: 'l1',
            metadata: { listId: 'l1', name: 'L', entryCount: 3 },
            entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
          }
        }
      ]
    });

  it('removes the named entries and reports the new count', async () => {
    await seed();
    const res = await post({
      operations: [{ collection: 'lists', operation: 'removeEntries', id: 'l1', entryIds: ['b'] }]
    });
    const body = (await res.json()) as { results: Array<{ entryCount?: number }> };

    expect(body.results[0]?.entryCount).toBe(2);
    const stored = (await readCollection('lists'))[0];
    expect(stored.entries.map((e: { id: string }) => e.id)).toEqual(['a', 'c']);
    expect(stored.metadata.entryCount).toBe(2);
  });

  it('puts entries back on the end, which is what undo relies on', async () => {
    await seed();
    await post({ operations: [{ collection: 'lists', operation: 'removeEntries', id: 'l1', entryIds: ['a'] }] });
    await post({
      operations: [{ collection: 'lists', operation: 'restoreEntries', id: 'l1', entries: [{ id: 'a' }] }]
    });

    const stored = (await readCollection('lists'))[0];
    expect(stored.entries.map((e: { id: string }) => e.id)).toEqual(['b', 'c', 'a']);
    expect(stored.metadata.entryCount).toBe(3);
  });

  // The caller has already written its winners by this point; a silently skipped removal leaves
  // them in the pool to be drawn again.
  it('refuses a removal naming a list that is not there, rather than reporting success', async () => {
    await seed();
    const res = await post({
      operations: [{ collection: 'lists', operation: 'removeEntries', id: 'missing', entryIds: ['a'] }]
    });

    expect(res.status).toBe(400);
    expect((await readCollection('lists'))[0].entries).toHaveLength(3);
  });
});
