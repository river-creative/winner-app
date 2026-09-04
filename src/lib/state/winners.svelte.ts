import * as api from '$lib/api/client';
import { exportWinnersCsv } from '$lib/services/export';
import type { BatchSaveOperation, HistoryEntry, List, Winner } from '$lib/types';
import { formatNumber, pluralise } from '$lib/utils/format';
import { data, persistableWinner } from './data.svelte';
import { winnerFilters } from './filters.svelte';
import { toasts } from './toasts.svelte';
import { ui } from './ui.svelte';

/**
 * What a delete has to put back to be undoable: the winner records themselves, and the history
 * entries exactly as they were before they were pruned or removed.
 */
interface Restorable {
  winners: Winner[];
  history: HistoryEntry[];
}

/**
 * Take the given winners out of every history entry that names them.
 *
 * A history entry is the record of one draw, so an entry that loses its last winner is a record
 * of nothing and goes too. The operations are returned rather than executed: they belong in the
 * *same* `batch-save` as the winner deletes, because `data/*.json` has no locking — a second
 * request to `history` reads the array the first one has not written back yet, and one of the
 * two writes is lost.
 */
function pruneHistory(winnerIds: Set<string>): {
  operations: BatchSaveOperation[];
  originals: HistoryEntry[];
  removed: HistoryEntry[];
  updated: HistoryEntry[];
} {
  const operations: BatchSaveOperation[] = [];
  const originals: HistoryEntry[] = [];
  const removed: HistoryEntry[] = [];
  const updated: HistoryEntry[] = [];

  for (const entry of data.history) {
    if (!entry.winners.some((winner) => winnerIds.has(winner.winnerId))) continue;

    originals.push({ ...entry, winners: [...entry.winners] });
    const kept = entry.winners.filter((winner) => !winnerIds.has(winner.winnerId));

    if (kept.length === 0) {
      removed.push(entry);
      operations.push({ collection: 'history', operation: 'delete', id: entry.historyId });
    } else {
      const next: HistoryEntry = { ...entry, winners: kept };
      updated.push(next);
      operations.push({ collection: 'history', data: next as unknown as Record<string, unknown> });
    }
  }

  return { operations, originals, removed, updated };
}

/**
 * Everything the Winners screen does to the data.
 *
 * A store rather than handlers on the page for the reason the rest of `$lib/state` exists: the
 * write paths are the part with the ordering rules (one batch per delete, roll back on failure,
 * re-read after an await), and they should not be reachable only through a component tree. The
 * screen keeps the markup.
 */
class WinnerActionsStore {
  #checkingSms = $state(false);

  /** True while `processQueue` is in flight, so the toolbar can disable itself and spin. */
  get checkingSms(): boolean {
    return this.#checkingSms;
  }

  // -------------------------------------------------------------------------------------------
  // Pickup
  // -------------------------------------------------------------------------------------------

  /**
   * Flip a winner's pickup state, optimistically.
   *
   * The badge changes under the operator's finger because a pickup desk is a queue of people,
   * not a queue of requests; the rollback is what keeps that honest when the write fails.
   *
   * `pickupTimestamp` is written as **epoch milliseconds**. The Alpine toggle wrote
   * `new Date().toISOString()` while a draw wrote `Date.now()`, so the Pickup column was sorting
   * strings against numbers and every manually-marked pickup sorted to one end regardless of when
   * it happened. Reads still go through `toEpoch()` for the records that already hold a string.
   */
  async togglePickup(winner: Winner): Promise<void> {
    const patch: Partial<Winner> = winner.pickedUp
      ? { pickedUp: false, pickupTimestamp: null, pickupStation: null }
      : { pickedUp: true, pickupTimestamp: Date.now(), pickupStation: 'Manual' };

    const previous: Partial<Winner> = {
      pickedUp: winner.pickedUp,
      pickupTimestamp: winner.pickupTimestamp,
      pickupStation: winner.pickupStation ?? null
    };

    data.patchWinner(winner.winnerId, patch);

    try {
      // PUT merges, so only the three fields move — a whole-record POST would race the scanner,
      // which writes the same record from a different station.
      await api.update('winners', winner.winnerId, patch);
    } catch (error) {
      data.patchWinner(winner.winnerId, previous);
      toasts.fromError(error, `Could not update ${winner.displayName}. Nothing was changed.`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Return to list
  // -------------------------------------------------------------------------------------------

  /**
   * Put a winner's entry back into the list it was drawn from.
   *
   * The winner record is deliberately kept: returning someone to the pool is how an unclaimed
   * prize is re-drawn, and the fact that they already won is what the duplicate rules read.
   */
  async returnToList(winner: Winner): Promise<void> {
    const list = data.listById(winner.listId);
    if (!list) {
      toasts.warning(
        `The list "${winner.listName}" no longer exists, so ${winner.displayName} cannot be returned to it.`
      );
      return;
    }

    if (list.entries.some((entry) => entry.id === winner.entryId)) {
      toasts.info(`${winner.displayName} is already in "${list.metadata.name}".`);
      return;
    }

    const confirmed = await ui.confirm({
      title: 'Return to List',
      message: `Return "${winner.displayName}" to the list "${list.metadata.name}"?`,
      details: ['They stay in the winners list and can be drawn again.'],
      confirmText: 'Return',
      variant: 'primary'
    });
    if (!confirmed) return;

    // Re-read across the await: the dialog is modal to the operator, not to a background reload.
    const current = data.listById(winner.listId);
    if (!current) {
      toasts.warning(`The list "${winner.listName}" no longer exists. Nothing was changed.`);
      return;
    }
    if (current.entries.some((entry) => entry.id === winner.entryId)) {
      toasts.info(`${winner.displayName} is already in "${current.metadata.name}".`);
      return;
    }

    const updated: List = {
      ...current,
      entries: [...current.entries, { id: winner.entryId, index: current.entries.length, data: winner.data }],
      metadata: { ...current.metadata, entryCount: current.entries.length + 1 }
    };

    try {
      await api.save('lists', updated);
    } catch (error) {
      data.reportWriteFailure(error, `"${winner.displayName}" to ${current.metadata.name}`);
      return;
    }

    data.upsertList(updated);
    toasts.success(`${winner.displayName} was returned to "${current.metadata.name}".`);
  }

  // -------------------------------------------------------------------------------------------
  // Deleting
  // -------------------------------------------------------------------------------------------

  async deleteWinner(winner: Winner): Promise<void> {
    const confirmed = await ui.confirm({
      title: 'Delete Winner',
      message: `Delete the winner record for ${winner.displayName}?`,
      details: [
        `Prize: ${winner.prize}`,
        'The draw they came from loses this name too, and disappears entirely if they were its only winner.'
      ],
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    const ids = new Set([winner.winnerId]);
    const history = pruneHistory(ids);
    const operations: BatchSaveOperation[] = [
      { collection: 'winners', operation: 'delete', id: winner.winnerId },
      ...history.operations
    ];

    try {
      await data.commit(operations);
    } catch (error) {
      data.reportWriteFailure(error, 'the winner');
      return;
    }

    data.removeWinners(ids);
    for (const entry of history.removed) data.removeHistory(entry.historyId);
    for (const entry of history.updated) data.upsertHistory(entry);

    const restorable: Restorable = { winners: [winner], history: history.originals };
    toasts.success(`${winner.displayName} was deleted.`, {
      label: 'Undo',
      run: () => this.#restore(restorable)
    });
  }

  /**
   * Delete the winners the filters are currently showing — not every winner in the database.
   *
   * "Clear All" under an active filter meaning "clear everything" is the kind of surprise that
   * cannot be taken back, so the dialog names which of the two it is about to do and states the
   * count either way.
   */
  async clearAll(): Promise<void> {
    // Snapshot: `filtered` is derived, and it changes the moment the first record goes.
    const rows = [...winnerFilters.filtered];
    if (rows.length === 0) {
      toasts.warning('There are no winners in the current view to delete.');
      return;
    }

    const isFiltered = rows.length < data.winners.length;
    const count = `${formatNumber(rows.length)} winner ${pluralise(rows.length, 'record')}`;

    const confirmed = await ui.confirm({
      title: isFiltered ? 'Clear Filtered Winners' : 'Clear All Winners',
      // "Delete all 1 winner record?" reads as a bug. Only say "all" when there is more than one.
      message: isFiltered
        ? `Delete the ${count} the current filters are showing?`
        : `Delete ${rows.length > 1 ? 'all ' : 'the '}${count}?`,
      details: [
        isFiltered
          ? `${formatNumber(data.winners.length - rows.length)} other winner ${pluralise(data.winners.length - rows.length, 'record')} will be kept.`
          : 'This is every winner in the database.',
        'The draws they came from lose these names too, and any draw left with no winners is removed.'
      ],
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    const ids = new Set(rows.map((winner) => winner.winnerId));
    // Pruned in the same batch as the deletes, for the same reason a single delete is: a history
    // entry that still names a winner nobody can open is a broken record, not a stale one.
    const history = pruneHistory(ids);
    const operations: BatchSaveOperation[] = [
      ...rows.map((winner) => ({
        collection: 'winners' as const,
        operation: 'delete' as const,
        id: winner.winnerId
      })),
      ...history.operations
    ];

    try {
      await ui.withProgress('Clearing Winners', `Preparing to remove ${count}…`, async (report) => {
        report(30, `Deleting ${count}…`);
        await data.commit(operations);
        report(90, 'Finalising…');
      });
    } catch (error) {
      data.reportWriteFailure(error, 'the winners');
      return;
    }

    data.removeWinners(ids);
    for (const entry of history.removed) data.removeHistory(entry.historyId);
    for (const entry of history.updated) data.upsertHistory(entry);

    const restorable: Restorable = { winners: rows, history: history.originals };
    toasts.success(`Deleted ${count}.`, {
      label: 'Undo',
      run: () => this.#restore(restorable)
    });
  }

  /** Write deleted records back exactly as they were. One batch, so nothing lands half-restored. */
  async #restore({ winners, history }: Restorable): Promise<void> {
    const operations: BatchSaveOperation[] = [
      ...winners.map((winner) => ({
        collection: 'winners' as const,
        data: persistableWinner(winner)
      })),
      ...history.map((entry) => ({
        collection: 'history' as const,
        data: entry as unknown as Record<string, unknown>
      }))
    ];

    try {
      await data.commit(operations);
    } catch (error) {
      toasts.fromError(error, 'Could not restore the deleted records. Nothing was changed.');
      return;
    }

    data.addWinners(winners);
    for (const entry of history) data.upsertHistory(entry);
    toasts.success(`Restored ${formatNumber(winners.length)} winner ${pluralise(winners.length, 'record')}.`);
  }

  // -------------------------------------------------------------------------------------------
  // SMS and export
  // -------------------------------------------------------------------------------------------

  /**
   * Ask the backend to poll the texting provider for every message still in flight.
   *
   * The backend writes the new statuses onto the winner records itself, so the count it returns
   * says how many jobs it looked at and nothing about which rows changed — the reload is what
   * makes the SMS column true.
   */
  async checkSmsStatus(): Promise<void> {
    if (this.#checkingSms) return;
    this.#checkingSms = true;

    try {
      const processed = await api.processTextingQueue();
      await data.reload('winners');

      if (processed > 0) {
        toasts.success(`Checked status for ${processed} pending ${pluralise(processed, 'message')}.`);
      } else {
        toasts.info('No pending SMS messages to check.');
      }
    } catch (error) {
      toasts.fromError(error, 'Could not check SMS status.');
    } finally {
      this.#checkingSms = false;
    }
  }

  /**
   * Export what the operator is looking at.
   *
   * The filtered rows are handed to the exporter rather than letting it rebuild its own
   * predicate — the old one did, ignored the date filter and matched list names that no longer
   * matched, so an export with an archived list selected produced an empty file.
   */
  exportCsv(): void {
    const rows = winnerFilters.filtered;
    if (rows.length === 0) {
      toasts.warning('There are no winners in the current view to export.');
      return;
    }

    exportWinnersCsv(rows);
    toasts.success(`Exported ${formatNumber(rows.length)} ${pluralise(rows.length, 'winner')} to CSV.`);
  }
}

export const winnerActions = new WinnerActionsStore();
