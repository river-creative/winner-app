import { persistedState } from 'svelte-persisted-state';
import { dataStore } from './data.svelte';
import type {
	Winner,
	HistoryEntry,
	WinnerSortField,
	HistorySortField,
	SortDirection
} from '$types';

/**
 * Winners Filter Store
 * Manages filtering and sorting for winners list
 * Uses svelte-persisted-state for localStorage persistence
 */
class WinnersFilterStore {
	// Filter state (persisted)
	private _filterPrize = persistedState('winners_filter_prize', '');
	private _filterList = persistedState('winners_filter_list', '');
	private _filterBatch = persistedState('winners_filter_batch', '');
	private _filterDate = persistedState('winners_filter_date', '');

	// Sort state (not persisted - transient)
	private _sortField = $state<WinnerSortField>('date');
	private _sortDir = $state<SortDirection>('desc');

	// Getters/setters for persisted filters
	get filterPrize(): string {
		return this._filterPrize.current;
	}
	set filterPrize(value: string) {
		this._filterPrize.current = value;
	}

	get filterList(): string {
		return this._filterList.current;
	}
	set filterList(value: string) {
		this._filterList.current = value;
	}

	get filterBatch(): string {
		return this._filterBatch.current;
	}
	set filterBatch(value: string) {
		this._filterBatch.current = value;
	}

	get filterDate(): string {
		return this._filterDate.current;
	}
	set filterDate(value: string) {
		this._filterDate.current = value;
	}

	// Getters/setters for transient sort state
	get sortField(): WinnerSortField {
		return this._sortField;
	}
	set sortField(value: WinnerSortField) {
		this._sortField = value;
	}

	get sortDir(): SortDirection {
		return this._sortDir;
	}
	set sortDir(value: SortDirection) {
		this._sortDir = value;
	}

	/**
	 * Computed: Filtered and sorted winners
	 */
	get filtered(): Winner[] {
		let results = [...dataStore.winners];

		// Apply filters
		if (this.filterPrize) {
			results = results.filter((w) => w.prize === this.filterPrize);
		}
		if (this.filterList) {
			results = results.filter((w) => w.listName === this.filterList);
		}
		if (this.filterBatch) {
			results = results.filter((w) => w.historyId === this.filterBatch);
		}
		if (this.filterDate) {
			results = results.filter((w) => {
				const winnerDate = new Date(w.timestamp).toISOString().split('T')[0];
				return winnerDate === this.filterDate;
			});
		}

		// Sort
		const dir = this.sortDir === 'asc' ? 1 : -1;
		results.sort((a, b) => {
			switch (this.sortField) {
				case 'date':
					return (a.timestamp - b.timestamp) * dir;
				case 'name':
					return a.displayName.localeCompare(b.displayName) * dir;
				case 'prize':
					return a.prize.localeCompare(b.prize) * dir;
				case 'list':
					return a.listName.localeCompare(b.listName) * dir;
				case 'pickup':
					return (Number(a.pickedUp) - Number(b.pickedUp)) * dir;
				case 'sms':
					return (a.sms?.status || '').localeCompare(b.sms?.status || '') * dir;
				default:
					return 0;
			}
		});

		return results;
	}

	/**
	 * Get items filtered by all filters EXCEPT the specified one.
	 * This enables cascading dropdowns where each dropdown shows only
	 * values that exist within the constraints of other active filters.
	 */
	getItemsExcludingFilter(excludeFilter: 'prize' | 'list' | 'batch' | 'date'): Winner[] {
		return dataStore.winners.filter((w) => {
			if (excludeFilter !== 'prize' && this.filterPrize && w.prize !== this.filterPrize)
				return false;
			if (excludeFilter !== 'list' && this.filterList && w.listName !== this.filterList)
				return false;
			if (excludeFilter !== 'batch' && this.filterBatch && w.historyId !== this.filterBatch)
				return false;
			if (excludeFilter !== 'date' && this.filterDate) {
				const winnerDate = new Date(w.timestamp).toISOString().split('T')[0];
				if (winnerDate !== this.filterDate) return false;
			}
			return true;
		});
	}

	/**
	 * Computed: Unique prize names (cascading - respects other active filters)
	 */
	get uniquePrizes(): string[] {
		const items = this.getItemsExcludingFilter('prize');
		const prizes = [...new Set(items.map((w) => w.prize))].sort();
		// Always include currently selected value even if filtered out
		if (this.filterPrize && !prizes.includes(this.filterPrize)) {
			prizes.unshift(this.filterPrize);
		}
		return prizes;
	}

	/**
	 * Computed: Unique list names (cascading - respects other active filters)
	 */
	get uniqueLists(): string[] {
		const items = this.getItemsExcludingFilter('list');
		const lists = [...new Set(items.map((w) => w.listName))].sort();
		// Always include currently selected value even if filtered out
		if (this.filterList && !lists.includes(this.filterList)) {
			lists.unshift(this.filterList);
		}
		return lists;
	}

	/**
	 * Computed: Unique batches with labels (cascading - respects other active filters)
	 */
	get uniqueBatches(): Array<{ id: string; label: string }> {
		const items = this.getItemsExcludingFilter('batch');
		const batches = new Map<string, string>();
		for (const winner of items) {
			if (winner.historyId && !batches.has(winner.historyId)) {
				const date = new Date(winner.timestamp).toLocaleDateString();
				batches.set(winner.historyId, `${date} - ${winner.prize}`);
			}
		}
		const result = Array.from(batches.entries())
			.map(([id, label]) => ({ id, label }))
			.sort((a, b) => b.id.localeCompare(a.id));
		// Always include currently selected value even if filtered out
		if (this.filterBatch && !result.find((b) => b.id === this.filterBatch)) {
			result.unshift({ id: this.filterBatch, label: this.filterBatch });
		}
		return result;
	}

	/**
	 * Toggle sort field/direction
	 */
	toggleSort(field: WinnerSortField): void {
		if (this.sortField === field) {
			this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			this.sortField = field;
			this.sortDir = field === 'date' ? 'desc' : 'asc';
		}
	}

	/**
	 * Clear all filters
	 */
	clearFilters(): void {
		this._filterPrize.reset();
		this._filterList.reset();
		this._filterBatch.reset();
		this._filterDate.reset();
	}
}

/**
 * History Filter Store
 * Manages filtering and sorting for history list
 * Uses svelte-persisted-state for localStorage persistence
 */
class HistoryFilterStore {
	// Filter state (persisted)
	private _filterList = persistedState('history_filter_list', '');
	private _filterPrize = persistedState('history_filter_prize', '');
	private _filterDate = persistedState('history_filter_date', '');

	// Sort state (not persisted - transient)
	private _sortField = $state<HistorySortField>('date');
	private _sortDir = $state<SortDirection>('desc');

	// Getters/setters for persisted filters
	get filterList(): string {
		return this._filterList.current;
	}
	set filterList(value: string) {
		this._filterList.current = value;
	}

	get filterPrize(): string {
		return this._filterPrize.current;
	}
	set filterPrize(value: string) {
		this._filterPrize.current = value;
	}

	get filterDate(): string {
		return this._filterDate.current;
	}
	set filterDate(value: string) {
		this._filterDate.current = value;
	}

	// Getters/setters for transient sort state
	get sortField(): HistorySortField {
		return this._sortField;
	}
	set sortField(value: HistorySortField) {
		this._sortField = value;
	}

	get sortDir(): SortDirection {
		return this._sortDir;
	}
	set sortDir(value: SortDirection) {
		this._sortDir = value;
	}

	/**
	 * Computed: Filtered and sorted history
	 */
	get filtered(): HistoryEntry[] {
		let results = [...dataStore.history];

		// Apply filters
		if (this.filterList) {
			results = results.filter((h) => h.listName === this.filterList);
		}
		if (this.filterPrize) {
			results = results.filter((h) => h.prizeName === this.filterPrize);
		}
		if (this.filterDate) {
			results = results.filter((h) => {
				const historyDate = new Date(h.timestamp).toISOString().split('T')[0];
				return historyDate === this.filterDate;
			});
		}

		// Sort
		const dir = this.sortDir === 'asc' ? 1 : -1;
		results.sort((a, b) => {
			switch (this.sortField) {
				case 'date':
					return (a.timestamp - b.timestamp) * dir;
				case 'list':
					return a.listName.localeCompare(b.listName) * dir;
				case 'prize':
					return a.prizeName.localeCompare(b.prizeName) * dir;
				case 'count':
					return (a.winnersCount - b.winnersCount) * dir;
				default:
					return 0;
			}
		});

		return results;
	}

	/**
	 * Computed: Unique list names from history
	 */
	get uniqueLists(): string[] {
		return [...new Set(dataStore.history.map((h) => h.listName))].sort();
	}

	/**
	 * Computed: Unique prize names from history
	 */
	get uniquePrizes(): string[] {
		return [...new Set(dataStore.history.map((h) => h.prizeName))].sort();
	}

	/**
	 * Computed: Statistics
	 */
	get stats(): { totalSelections: number; mostUsedPrize: string } {
		const history = dataStore.history;
		const prizeCount = new Map<string, number>();

		for (const h of history) {
			prizeCount.set(h.prizeName, (prizeCount.get(h.prizeName) || 0) + 1);
		}

		let mostUsedPrize = '';
		let maxCount = 0;
		for (const [prize, count] of prizeCount.entries()) {
			if (count > maxCount) {
				maxCount = count;
				mostUsedPrize = prize;
			}
		}

		return {
			totalSelections: history.length,
			mostUsedPrize
		};
	}

	/**
	 * Toggle sort field/direction
	 */
	toggleSort(field: HistorySortField): void {
		if (this.sortField === field) {
			this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			this.sortField = field;
			this.sortDir = field === 'date' ? 'desc' : 'asc';
		}
	}

	/**
	 * Clear all filters
	 */
	clearFilters(): void {
		this._filterList.reset();
		this._filterPrize.reset();
		this._filterDate.reset();
	}
}

// Export singleton instances
export const winnersFilterStore = new WinnersFilterStore();
export const historyFilterStore = new HistoryFilterStore();
