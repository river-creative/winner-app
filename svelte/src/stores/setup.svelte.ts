import { persistedState } from 'svelte-persisted-state';
import { dataStore } from './data.svelte';
import { settingsStore } from './settings.svelte';

/**
 * Setup Store
 * Manages the quick setup selection state with derived/computed values
 * Uses svelte-persisted-state for localStorage persistence
 */
class SetupStore {
	// Persisted selection state
	private _selectedListIds = persistedState<string[]>('setup_selectedListIds', []);
	private _selectedPrizeId = persistedState<string>('setup_selectedPrizeId', '');
	private _winnersCount = persistedState<number>('setup_winnersCount', 1);

	// Getters/setters using .current property
	get selectedListIds(): string[] {
		return this._selectedListIds.current;
	}
	set selectedListIds(value: string[]) {
		this._selectedListIds.current = value;
	}

	get selectedPrizeId(): string {
		return this._selectedPrizeId.current;
	}
	set selectedPrizeId(value: string) {
		this._selectedPrizeId.current = value;
	}

	get winnersCount(): number {
		return this._winnersCount.current;
	}
	set winnersCount(value: number) {
		this._winnersCount.current = value;
	}

	/**
	 * Computed: Calculate eligible entries from selected lists
	 * Accounts for preventSamePrize exclusions
	 */
	get eligibleEntries(): number {
		const selectedIds = this._selectedListIds.current;
		const prizeId = this._selectedPrizeId.current;

		// Calculate total entries from selected lists
		let total = selectedIds.reduce((sum, listId) => {
			const list = dataStore.lists.find((l) => l.listId === listId);
			return sum + (list?.entries?.length || 0);
		}, 0);

		// If preventSamePrize is enabled and a prize is selected, calculate exclusions
		if (settingsStore.preventSamePrize && prizeId) {
			const prize = dataStore.prizes.find((p) => p.prizeId === prizeId);
			const prizeName = prize?.name;

			if (prizeName && dataStore.winners.length > 0) {
				// Find entry IDs that already won this prize
				const samePrizeWinnerEntryIds = new Set(
					dataStore.winners
						.filter((w) => w.prize === prizeName)
						.map((w) => w.entryId)
						.filter(Boolean)
				);

				if (samePrizeWinnerEntryIds.size > 0) {
					// Recount entries excluding same-prize winners
					let eligible = 0;
					for (const listId of selectedIds) {
						const list = dataStore.lists.find((l) => l.listId === listId);
						if (list?.entries) {
							for (const entry of list.entries) {
								const entryId =
									entry.id ||
									(entry.data?.['Ticket Code'] as string) ||
									(entry.data?.ticketCode as string);
								if (!entryId || !samePrizeWinnerEntryIds.has(entryId)) {
									eligible++;
								}
							}
						}
					}
					total = eligible;
				}
			}
		}

		return total;
	}

	/**
	 * Computed: Count of entries excluded due to same prize
	 */
	get excludedCount(): number {
		const prizeId = this._selectedPrizeId.current;
		const selectedIds = this._selectedListIds.current;

		if (!settingsStore.preventSamePrize || !prizeId) {
			return 0;
		}

		const prize = dataStore.prizes.find((p) => p.prizeId === prizeId);
		const prizeName = prize?.name;

		if (!prizeName || dataStore.winners.length === 0) {
			return 0;
		}

		const samePrizeWinnerEntryIds = new Set(
			dataStore.winners
				.filter((w) => w.prize === prizeName)
				.map((w) => w.entryId)
				.filter(Boolean)
		);

		let excluded = 0;
		for (const listId of selectedIds) {
			const list = dataStore.lists.find((l) => l.listId === listId);
			if (list?.entries) {
				for (const entry of list.entries) {
					const entryId =
						entry.id ||
						(entry.data?.['Ticket Code'] as string) ||
						(entry.data?.ticketCode as string);
					if (entryId && samePrizeWinnerEntryIds.has(entryId)) {
						excluded++;
					}
				}
			}
		}

		return excluded;
	}

	/**
	 * Computed: Can start selection (has list and prize selected)
	 */
	get canStart(): boolean {
		return this._selectedListIds.current.length > 0 && !!this._selectedPrizeId.current;
	}

	/**
	 * Computed: Display text for selected list(s)
	 */
	get listDisplayText(): string {
		const selectedIds = this._selectedListIds.current;
		if (selectedIds.length === 0) return 'Not Selected';
		if (selectedIds.length === 1) {
			const list = dataStore.lists.find((l) => l.listId === selectedIds[0]);
			return list?.metadata?.name || 'Unknown';
		}
		return `${selectedIds.length} Lists Selected`;
	}

	/**
	 * Computed: Display text for selected prize
	 */
	get prizeDisplayText(): string {
		const prizeId = this._selectedPrizeId.current;
		if (!prizeId) return 'Not Selected';
		const prize = dataStore.prizes.find((p) => p.prizeId === prizeId);
		return prize?.name || 'Not Selected';
	}

	/**
	 * Computed: Selected prize quantity
	 */
	get selectedPrizeQuantity(): number | null {
		const prizeId = this._selectedPrizeId.current;
		if (!prizeId) return null;
		const prize = dataStore.prizes.find((p) => p.prizeId === prizeId);
		return prize?.quantity ?? null;
	}

	/**
	 * Computed: Selected prize's default winners count
	 */
	get selectedPrizeDefaultWinners(): number | null {
		const prizeId = this._selectedPrizeId.current;
		if (!prizeId) return null;
		const prize = dataStore.prizes.find((p) => p.prizeId === prizeId);
		return prize?.winnersCount ?? null;
	}

	/**
	 * Computed: Winners count exceeds eligible entries
	 */
	get entriesExceeded(): boolean {
		if (this._selectedListIds.current.length === 0) return false;
		return this._winnersCount.current > this.eligibleEntries;
	}

	/**
	 * Computed: Winners count exceeds prize quantity
	 */
	get prizeQuantityExceeded(): boolean {
		const qty = this.selectedPrizeQuantity;
		if (qty === null) return false;
		return this._winnersCount.current > qty;
	}

	/**
	 * Computed: Has any validation warning
	 */
	get hasValidationWarning(): boolean {
		return this.entriesExceeded || this.prizeQuantityExceeded;
	}

	/**
	 * Computed: Count of selected lists that are still valid
	 */
	get validSelectedCount(): number {
		const validIds = dataStore.lists.map((l) => l.listId);
		return this._selectedListIds.current.filter((id) => validIds.includes(id)).length;
	}

	/**
	 * Check if a list is selected
	 */
	isListSelected(listId: string): boolean {
		return this._selectedListIds.current.includes(listId);
	}

	/**
	 * Toggle list selection
	 */
	toggleList(listId: string): void {
		const currentIds = this._selectedListIds.current;
		if (currentIds.includes(listId)) {
			this.selectedListIds = currentIds.filter((id) => id !== listId);
		} else {
			this.selectedListIds = [...currentIds, listId];
		}
	}

	/**
	 * Select a list
	 */
	selectList(listId: string): void {
		if (!this._selectedListIds.current.includes(listId)) {
			this.selectedListIds = [...this._selectedListIds.current, listId];
		}
	}

	/**
	 * Deselect a list
	 */
	deselectList(listId: string): void {
		if (this._selectedListIds.current.includes(listId)) {
			this.selectedListIds = this._selectedListIds.current.filter((id) => id !== listId);
		}
	}

	/**
	 * Handle prize change - update winnersCount from prize default
	 */
	onPrizeChange(): void {
		const prizeId = this._selectedPrizeId.current;
		if (prizeId) {
			const prize = dataStore.prizes.find((p) => p.prizeId === prizeId);
			if (prize?.winnersCount) {
				this.winnersCount = prize.winnersCount;
			}
		}
		this.capWinnersCount();
	}

	/**
	 * Cap winnersCount to not exceed eligibleEntries or prizeQuantity
	 */
	capWinnersCount(): void {
		const currentCount = this._winnersCount.current;

		// Cap to eligibleEntries if exceeded (and entries exist)
		if (this.eligibleEntries > 0 && currentCount > this.eligibleEntries) {
			this.winnersCount = this.eligibleEntries;
		}
		// Cap to prize quantity if exceeded (and quantity is set)
		const prizeQty = this.selectedPrizeQuantity;
		if (prizeQty !== null && this._winnersCount.current > prizeQty) {
			this.winnersCount = prizeQty;
		}
	}

	/**
	 * Clear all selections
	 */
	clearSelections(): void {
		this._selectedListIds.reset();
		this._selectedPrizeId.reset();
		this._winnersCount.reset();
	}
}

// Export singleton instance
export const setupStore = new SetupStore();
