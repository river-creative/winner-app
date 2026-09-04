<script lang="ts">
  import { data } from '$lib/state/data.svelte';
  import { winnerFilters } from '$lib/state/filters.svelte';
  import { formatNumber, pluralise } from '$lib/utils/format';

  // One call per component is all Svelte allows; the four controls suffix it.
  const uid = $props.id();

  const shown = $derived(winnerFilters.filtered.length);
  const total = $derived(data.winners.length);
</script>

<div class="row mb-2">
  <div class="col-12">
    <span class="form-label">Filters</span>
  </div>
</div>

<!--
  The four dropdowns cascade: each one offers the values still reachable under the *other*
  filters, so picking one can never empty the rest. That logic lives in `winnerFilters`, which
  is also what makes the selected value survive a filter that would otherwise remove it.

  Labels are visually hidden rather than absent — the option text ("All Prizes") reads as a
  label to a sighted operator but tells a screen reader nothing about what the control changes.
-->
<div class="row mb-3 g-2">
  <div class="col-md">
    <label class="form-label visually-hidden" for="{uid}-prize">Filter by prize</label>
    <select id="{uid}-prize" class="form-select form-select-sm" bind:value={winnerFilters.prize}>
      <option value="">All Prizes</option>
      {#each winnerFilters.uniquePrizes as prize (prize)}
        <option value={prize}>{prize}</option>
      {/each}
    </select>
  </div>

  <div class="col-md">
    <label class="form-label visually-hidden" for="{uid}-list">Filter by list</label>
    <select id="{uid}-list" class="form-select form-select-sm" bind:value={winnerFilters.list}>
      <option value="">All Lists</option>
      {#each winnerFilters.uniqueLists as list (list)}
        <option value={list}>{list}</option>
      {/each}
    </select>
  </div>

  <div class="col-md">
    <label class="form-label visually-hidden" for="{uid}-batch">Filter by draw</label>
    <select id="{uid}-batch" class="form-select form-select-sm" bind:value={winnerFilters.batch}>
      <option value="">All Batches</option>
      {#each winnerFilters.uniqueBatches as batch (batch.id)}
        <option value={batch.id}>{batch.label}</option>
      {/each}
    </select>
  </div>

  <div class="col-md">
    <label class="form-label visually-hidden" for="{uid}-date">Filter by date</label>
    <input id="{uid}-date" type="date" class="form-control form-control-sm" bind:value={winnerFilters.date} />
  </div>

  <div class="col-md-auto">
    <button
      type="button"
      class="btn btn-sm btn-outline-secondary"
      disabled={!winnerFilters.hasFilters}
      onclick={() => winnerFilters.clear()}
    >
      <i class="bi bi-x-circle me-1" aria-hidden="true"></i>Clear All
    </button>
  </div>
</div>

<div class="d-flex justify-content-between align-items-center mb-2 text-muted">
  <!-- Announced, because changing a filter changes this line and nothing else a screen reader
       would notice: the table's own rows are not in an announced region. -->
  <small aria-live="polite">
    Showing {formatNumber(shown)} of {formatNumber(total)}
    {pluralise(total, 'winner')}
  </small>
</div>
