import { describe, expect, it } from 'vitest';

import { CollectionItem } from './../config.js';
import { removeEntries, restoreEntries } from './list-entries.js';

/**
 * These two operations exist so a draw does not have to post a whole list back to remove the few
 * rows it drew. They run against the array the batch route has already read, and the route writes
 * that same array out — so a mistake here is a mistake in the stored file.
 */

function lists(): CollectionItem[] {
  return [
    {
      listId: 'main',
      metadata: { name: 'Main Event', entryCount: 4 },
      entries: [
        { id: 'a', data: { name: 'A' } },
        { id: 'b', data: { name: 'B' } },
        { id: 'c', data: { name: 'C' } },
        { id: 'd', data: { name: 'D' } }
      ]
    },
    { listId: 'other', metadata: { name: 'Other', entryCount: 1 }, entries: [{ id: 'z' }] }
  ];
}

const idsOf = (collection: CollectionItem[], listId: string): string[] =>
  (collection.find((list) => list['listId'] === listId)?.['entries'] as Array<{ id: string; }>).map(
    (entry) => entry.id
  );

const countOf = (collection: CollectionItem[], listId: string): number =>
  collection.find((list) => list['listId'] === listId)?.['metadata']['entryCount'];

describe('removeEntries', () => {
  it('drops only the named entries and returns the new count', () => {
    const collection = lists();
    const count = removeEntries(collection, 'main', ['b', 'd']);

    expect(count).toBe(2);
    expect(idsOf(collection, 'main')).toEqual(['a', 'c']);
  });

  it('keeps metadata.entryCount in step with what is stored', () => {
    const collection = lists();
    removeEntries(collection, 'main', ['a']);

    expect(countOf(collection, 'main')).toBe(3);
  });

  it('leaves every other list alone', () => {
    const collection = lists();
    removeEntries(collection, 'main', ['a', 'b', 'c', 'd']);

    expect(idsOf(collection, 'other')).toEqual(['z']);
    expect(countOf(collection, 'other')).toBe(1);
  });

  it('ignores ids that are not there rather than failing the draw', () => {
    const collection = lists();
    const count = removeEntries(collection, 'main', ['b', 'gone']);

    expect(count).toBe(3);
    expect(idsOf(collection, 'main')).toEqual(['a', 'c', 'd']);
  });

  // The caller has already written its winners by the time this runs. Silently doing nothing
  // would leave those winners in the pool, to be drawn a second time.
  it('throws for a list that does not exist', () => {
    expect(() => removeEntries(lists(), 'missing', ['a'])).toThrow(/does not exist/);
  });

  it('throws when no entries are named', () => {
    expect(() => removeEntries(lists(), 'main', [])).toThrow(/non-empty/);
  });

  // `new Set([undefined]).has(undefined)` works fine, so a malformed id would remove nothing and
  // report success — the draw's winners saved, its entries still in the pool.
  it('refuses an id that is not a usable string', () => {
    expect(() => removeEntries(lists(), 'main', ['a', undefined as unknown as string])).toThrow(
      /no usable id/
    );
    expect(() => removeEntries(lists(), 'main', [''])).toThrow(/no usable id/);
  });
});

describe('restoreEntries', () => {
  it('appends at the end, matching what undo did when it rebuilt the list client-side', () => {
    const collection = lists();
    removeEntries(collection, 'main', ['a', 'c']);
    const count = restoreEntries(collection, 'main', [{ id: 'a' }, { id: 'c' }]);

    expect(count).toBe(4);
    expect(idsOf(collection, 'main')).toEqual(['b', 'd', 'a', 'c']);
    expect(countOf(collection, 'main')).toBe(4);
  });

  it('cannot duplicate an entry that is already there', () => {
    const collection = lists();
    const count = restoreEntries(collection, 'main', [{ id: 'a' }, { id: 'new' }]);

    expect(count).toBe(5);
    expect(idsOf(collection, 'main')).toEqual(['a', 'b', 'c', 'd', 'new']);
  });

  it('throws for a list that does not exist', () => {
    expect(() => restoreEntries(lists(), 'missing', [{ id: 'a' }])).toThrow(/does not exist/);
  });

  it('throws when no entries are given', () => {
    expect(() => restoreEntries(lists(), 'main', [])).toThrow(/non-empty/);
  });

  // Without the check these append as entries with no id — invisible to every later draw, scan
  // and undo, and impossible to tell apart from real rows once written.
  it('refuses an entry with no usable id', () => {
    expect(() => restoreEntries(lists(), 'main', [{ data: {} } as never])).toThrow(/no usable id/);
    expect(() => restoreEntries(lists(), 'main', [null as never])).toThrow(/no usable id/);
  });
});
