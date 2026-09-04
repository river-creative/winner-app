import * as api from '$lib/api/client';
import type {
  ArchivedList,
  BatchSaveOperation,
  HistoryEntry,
  List,
  Prize,
  Template,
  Winner
} from '$lib/types';
import { toasts } from './toasts.svelte';

/**
 * The four collections the console reads on boot, plus the two it needs to name things.
 *
 * All six come back in one `POST /api/batch` rather than six requests. The old client fetched
 * them separately and then re-fetched the whole collection after every single write, which is
 * how a hundred-winner draw turned into two hundred round trips.
 */
class DataStore {
  #lists = $state<List[]>([]);
  #prizes = $state<Prize[]>([]);
  #winners = $state<Winner[]>([]);
  #history = $state<HistoryEntry[]>([]);
  #templates = $state<Template[]>([]);
  #archive = $state<ArchivedList[]>([]);

  #loading = $state(true);
  #error = $state<string | null>(null);

  get lists(): List[] {
    return this.#lists;
  }
  get prizes(): Prize[] {
    return this.#prizes;
  }
  get winners(): Winner[] {
    return this.#winners;
  }
  get history(): HistoryEntry[] {
    return this.#history;
  }
  get templates(): Template[] {
    return this.#templates;
  }
  get archive(): ArchivedList[] {
    return this.#archive;
  }

  get loading(): boolean {
    return this.#loading;
  }

  /**
   * Non-null when the last load failed. Screens must render this rather than their empty state:
   * "No lists yet — import a CSV" is a lie when the truth is that the server is unreachable.
   */
  get error(): string | null {
    return this.#error;
  }

  get defaultTemplate(): Template | undefined {
    return this.#templates.find((template) => template.isDefault);
  }

  // -------------------------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------------------------

  async loadAll(): Promise<void> {
    this.#loading = true;
    this.#error = null;
    try {
      const result = await api.batchFetch([
        { collection: 'lists' },
        { collection: 'prizes' },
        { collection: 'winners' },
        { collection: 'history' },
        { collection: 'templates' },
        { collection: 'archive' }
      ]);

      this.#lists = extract<List>(result, 'lists');
      this.#prizes = extract<Prize>(result, 'prizes');
      this.#history = extract<HistoryEntry>(result, 'history');
      this.#templates = extract<Template>(result, 'templates');
      this.#archive = extract<ArchivedList>(result, 'archive');
      this.#winners = this.#enrich(extract<Winner>(result, 'winners'));
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'Could not load data.';
      throw error;
    } finally {
      this.#loading = false;
    }
  }

  async reload(collection: 'lists' | 'prizes' | 'winners' | 'history' | 'templates'): Promise<void> {
    switch (collection) {
      case 'lists':
        this.#lists = await api.getAll('lists');
        // A list's name is what winners display, so their labels have to follow it.
        this.#winners = this.#enrich(this.#winners);
        return;
      case 'prizes':
        this.#prizes = await api.getAll('prizes');
        return;
      case 'winners':
        this.#winners = this.#enrich(await api.getAll('winners'));
        return;
      case 'history':
        this.#history = await api.getAll('history');
        return;
      case 'templates':
        this.#templates = await api.getAll('templates');
        return;
    }
  }

  /**
   * Fill in each winner's list name, marking the ones whose list has since been archived.
   *
   * A deleted-but-referenced list is archived rather than destroyed precisely so this lookup
   * still resolves; without the suffix an operator cannot tell a live list from an archived one.
   */
  #enrich(winners: Winner[]): Winner[] {
    const liveNames = new Map(this.#lists.map((list) => [list.listId, list.metadata.name]));
    const archivedNames = new Map(this.#archive.map((item) => [item.listId, item.metadata?.name]));

    return winners.map((winner) => {
      const live = liveNames.get(winner.listId);
      const archived = archivedNames.get(winner.listId);
      const isArchivedList = !live && !!archived;

      return {
        ...winner,
        listName: (live ?? archived ?? winner.listName ?? 'Unknown') + (isArchivedList ? ' (Archived)' : ''),
        isArchivedList
      };
    });
  }

  // -------------------------------------------------------------------------------------------
  // Local mutation
  //
  // These update the in-memory collections only. Every caller pairs them with a write, and
  // rolls back by calling them again with the previous value if the write fails.
  // -------------------------------------------------------------------------------------------

  upsertList(list: List): void {
    this.#lists = upsert(this.#lists, list, (item) => item.listId);
  }

  removeList(listId: string): void {
    this.#lists = this.#lists.filter((list) => list.listId !== listId);
  }

  upsertPrize(prize: Prize): void {
    this.#prizes = upsert(this.#prizes, prize, (item) => item.prizeId);
  }

  removePrize(prizeId: string): void {
    this.#prizes = this.#prizes.filter((prize) => prize.prizeId !== prizeId);
  }

  upsertTemplate(template: Template): void {
    this.#templates = upsert(this.#templates, template, (item) => item.templateId);
  }

  removeTemplate(templateId: string): void {
    this.#templates = this.#templates.filter((template) => template.templateId !== templateId);
  }

  setWinners(winners: Winner[]): void {
    this.#winners = this.#enrich(winners);
  }

  patchWinner(winnerId: string, patch: Partial<Winner>): void {
    this.#winners = this.#winners.map((winner) =>
      winner.winnerId === winnerId ? { ...winner, ...patch } : winner
    );
  }

  removeWinners(winnerIds: Set<string>): void {
    this.#winners = this.#winners.filter((winner) => !winnerIds.has(winner.winnerId));
  }

  addWinners(winners: Winner[]): void {
    this.#winners = this.#enrich([...this.#winners, ...winners]);
  }

  upsertHistory(entry: HistoryEntry): void {
    this.#history = upsert(this.#history, entry, (item) => item.historyId);
  }

  removeHistory(historyId: string): void {
    this.#history = this.#history.filter((entry) => entry.historyId !== historyId);
  }

  // -------------------------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------------------------

  listById(listId: string): List | undefined {
    return this.#lists.find((list) => list.listId === listId);
  }

  prizeById(prizeId: string): Prize | undefined {
    // Ids have always been compared loosely here; a prize id read back from a <select> is a
    // string even when the stored one is not.
    return this.#prizes.find((prize) => String(prize.prizeId) === String(prizeId));
  }

  winnerById(winnerId: string): Winner | undefined {
    return this.#winners.find((winner) => winner.winnerId === winnerId);
  }

  templateById(templateId: string): Template | undefined {
    return this.#templates.find((template) => template.templateId === templateId);
  }

  // -------------------------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------------------------

  /**
   * The write path for anything touching more than one document.
   *
   * `data/<collection>.json` has no locking: each write reads the whole array and writes it
   * back, so two concurrent writes to one collection lose one of them. Batching means one read.
   */
  async commit(operations: BatchSaveOperation[]): Promise<void> {
    if (operations.length === 0) return;
    await api.batchSave(operations);
  }

  /** Report a failed write consistently, so no screen has to invent its own wording. */
  reportWriteFailure(error: unknown, what: string): void {
    toasts.fromError(error, `Could not save ${what}. Nothing was changed.`);
  }
}

/**
 * The inverse of `#enrich`, for the one case that writes a winner back: undo.
 *
 * `listName` is rewritten at load time and `isArchivedList` does not exist on the stored record.
 * Persisting either bakes a display decision into the data — restoring a winner would save
 * "Fall Retreat (Archived)" as the list's name, and it would keep that suffix even after the
 * list came back.
 */
export function persistableWinner(winner: Winner): Record<string, unknown> {
  const { isArchivedList, listName, ...rest } = winner;
  return {
    ...rest,
    listName: isArchivedList ? listName.replace(/ \(Archived\)$/, '') : listName
  };
}

function upsert<T>(items: T[], item: T, key: (item: T) => string): T[] {
  const id = key(item);
  const index = items.findIndex((candidate) => key(candidate) === id);
  if (index === -1) return [...items, item];
  return items.map((candidate, position) => (position === index ? item : candidate));
}

/**
 * `POST /api/batch` answers 200 even when one collection failed to read, putting an `{error}`
 * object where the array should be. Treating that as an empty array is how lists silently
 * vanished mid-draw, so it throws instead.
 */
function extract<T>(result: Record<string, api.BatchValue<unknown>>, key: string): T[] {
  const value = result[key];
  if (api.isBatchError(value)) throw new Error(`Could not read ${key}: ${value.error}`);
  if (!Array.isArray(value)) return [];
  return value as T[];
}

export const data = new DataStore();
