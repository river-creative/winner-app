import { buildEligibility } from '$lib/services/eligibility';
import type { List, Prize } from '$lib/types';
import { Persisted } from '$lib/utils/persisted.svelte';
import { data } from './data.svelte';
import { settings } from './settings.svelte';

export { preventsSamePrize } from '$lib/services/eligibility';

/**
 * What the next draw will run against: which lists, which prize, how many winners.
 *
 * Persisted under the same three keys the Alpine store used — an operator who reloads mid-event
 * must find their setup exactly as they left it.
 */
class SetupStore {
  #selectedListIds = new Persisted<string[]>('setup_selectedListIds', []);
  #selectedPrizeId = new Persisted<string>('setup_selectedPrizeId', '');
  #winnersCount = new Persisted<number>('setup_winnersCount', 1);

  get selectedListIds(): string[] {
    return this.#selectedListIds.current;
  }

  get selectedPrizeId(): string {
    return this.#selectedPrizeId.current;
  }

  get winnersCount(): number {
    return this.#winnersCount.current;
  }

  set winnersCount(value: number) {
    this.#winnersCount.current = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
  }

  /**
   * Selected ids that still exist.
   *
   * A list can be deleted while it is selected. Keeping the stale id in storage is harmless —
   * the operator may undo the delete — but every count and every draw must ignore it.
   */
  readonly validSelectedIds = $derived(
    this.selectedListIds.filter((listId) => data.lists.some((list) => list.listId === listId))
  );

  readonly validSelectedCount = $derived(this.validSelectedIds.length);

  /**
   * Is every list selected?
   *
   * Counted from `validSelectedIds`, so a stale id left in the persisted selection by a deleted
   * list cannot make this read true — the same guard every other count here relies on.
   */
  readonly allListsSelected = $derived(
    data.lists.length > 0 && this.validSelectedCount === data.lists.length
  );

  readonly selectedLists = $derived(
    this.validSelectedIds
      .map((listId) => data.listById(listId))
      .filter((list): list is List => list !== undefined)
  );

  readonly selectedPrize = $derived<Prize | undefined>(
    this.selectedPrizeId ? data.prizeById(this.selectedPrizeId) : undefined
  );

  /**
   * The exact pool the draw will run against.
   *
   * Shared with the draw itself rather than reimplemented, so the count an operator reads before
   * pressing play cannot drift from the number of people actually considered.
   */
  readonly eligibility = $derived(
    buildEligibility(this.selectedLists, this.selectedPrize, data.winners, settings.current.preventSamePrize)
  );

  readonly eligibleEntries = $derived(this.eligibility.candidates.length);
  readonly excludedCount = $derived(this.eligibility.excluded);

  readonly selectedPrizeQuantity = $derived(this.selectedPrize?.quantity ?? 0);
  readonly selectedPrizeDefaultWinners = $derived(this.selectedPrize?.winnersCount ?? 0);

  readonly entriesExceeded = $derived(this.winnersCount > this.eligibleEntries);
  readonly prizeQuantityExceeded = $derived(
    !!this.selectedPrize && this.winnersCount > this.selectedPrizeQuantity
  );
  readonly hasValidationWarning = $derived(this.entriesExceeded || this.prizeQuantityExceeded);

  readonly canStart = $derived(
    this.validSelectedCount > 0 && !!this.selectedPrize && this.winnersCount > 0 && !this.hasValidationWarning
  );

  readonly listDisplayText = $derived.by(() => {
    const lists = this.selectedLists;
    if (lists.length === 0) return 'Not Selected';
    if (lists.length === 1) return lists[0]?.metadata.name ?? 'Not Selected';
    return `${lists.length} Lists Selected`;
  });

  readonly prizeDisplayText = $derived(this.selectedPrize?.name ?? 'Not Selected');

  /** The greatest number of winners this setup could legally draw. */
  readonly maxWinners = $derived.by(() => {
    const byEntries = this.eligibleEntries;
    const byPrize = this.selectedPrize ? this.selectedPrizeQuantity : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(byEntries, byPrize));
  });

  // -------------------------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------------------------

  isListSelected(listId: string): boolean {
    return this.selectedListIds.includes(listId);
  }

  isPrizeSelected(prizeId: string): boolean {
    return String(this.selectedPrizeId) === String(prizeId);
  }

  toggleList(listId: string): void {
    this.#selectedListIds.current = this.isListSelected(listId)
      ? this.selectedListIds.filter((id) => id !== listId)
      : [...this.selectedListIds, listId];
    this.capWinnersCount();
  }

  selectList(listId: string): void {
    if (!this.isListSelected(listId)) this.toggleList(listId);
  }

  /** Called when a list is deleted or archived, so the public view cannot show a phantom pick. */
  deselectList(listId: string): void {
    if (this.isListSelected(listId)) this.toggleList(listId);
  }

  selectAllLists(): void {
    this.#selectedListIds.current = data.lists.map((list) => list.listId);
    this.capWinnersCount();
  }

  clearSelectedLists(): void {
    this.#selectedListIds.current = [];
    this.capWinnersCount();
  }

  /**
   * One control for both directions: select everything, or clear it once everything is selected.
   * Same shape as `toggleList` above — two buttons could not share a phone row with the sort
   * control and Add.
   */
  toggleSelectAllLists(): void {
    if (this.allListsSelected) this.clearSelectedLists();
    else this.selectAllLists();
  }

  /** Selecting a prize adopts its default winner count, when it has one. */
  selectPrize(prizeId: string): void {
    this.#selectedPrizeId.current = this.isPrizeSelected(prizeId) ? '' : prizeId;

    const defaultWinners = this.selectedPrize?.winnersCount;
    if (defaultWinners && defaultWinners > 0) this.winnersCount = defaultWinners;

    this.capWinnersCount();
  }

  /**
   * Bring the winner count back inside what the current lists and prize allow.
   *
   * Called when a constraint changes — a list toggled, a prize picked — rather than from an
   * effect watching the count. An effect that rewrites state it is watching is the pattern the
   * runes model exists to remove, and it also fought the operator mid-keystroke.
   */
  capWinnersCount(): void {
    const max = this.maxWinners;
    if (max > 0 && this.winnersCount > max) this.winnersCount = max;
    if (this.winnersCount < 1) this.winnersCount = 1;
  }

  reset(): void {
    this.#selectedListIds.current = [];
    this.#selectedPrizeId.current = '';
    this.#winnersCount.current = 1;
  }
}

/**
 * Whether a draw should remove its winners from this list.
 *
 * One helper, one default. The old code answered this two different ways — the draw fell back to
 * `settings.preventDuplicates` (default false) and the edit dialog to `true` — so a list could
 * be shown as "removes winners" and then not remove them.
 */
export function removesWinners(list: List): boolean {
  return list.metadata.listSettings?.removeWinnersFromList ?? settings.current.preventDuplicates;
}

export const setup = new SetupStore();
