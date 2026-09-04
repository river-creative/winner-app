import type { BatchSaveOperation, HistoryEntry, Winner } from '$lib/types';
import { formatDate, formatNumber, pluralise } from '$lib/utils/format';
import { data, persistableWinner } from './data.svelte';
import { toasts } from './toasts.svelte';
import { ui } from './ui.svelte';

/**
 * What the History screen does to the data.
 *
 * Only one operation, but it is the one with the rule worth stating in one place: a history entry
 * is not a log line about a draw, it *is* the draw. Deleting it has to take the draw's winners
 * with it, or the Winners screen keeps rows whose batch filter points at nothing and whose prize
 * was never accounted for.
 */
class HistoryActionsStore {
  async deleteSelection(entry: HistoryEntry): Promise<void> {
    const winners = data.winners.filter((winner) => winner.historyId === entry.historyId);
    const drawn = `${formatNumber(winners.length)} winner ${pluralise(winners.length, 'record')}`;

    const confirmed = await ui.confirm({
      title: 'Delete Selection',
      message: `Delete the ${formatDate(entry.timestamp)} draw of "${entry.prize}" from "${entry.listName}"?`,
      details: [
        `A history entry is the record of one draw, so its ${drawn} ${winners.length === 1 ? 'is' : 'are'} deleted with it.`,
        'Prize quantities and list entries are not restored — use Undo on the draw itself for that.'
      ],
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    // One batch: `data/*.json` has no locking, so separate writes to `winners` and `history`
    // could each read the other's stale array, and a failure between them would leave the draw
    // half-deleted.
    const operations: BatchSaveOperation[] = [
      { collection: 'history', operation: 'delete', id: entry.historyId },
      ...winners.map((winner) => ({
        collection: 'winners' as const,
        operation: 'delete' as const,
        id: winner.winnerId
      }))
    ];

    try {
      await data.commit(operations);
    } catch (error) {
      data.reportWriteFailure(error, 'the selection');
      return;
    }

    data.removeHistory(entry.historyId);
    data.removeWinners(new Set(winners.map((winner) => winner.winnerId)));

    toasts.success(`The ${formatDate(entry.timestamp)} draw of "${entry.prize}" was deleted.`, {
      label: 'Undo',
      run: () => this.#restore(entry, winners)
    });
  }

  async #restore(entry: HistoryEntry, winners: Winner[]): Promise<void> {
    const operations: BatchSaveOperation[] = [
      { collection: 'history', data: entry as unknown as Record<string, unknown> },
      ...winners.map((winner) => ({
        collection: 'winners' as const,
        data: persistableWinner(winner)
      }))
    ];

    try {
      await data.commit(operations);
    } catch (error) {
      toasts.fromError(error, 'Could not restore the selection. Nothing was changed.');
      return;
    }

    data.upsertHistory(entry);
    data.addWinners(winners);
    toasts.success(`The draw of "${entry.prize}" was restored.`);
  }
}

export const historyActions = new HistoryActionsStore();
