/**
 * Every write that changes a list, in one place.
 *
 * The Lists screen, its cards and its dialogs all mutate the same three documents (the list, the
 * archive record, and the draw selection that points at them). The Alpine version spread those
 * across lists.js, csv-parser.js and ministryplatform.js, which is how the same list could be
 * deleted from the collection but left selected in the persisted setup — the public display then
 * showed a phantom pick. Doing it once here means the cleanup cannot be half-applied.
 */

import * as api from '$lib/api/client';
import { data } from '$lib/state/data.svelte';
import { setup } from '$lib/state/setup.svelte';
import { toasts } from '$lib/state/toasts.svelte';
import { ui } from '$lib/state/ui.svelte';
import type {
  ArchivedList,
  IdConfig,
  InfoConfig,
  List,
  ListEntry,
  ListMetadata,
  ListSettings,
  ListSortField,
  MpRecord,
  MpSource,
  SortDirection,
  Winner
} from '$lib/types';
import { generateId } from '$lib/utils/id';

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/** Sorted copy for the grid. Never sorts `data.lists` in place — that array is shared state. */
export function sortLists(lists: List[], field: ListSortField, direction: SortDirection): List[] {
  const sign = direction === 'asc' ? 1 : -1;

  return [...lists].sort((a, b) => {
    switch (field) {
      case 'name':
        return sign * a.metadata.name.localeCompare(b.metadata.name, undefined, { sensitivity: 'base' });
      case 'entries':
        return sign * (a.entries.length - b.entries.length);
      case 'date':
        return sign * (a.metadata.timestamp - b.metadata.timestamp);
    }
  });
}

/**
 * Whether anything still points at this list.
 *
 * A referenced list is archived rather than destroyed, so its winners and history entries can
 * still name where they came from. `listIds` is checked as well as `listId`: a multi-list draw
 * records only its *first* list in `listId`, so a list that was the second source of a draw
 * looks unreferenced if you only read that field.
 */
export function isListReferenced(listId: string): boolean {
  if (data.winners.some((winner) => winner.listId === listId)) return true;
  return data.history.some((entry) => entry.listId === listId || entry.listIds?.includes(listId) === true);
}

/**
 * The columns the entries table shows: sampled from the first ten entries, sorted, capped at five.
 *
 * Sampled rather than taken from the first entry alone because a Ministry Platform record omits
 * the fields it has no value for, so entry 0 is not guaranteed to carry every column.
 */
export function displayColumns(entries: ListEntry[], limit = 5): string[] {
  const columns = new Set<string>();
  for (const entry of entries.slice(0, 10)) {
    for (const column of Object.keys(entry.data)) columns.add(column);
  }
  return [...columns].sort().slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

/**
 * A Ministry Platform record as a list entry's `data`.
 *
 * Values are stringified because `ListEntry.data` is `Record<string, string>` and the templates,
 * the CSV export and the SMS placeholders all assume strings — an MP `Contact_ID` arrives as a
 * number. The *keys* are deliberately left alone: camelising them would rename the fields every
 * saved MP list's name and card templates refer to, breaking those lists on their next sync.
 */
export function mpRecordToRow(record: MpRecord): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    row[key] = value === null || value === undefined ? '' : String(value);
  }
  return row;
}

/**
 * The union of field names across a sample of rows, in first-seen order.
 *
 * Sampled rather than read off row 0: a Ministry Platform record omits the fields it has no
 * value for, so the first record alone is not a reliable column list — and a field missing from
 * it would be missing from the wizard's chips and its id `<select>` too.
 */
export function fieldNames(rows: Array<Record<string, string>>, sample = 50): string[] {
  const names = new Set<string>();
  for (const row of rows.slice(0, sample)) {
    for (const key of Object.keys(row)) names.add(key);
  }
  return [...names];
}

/**
 * Every id that has already won something, for the import wizard's "skip existing winners".
 *
 * `winnerId` is collected as well as `entryId` because older records used the winner id itself
 * as the record id — dropping it would let those people be imported again.
 */
export function existingWinnerIds(winners: Winner[]): Set<string> {
  const ids = new Set<string>();
  for (const winner of winners) {
    if (winner.entryId) ids.add(winner.entryId);
    if (winner.winnerId) ids.add(winner.winnerId);
  }
  return ids;
}

/** The id for one imported row. Called exactly once per row — see the wizard's import step. */
export function entryIdFor(row: Record<string, string>, idConfig: IdConfig): string {
  if (idConfig.source === 'column' && idConfig.column) {
    return (row[idConfig.column] ?? '').trim() || generateId();
  }
  return generateId();
}

/**
 * What a CSV file, a Pretix report and a Ministry Platform query all reduce to before the import
 * wizard sees them. One shape means the wizard has no idea which of the three it is configuring.
 */
export interface ImportSource {
  /** One record per row. Camel-keyed for CSV and reports, raw MP field names for MP. */
  rows: Array<Record<string, string>>;
  /** Field names in source order — the chips, the id `<select>` and the previews all use these. */
  headers: string[];
  /** Suggested list name; the operator can still change it in the wizard. */
  listName: string;
  /** Stored as `metadata.originalFilename`, which is all the provenance a CSV import leaves. */
  fileName: string;
  /** Present only for a Ministry Platform import — it is what makes the list syncable. */
  mpSource: MpSource | null;
}

export interface BuiltListInput {
  name: string;
  originalFilename: string;
  rows: Array<Record<string, string>>;
  /** How many rows the source held before the winner filter ran. */
  originalCount: number;
  skippedWinners: number;
  nameConfig: string;
  infoConfig: InfoConfig;
  idConfig: IdConfig;
  listSettings: ListSettings;
  mpSource: MpSource | null;
  /** One id per row, in row order — computed once by the caller and reused for the filter. */
  ids: string[];
}

/**
 * Assemble the `List` record exactly as `ListMetadata` defines it.
 *
 * Every field is written, including the ones that are `null` or `0` at creation: `POST
 * /api/lists` replaces the stored document wholesale, so a field omitted here is a field that
 * does not exist — and `lastSyncAt: undefined` is what made a never-synced list print
 * "Synced 12/31/1969".
 */
export function buildList(input: BuiltListInput): List {
  const listId = generateId();

  const entries: ListEntry[] = input.rows.map((row, index) => ({
    id: input.ids[index] ?? generateId(),
    index,
    data: row
  }));

  const metadata: ListMetadata = {
    listId,
    name: input.name,
    timestamp: Date.now(),
    originalFilename: input.originalFilename,
    entryCount: entries.length,
    originalCount: input.originalCount,
    skippedWinners: input.skippedWinners,
    nameConfig: input.nameConfig,
    infoConfig: input.infoConfig,
    idConfig: input.idConfig,
    mpSource: input.mpSource,
    lastSyncAt: null,
    syncCount: 0,
    listSettings: input.listSettings
  };

  return { listId, metadata, entries };
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/** Save a whole list document and mirror it into the in-memory collection. Throws on failure. */
export async function saveList(list: List): Promise<void> {
  await api.save('lists', list);
  data.upsertList(list);
}

/**
 * Archive: keep the metadata, discard the entries, drop the list.
 *
 * One batched call, because two separate writes to `data/lists.json` and `data/archive.json`
 * would each read and rewrite their file — and a failure between them would leave a list that is
 * neither live nor archived.
 */
export async function archiveList(list: List): Promise<void> {
  const record: ArchivedList = {
    listId: list.listId,
    metadata: { ...list.metadata },
    archivedAt: Date.now()
  };

  await data.commit([
    // Spread rather than passed by reference: `BatchSaveOperation.data` is an index-signature
    // type, which an interface does not satisfy without one.
    { collection: 'archive', data: { ...record } },
    { collection: 'lists', operation: 'delete', id: list.listId }
  ]);

  data.removeList(list.listId);
  setup.deselectList(list.listId);

  // `data` exposes no archive mutation, and the winners table reads `data.archive` to add the
  // "(Archived)" suffix that tells an operator a source list is gone. A reload is the only way
  // to get the new record in front of that lookup; its own failure is reported separately so it
  // cannot be mistaken for the archive itself having failed.
  await refreshAfterArchive();
}

async function refreshAfterArchive(): Promise<void> {
  try {
    await data.loadAll();
  } catch (error) {
    toasts.fromError(error, 'The list was archived, but the screen could not be refreshed.');
  }
}

/** Delete outright. Only ever called for a list nothing references — see `isListReferenced`. */
export async function deleteList(listId: string): Promise<void> {
  await api.remove('lists', listId);
  data.removeList(listId);
  setup.deselectList(listId);
}

// ---------------------------------------------------------------------------------------------
// Ministry Platform sync
// ---------------------------------------------------------------------------------------------

export interface SyncResult {
  added: number;
}

/**
 * Re-run the query this list came from and append whatever is new.
 *
 * Two rules carried over verbatim, because both are load-bearing:
 *  - the id column falls back to `idCard`, which is the column every MP query selected before
 *    `idConfig` existed;
 *  - a list that removes its winners also skips ids that have already won *from this list*,
 *    otherwise every sync hands back the people the draw just took out.
 *
 * `lastSyncAt` and `syncCount` are bumped even when nothing was added — "synced, nothing new" and
 * "never synced" are different states, and the card shows the difference.
 */
export async function syncListFromMp(list: List): Promise<SyncResult> {
  const mpSource = list.metadata.mpSource;
  if (!mpSource) throw new Error('This list was not imported from Ministry Platform.');

  return ui.withProgress('Syncing List', 'Fetching data from Ministry Platform…', async (report) => {
    const records = await api.mpExecuteQuery(mpSource.queryId, mpSource.params);

    report(40, 'Processing entries…');
    const idColumn = list.metadata.idConfig?.column ?? 'idCard';
    const knownIds = new Set(list.entries.map((entry) => entry.id));

    const winnerIds = new Set<string>();
    if (list.metadata.listSettings?.removeWinnersFromList !== false) {
      for (const winner of data.winners) {
        if (winner.listId === list.listId && winner.entryId) winnerIds.add(winner.entryId);
      }
    }

    report(60, 'Finding new entries…');
    const newEntries: ListEntry[] = [];
    for (const record of records) {
      const raw = record[idColumn];
      const entryId = raw === null || raw === undefined ? '' : String(raw).trim();
      if (!entryId) continue;
      if (knownIds.has(entryId)) continue;
      if (winnerIds.has(entryId)) continue;

      // Added before the push, so a duplicate *within this response* is caught too. The old
      // loop only ever tested against the ids the list already had, so one query returning the
      // same person twice imported them twice.
      knownIds.add(entryId);
      newEntries.push({
        id: entryId,
        index: list.entries.length + newEntries.length,
        data: mpRecordToRow(record)
      });
    }

    report(80, newEntries.length > 0 ? `Adding ${newEntries.length} new entries…` : 'Saving…');

    const updated: List = {
      ...list,
      entries: [...list.entries, ...newEntries],
      metadata: {
        ...list.metadata,
        entryCount: list.entries.length + newEntries.length,
        lastSyncAt: Date.now(),
        syncCount: (list.metadata.syncCount ?? 0) + 1
      }
    };

    await saveList(updated);
    return { added: newEntries.length };
  });
}
