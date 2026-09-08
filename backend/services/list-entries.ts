import { CollectionItem } from '../config.js';

/**
 * Adding and removing a list's entries server-side.
 *
 * A draw removes a handful of entries from a list. It used to do that by rebuilding the list on
 * the client and posting the whole thing back — measured at **7.4 MB to remove five entries**
 * from a twenty-thousand-entry list, with the winners' reveal held behind that upload. These two
 * operations carry ids instead, so the payload is the same few hundred bytes whatever the list
 * size.
 *
 * Keeping the mutation here rather than inline in the batch route also gives
 * `metadata.entryCount` a single owner. Three separate call sites on the client each used to
 * recompute it, which is correct only for as long as every future caller remembers to.
 *
 * Neither function is forgiving. A list that is not there, or an operation that names no entries,
 * throws — because the caller is a draw that has already written its winners, and a silently
 * skipped removal leaves those winners in the pool to be drawn a second time.
 */

/** One entry as stored. Only `id` is load-bearing here; the rest is the operator's own data. */
export interface ListEntry extends CollectionItem {
  id: string;
}

interface StoredList extends CollectionItem {
  listId: string;
  entries?: ListEntry[];
  metadata?: { entryCount?: number;[key: string]: unknown; };
}

/**
 * Every id has to be a real, non-empty string.
 *
 * `new Set([undefined])` and `existing.has(undefined)` both behave perfectly well, so a malformed
 * payload would not fail here — it would quietly remove nothing, or append entries with no id
 * that no draw or scan could ever match again. Refusing is the only outcome the caller can act on.
 */
function assertIds(operation: string, ids: unknown[]): string[] {
  return ids.map((id, index) => {
    if (typeof id !== 'string' || id === '') {
      throw new Error(`${operation}: entry ${index} has no usable id.`);
    }
    return id;
  });
}

function findList(lists: CollectionItem[], listId: string): StoredList {
  const list = lists.find((item) => item['listId'] === listId) as StoredList | undefined;
  if (!list) {
    throw new Error(`List ${listId} does not exist, so its entries cannot be changed.`);
  }
  return list;
}

/**
 * Keep the cached count in step with the entries actually stored.
 *
 * `metadata.entryCount` is what every screen renders; a list whose count disagrees with its
 * contents reads as data loss to the operator looking at it.
 */
function syncCount(list: StoredList): number {
  const count = list.entries?.length ?? 0;
  if (list.metadata) list.metadata['entryCount'] = count;
  return count;
}

/**
 * Drop the named entries from a list. Returns the list's new entry count.
 *
 * Ids that are not present are ignored rather than fatal: undo restores entries, and an operator
 * can delete a list's rows by hand between a draw and its undo. Removing what is there is the
 * outcome the caller wants in both cases.
 */
export function removeEntries(
  lists: CollectionItem[],
  listId: string,
  entryIds: string[]
): number {
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    throw new Error('removeEntries needs a non-empty entryIds array.');
  }

  const list = findList(lists, listId);
  const drop = new Set(assertIds('removeEntries', entryIds));
  list.entries = (list.entries ?? []).filter((entry) => !drop.has(entry?.id));
  return syncCount(list);
}

/**
 * Put entries back into a list. Returns the list's new entry count.
 *
 * Appended at the end, which is exactly what the undo path did when it rebuilt the list on the
 * client — moving that here must not quietly reorder anyone's list. Entries already present are
 * skipped, so an undo applied twice cannot duplicate them.
 */
export function restoreEntries(
  lists: CollectionItem[],
  listId: string,
  entries: ListEntry[]
): number {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('restoreEntries needs a non-empty entries array.');
  }
  assertIds(
    'restoreEntries',
    entries.map((entry) => (entry && typeof entry === 'object' ? entry.id : undefined))
  );

  const list = findList(lists, listId);
  const existing = new Set((list.entries ?? []).map((entry) => entry?.id));
  const missing = entries.filter((entry) => !existing.has(entry?.id));

  list.entries = [...(list.entries ?? []), ...missing];
  return syncCount(list);
}
