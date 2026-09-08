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
import { settings } from '$lib/state/settings.svelte';
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

/**
 * Whether this list refuses anyone who has already won, at import and on every sync.
 *
 * The value lives on the list; the global setting is only the default a *new* list starts from,
 * and the fallback here is what a list imported before that split gets. One function, one
 * fallback, deliberately: the wizard shows the answer and the sync applies it, and two spellings
 * of the same rule is how a checkbox comes to describe something the app does not do.
 *
 * `globalDefault` is a parameter rather than a store read so the rule stays pure and testable —
 * the same shape as `buildEligibility(…, globalPreventSamePrize)`.
 */
export function skipsExistingWinners(list: List, globalDefault: boolean): boolean {
  return list.metadata.listSettings?.skipExistingWinners ?? globalDefault;
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

/**
 * An existing list, as the wizard's input.
 *
 * The gear on a list card opens the same wizard the import does, so the edit flow has to hand it
 * the same shape. Its rows are the entries' data, which is what the field chips, the id column
 * and every template preview are built from — so what the operator configures is previewed
 * against the records the list actually holds.
 */
export function listAsImportSource(list: List): ImportSource {
  const rows = list.entries.map((entry) => entry.data);

  return {
    rows,
    // Sampled union, not `Object.keys(rows[0])`: a Ministry Platform record omits the fields it
    // has no value for, so a sparse first entry would hide columns from the whole wizard.
    headers: fieldNames(rows),
    listName: list.metadata.name,
    fileName: list.metadata.originalFilename ?? '',
    mpSource: list.metadata.mpSource ?? null
  };
}

/**
 * What the wizard is configuring: a pending import, or a list that already exists.
 *
 * A union rather than an `ImportSource` plus an optional list, so there is no state in which a
 * list is supplied and the wizard still behaves as an import, or the reverse.
 */
export type WizardTarget = { mode: 'import'; source: ImportSource } | { mode: 'edit'; list: List };

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

/** What the wizard writes back when it is editing rather than importing. */
export interface ListConfigInput {
  name: string;
  nameConfig: string;
  infoConfig: InfoConfig;
  listSettings: ListSettings;
}

/**
 * Persist a settings edit onto an existing list.
 *
 * Metadata only, and only these four keys. **Entries are never touched** — they are already keyed
 * by `idConfig` and every `winners.entryId` points at those keys, which is the same reason the
 * wizard renders the record ID step read-only when editing. Spreading the list rather than
 * rebuilding it is what makes that structural instead of remembered: `idConfig`, `mpSource`,
 * `lastSyncAt`, `syncCount`, `entryCount`, `originalFilename` and `timestamp` cannot be lost by
 * an edit here, because nothing in this function names them.
 */
export async function saveListConfig(list: List, config: ListConfigInput): Promise<void> {
  await saveList({
    ...list,
    metadata: {
      ...list.metadata,
      name: config.name,
      nameConfig: config.nameConfig,
      infoConfig: config.infoConfig,
      listSettings: { ...list.metadata.listSettings, ...config.listSettings }
    }
  });
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

export interface SyncExclusions {
  /** `removeWinnersFromList`: never re-add someone who won FROM THIS LIST. */
  excludeWinnersOfThisList: boolean;
  /** `skipExistingWinners`: never add someone who has won ANYWHERE. */
  excludeAllWinners: boolean;
}

/**
 * The ids a sync must not add back.
 *
 * Two rules sit next to each other here and stay separate because they answer different
 * questions — one is about this list's own draws, the other about every draw there has ever
 * been. Pure, because it is the whole of what `skipExistingWinners` changed about syncing and
 * the rest of `syncListFromMp` is network and progress reporting.
 */
export function syncExclusionIds(
  listId: string,
  winners: Winner[],
  { excludeWinnersOfThisList, excludeAllWinners }: SyncExclusions
): Set<string> {
  // `existingWinnerIds` also collects `winnerId`, which older records used as the record id —
  // the same set the import filter uses, so the setting means one thing in both places.
  const ids = excludeAllWinners ? existingWinnerIds(winners) : new Set<string>();

  if (excludeWinnersOfThisList) {
    for (const winner of winners) {
      if (winner.listId === listId && winner.entryId) ids.add(winner.entryId);
    }
  }

  return ids;
}

/**
 * Re-run the query this list came from and append whatever is new.
 *
 * Three rules, all load-bearing:
 *  - the id column falls back to `idCard`, which is the column every MP query selected before
 *    `idConfig` existed;
 *  - a list that removes its winners also skips ids that have already won *from this list*,
 *    otherwise every sync hands back the people the draw just took out. The `!== false` default
 *    is deliberate and not `removesWinners(list)`, which falls back to the global
 *    `preventDuplicates`: a list that never removed its winners still holds them, so they are
 *    already in `knownIds` and the difference is unobservable — while defaulting the other way
 *    would re-add people a draw had taken out;
 *  - a list with `skipExistingWinners` skips ids that have won *anywhere*, which is what makes
 *    that a lasting list setting rather than a filter the import applied once.
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

    const winnerIds = syncExclusionIds(list.listId, data.winners, {
      excludeWinnersOfThisList: list.metadata.listSettings?.removeWinnersFromList !== false,
      excludeAllWinners: skipsExistingWinners(list, settings.current.skipExistingWinners)
    });

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
