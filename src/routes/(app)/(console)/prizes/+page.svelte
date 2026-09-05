<script lang="ts">
  import Dropdown from '$lib/components/Dropdown.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import PrizeCard from '$lib/components/prizes/PrizeCard.svelte';
  import PrizeFormDialog from '$lib/components/prizes/PrizeFormDialog.svelte';
  import { PRIZE_SORT_OPTIONS } from '$lib/constants/options';
  import { data } from '$lib/state/data.svelte';
  import { setup } from '$lib/state/setup.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import type { Prize, PrizeSortField, SortDirection } from '$lib/types';
  import { pluralise } from '$lib/utils/format';

  /**
   * Sort lives on the screen, not in a store: nothing outside this page reads it, and it is not
   * worth persisting. The winners and history filters keep their sort the same way.
   */
  let sortField = $state<PrizeSortField>('name');
  let sortDir = $state<SortDirection>('asc');

  let formOpen = $state(false);
  let editingPrize = $state<Prize | null>(null);

  const sortLabel = $derived(PRIZE_SORT_OPTIONS.find((option) => option.field === sortField)?.label ?? '');

  const sortedPrizes = $derived.by(() => {
    const direction = sortDir === 'asc' ? 1 : -1;
    const field = sortField;

    return [...data.prizes].sort((a, b) => {
      switch (field) {
        case 'quantity':
          return direction * (a.quantity - b.quantity);
        case 'date':
          return direction * (a.timestamp - b.timestamp);
        case 'name':
        default:
          return direction * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
    });
  });

  function toggleSort(field: PrizeSortField): void {
    if (sortField === field) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      return;
    }
    sortField = field;
    // Dates read newest-first, names and counts read smallest-first — as in filters.svelte.ts.
    sortDir = field === 'date' ? 'desc' : 'asc';
  }

  function openAdd(): void {
    editingPrize = null;
    formOpen = true;
  }

  function openEdit(prize: Prize): void {
    editingPrize = prize;
    formOpen = true;
  }

  /**
   * The screen's single write path for a prize, used by both add and edit.
   *
   * Optimistic: the grid updates first and the previous record goes back if the write fails, so
   * what is on screen can never disagree with what is stored once this returns.
   */
  async function savePrize(prize: Prize): Promise<boolean> {
    const previous = data.prizeById(prize.prizeId) ?? null;
    data.upsertPrize(prize);

    try {
      await data.commit([{ collection: 'prizes', data: prize as unknown as Record<string, unknown> }]);
      toasts.success(previous ? `Prize "${prize.name}" updated` : `Prize "${prize.name}" added`);
      return true;
    } catch (error) {
      if (previous) data.upsertPrize(previous);
      else data.removePrize(prize.prizeId);
      data.reportWriteFailure(error, 'the prize');
      return false;
    }
  }

  async function deletePrize(prize: Prize): Promise<void> {
    /**
     * Winners record the prize *name*, not its id, so deleting a prize does not orphan them —
     * but it does remove the only place that name can still be drawn from, and the duplicate
     * rule that matches on it. The old delete asked a bare "are you sure?" with no such check,
     * unlike the list delete, which has always warned when a list had winners.
     */
    const awarded = data.winners.filter((winner) => winner.prize === prize.name).length;

    const confirmed = await ui.confirm({
      title: 'Delete Prize',
      message: `Delete "${prize.name}"?`,
      details:
        awarded > 0
          ? [
              `${awarded} ${pluralise(awarded, 'winner has', 'winners have')} already won this prize.`,
              'Their records keep the prize name, but the prize can no longer be drawn or edited.'
            ]
          : undefined,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    data.removePrize(prize.prizeId);

    try {
      await data.commit([{ collection: 'prizes', operation: 'delete', id: prize.prizeId }]);
      toasts.success(`Prize "${prize.name}" deleted`, {
        label: 'Undo',
        run: () => restorePrize(prize)
      });
    } catch (error) {
      data.upsertPrize(prize);
      data.reportWriteFailure(error, 'the prize');
    }
  }

  /**
   * Undo for the delete above. The prize is re-created with its original id, so a prize that is
   * still selected for the next draw comes back selected — `setup` keeps the id either way.
   */
  async function restorePrize(prize: Prize): Promise<void> {
    data.upsertPrize(prize);

    try {
      await data.commit([{ collection: 'prizes', data: prize as unknown as Record<string, unknown> }]);
      toasts.success(`Prize "${prize.name}" restored`);
    } catch (error) {
      data.removePrize(prize.prizeId);
      data.reportWriteFailure(error, 'the prize');
    }
  }
</script>

<svelte:head><title>Prizes · River Winner</title></svelte:head>

<h1 class="visually-hidden">Prize management</h1>

<!--
  A failed load is rendered by the console layout, which shows the error instead of this page.
  That is why "no prizes yet" below can be trusted: it is only ever reached after a load that
  actually succeeded.
-->
<div class="card">
  <div class="card-body">
    <div class="section-toolbar">
      <h5 class="card-title section-toolbar-title">Prize Management</h5>

      {#if data.prizes.length > 0}
        <!-- Pills from md up, the same choice as one dropdown below it. Both drive one state. -->
        <div class="btn-group btn-group-sm d-none d-md-inline-flex" role="group" aria-label="Sort prizes">
          {#each PRIZE_SORT_OPTIONS as option (option.field)}
            {@const active = sortField === option.field}
            <button
              type="button"
              class="btn"
              class:btn-primary={active}
              class:btn-outline-secondary={!active}
              aria-pressed={active}
              onclick={() => toggleSort(option.field)}
            >
              {option.label}
              {#if active}
                <i class="bi {sortDir === 'asc' ? option.asc : option.desc}" aria-hidden="true"></i>
              {/if}
            </button>
          {/each}
        </div>

        <!--
          The classes go on the component's own `.dropdown` element, not on a wrapper: the
          responsive rules select `.section-toolbar > .section-toolbar-sort`, and an extra div
          between them would take the rule while the dropdown inside it kept its intrinsic width.
        -->
        <Dropdown
          class="d-md-none section-toolbar-sort"
          label=""
          buttonClass="btn btn-outline-secondary btn-sm"
          align="start"
          menuClass="dropdown-menu-match-trigger"
          ariaLabel="Change how prizes are sorted"
        >
          {#snippet trigger()}
            <i class="bi me-1 {sortDir === 'asc' ? 'bi-sort-down' : 'bi-sort-up'}" aria-hidden="true"></i>
            Sort: {sortLabel}
          {/snippet}

          {#snippet children(close)}
            {#each PRIZE_SORT_OPTIONS as option (option.field)}
              {@const active = sortField === option.field}
              <li>
                <button
                  type="button"
                  class="dropdown-item d-flex align-items-center justify-content-between"
                  class:active
                  role="menuitem"
                  onclick={() => {
                    toggleSort(option.field);
                    close();
                  }}
                >
                  <span>{option.label}</span>
                  {#if active}
                    <i class="bi {sortDir === 'asc' ? option.asc : option.desc}" aria-hidden="true"></i>
                  {/if}
                </button>
              </li>
            {/each}
          {/snippet}
        </Dropdown>
      {/if}

      <button type="button" class="btn btn-primary" onclick={openAdd}>
        <i class="bi bi-plus-circle me-2" aria-hidden="true"></i>Add Prize
      </button>
    </div>

    {#if data.loading}
      <!-- Skeletons rather than a spinner: the card grid's shape is known before the data is. -->
      <div class="row g-3">
        <span class="visually-hidden" role="status">Loading prizes…</span>
        {#each [0, 1, 2, 3, 4, 5] as slot (slot)}
          <div class="col-md-6 col-lg-4" aria-hidden="true">
            <div class="card h-100 placeholder-glow">
              <div class="card-header"><span class="placeholder col-7"></span></div>
              <div class="card-body">
                <span class="placeholder col-10"></span>
                <span class="placeholder col-5"></span>
                <span class="placeholder col-4 mt-3"></span>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else if data.prizes.length === 0}
      <EmptyState icon="bi-gift" title="No prizes added yet">
        {#snippet action()}
          <button type="button" class="btn btn-primary" onclick={openAdd}>
            <i class="bi bi-plus-circle me-2" aria-hidden="true"></i>Add your first prize
          </button>
        {/snippet}
      </EmptyState>
    {:else}
      <!--
        The select toggle needs no optimistic handling: `setup.selectPrize` writes only local
        state (persisted to localStorage), so there is no request that could fail and nothing to
        roll back.
      -->
      <div class="row g-3">
        {#each sortedPrizes as prize (prize.prizeId)}
          <div class="col-md-6 col-lg-4">
            <PrizeCard
              {prize}
              selected={setup.isPrizeSelected(prize.prizeId)}
              onselect={() => setup.selectPrize(prize.prizeId)}
              onedit={() => openEdit(prize)}
              ondelete={() => void deletePrize(prize)}
            />
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!--
  Mounted only while open, so each opening builds its fields from the record it was given rather
  than needing an effect to copy the record into form state.
-->
{#if formOpen}
  <PrizeFormDialog prize={editingPrize} onsave={savePrize} onclose={() => (formOpen = false)} />
{/if}
