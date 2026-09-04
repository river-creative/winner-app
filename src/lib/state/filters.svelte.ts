import type { HistoryEntry, HistorySortField, SortDirection, Winner, WinnerSortField } from '$lib/types';
import { formatDate, toDateInputValue, toEpoch } from '$lib/utils/format';
import { Persisted } from '$lib/utils/persisted.svelte';
import { data } from './data.svelte';

/** Does this record fall on the day the operator picked? Empty filter matches everything. */
function matchesDate(timestamp: number, filterDate: string): boolean {
  if (!filterDate) return true;
  return toDateInputValue(timestamp) === filterDate;
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

// ---------------------------------------------------------------------------------------------
// Winners
// ---------------------------------------------------------------------------------------------

class WinnerFilterStore {
  #prize = new Persisted<string>('winners_filter_prize', '', { raw: true });
  #list = new Persisted<string>('winners_filter_list', '', { raw: true });
  #batch = new Persisted<string>('winners_filter_batch', '', { raw: true });
  #date = new Persisted<string>('winners_filter_date', '', { raw: true });

  #sortField = $state<WinnerSortField>('date');
  #sortDir = $state<SortDirection>('desc');

  get prize(): string {
    return this.#prize.current;
  }
  set prize(value: string) {
    this.#prize.current = value;
  }

  get list(): string {
    return this.#list.current;
  }
  set list(value: string) {
    this.#list.current = value;
  }

  get batch(): string {
    return this.#batch.current;
  }
  set batch(value: string) {
    this.#batch.current = value;
  }

  get date(): string {
    return this.#date.current;
  }
  set date(value: string) {
    this.#date.current = value;
  }

  get sortField(): WinnerSortField {
    return this.#sortField;
  }
  get sortDir(): SortDirection {
    return this.#sortDir;
  }

  readonly hasFilters = $derived(!!(this.prize || this.list || this.batch || this.date));

  /**
   * Apply every filter except one.
   *
   * The dropdowns cascade: the list of prizes worth offering is the set of prizes present under
   * the *other* filters. Excluding the dropdown's own filter is what stops picking a value from
   * removing every other option, including the one just picked.
   */
  #applyExcept(exclude: 'prize' | 'list' | 'batch' | 'date' | null): Winner[] {
    return data.winners.filter((winner) => {
      if (exclude !== 'prize' && this.prize && winner.prize !== this.prize) return false;
      if (exclude !== 'list' && this.list && winner.listName !== this.list) return false;
      if (exclude !== 'batch' && this.batch && winner.historyId !== this.batch) return false;
      if (exclude !== 'date' && !matchesDate(winner.timestamp, this.date)) return false;
      return true;
    });
  }

  readonly filtered = $derived.by(() => {
    const rows = this.#applyExcept(null);
    const direction = this.#sortDir === 'asc' ? 1 : -1;
    const field = this.#sortField;

    return [...rows].sort((a, b) => {
      switch (field) {
        case 'name':
          return direction * compareStrings(a.displayName, b.displayName);
        case 'prize':
          return direction * compareStrings(a.prize, b.prize);
        case 'list':
          return direction * compareStrings(a.listName, b.listName);
        case 'pickup':
          return direction * ((toEpoch(a.pickupTimestamp) ?? 0) - (toEpoch(b.pickupTimestamp) ?? 0));
        case 'sms':
          return direction * compareStrings(a.sms?.status ?? '', b.sms?.status ?? '');
        case 'date':
        default:
          return direction * (a.timestamp - b.timestamp);
      }
    });
  });

  /** Prize names still reachable, plus whatever is currently picked so it cannot disappear. */
  readonly uniquePrizes = $derived(
    unique(
      this.#applyExcept('prize').map((winner) => winner.prize),
      this.prize
    )
  );

  readonly uniqueLists = $derived(
    unique(
      this.#applyExcept('list').map((winner) => winner.listName),
      this.list
    )
  );

  /** One entry per draw, labelled by the day and the prize, newest first. */
  readonly uniqueBatches = $derived.by(() => {
    const rows = this.#applyExcept('batch');
    const batches = new Map<string, { id: string; label: string; timestamp: number }>();

    for (const winner of rows) {
      if (!winner.historyId || batches.has(winner.historyId)) continue;
      batches.set(winner.historyId, {
        id: winner.historyId,
        label: `${formatDate(winner.timestamp)} - ${winner.prize}`,
        timestamp: winner.timestamp
      });
    }

    // The selected batch may not survive the other filters; keep it so the <select> stays valid.
    if (this.batch && !batches.has(this.batch)) {
      const selected = data.winners.find((winner) => winner.historyId === this.batch);
      if (selected) {
        batches.set(this.batch, {
          id: this.batch,
          label: `${formatDate(selected.timestamp)} - ${selected.prize}`,
          timestamp: selected.timestamp
        });
      }
    }

    return [...batches.values()].sort((a, b) => b.timestamp - a.timestamp);
  });

  toggleSort(field: WinnerSortField): void {
    if (this.#sortField === field) {
      this.#sortDir = this.#sortDir === 'asc' ? 'desc' : 'asc';
      return;
    }
    this.#sortField = field;
    // Dates read newest-first; names read A-Z.
    this.#sortDir = field === 'date' || field === 'pickup' ? 'desc' : 'asc';
  }

  clear(): void {
    this.prize = '';
    this.list = '';
    this.batch = '';
    this.date = '';
  }
}

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------

class HistoryFilterStore {
  #list = new Persisted<string>('history_filter_list', '', { raw: true });
  #prize = new Persisted<string>('history_filter_prize', '', { raw: true });
  #date = new Persisted<string>('history_filter_date', '', { raw: true });

  #sortField = $state<HistorySortField>('date');
  #sortDir = $state<SortDirection>('desc');

  get list(): string {
    return this.#list.current;
  }
  set list(value: string) {
    this.#list.current = value;
  }

  get prize(): string {
    return this.#prize.current;
  }
  set prize(value: string) {
    this.#prize.current = value;
  }

  get date(): string {
    return this.#date.current;
  }
  set date(value: string) {
    this.#date.current = value;
  }

  get sortField(): HistorySortField {
    return this.#sortField;
  }
  get sortDir(): SortDirection {
    return this.#sortDir;
  }

  readonly hasFilters = $derived(!!(this.list || this.prize || this.date));

  #applyExcept(exclude: 'list' | 'prize' | 'date' | null): HistoryEntry[] {
    return data.history.filter((entry) => {
      if (exclude !== 'list' && this.list && entry.listName !== this.list) return false;
      if (exclude !== 'prize' && this.prize && entry.prize !== this.prize) return false;
      if (exclude !== 'date' && !matchesDate(entry.timestamp, this.date)) return false;
      return true;
    });
  }

  readonly filtered = $derived.by(() => {
    const rows = this.#applyExcept(null);
    const direction = this.#sortDir === 'asc' ? 1 : -1;
    const field = this.#sortField;

    return [...rows].sort((a, b) => {
      switch (field) {
        case 'list':
          return direction * compareStrings(a.listName, b.listName);
        case 'prize':
          return direction * compareStrings(a.prize, b.prize);
        case 'count':
          return direction * (a.winners.length - b.winners.length);
        case 'date':
        default:
          return direction * (a.timestamp - b.timestamp);
      }
    });
  });

  readonly uniqueLists = $derived(
    unique(
      this.#applyExcept('list').map((entry) => entry.listName),
      this.list
    )
  );

  readonly uniquePrizes = $derived(
    unique(
      this.#applyExcept('prize').map((entry) => entry.prize),
      this.prize
    )
  );

  /** The four cards above the table. Computed over every draw, not the filtered subset. */
  readonly stats = $derived.by(() => {
    const entries = data.history;
    const totalSelections = entries.length;
    const totalWinners = data.winners.length;
    const averageWinners = totalSelections > 0 ? Math.round((totalWinners / totalSelections) * 10) / 10 : 0;

    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.prize, (counts.get(entry.prize) ?? 0) + 1);

    let mostUsedPrize = '—';
    let best = 0;
    for (const [prize, count] of counts) {
      if (count > best) {
        best = count;
        mostUsedPrize = prize;
      }
    }

    return { totalSelections, totalWinners, averageWinners, mostUsedPrize };
  });

  toggleSort(field: HistorySortField): void {
    if (this.#sortField === field) {
      this.#sortDir = this.#sortDir === 'asc' ? 'desc' : 'asc';
      return;
    }
    this.#sortField = field;
    this.#sortDir = field === 'date' || field === 'count' ? 'desc' : 'asc';
  }

  clear(): void {
    this.list = '';
    this.prize = '';
    this.date = '';
  }
}

/** Distinct, sorted, and never dropping the value the operator has currently selected. */
function unique(values: string[], keep: string): string[] {
  const set = new Set(values.filter(Boolean));
  if (keep) set.add(keep);
  return [...set].sort(compareStrings);
}

export const winnerFilters = new WinnerFilterStore();
export const historyFilters = new HistoryFilterStore();
