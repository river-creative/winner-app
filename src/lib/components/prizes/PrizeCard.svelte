<script lang="ts">
  import type { Prize } from '$lib/types';
  import { formatDate, formatNumber, pluralise } from '$lib/utils/format';

  interface Props {
    prize: Prize;
    /** Whether this is the prize the next draw will run for. */
    selected: boolean;
    onselect: () => void;
    onedit: () => void;
    ondelete: () => void;
  }

  let { prize, selected, onselect, onedit, ondelete }: Props = $props();
</script>

<!--
  Presentational only: it reads nothing global and writes nothing. The Prizes screen owns the
  selection and the writes, so this card can be rendered anywhere — including in a test — without
  dragging the whole store in behind it.
-->
<div class="card h-100 prize-card" class:border-selected={selected}>
  <div class="card-header">
    <div class="d-flex justify-content-between align-items-center">
      <!-- `title` is what makes a truncated name readable at all; it is the only affordance here. -->
      <h6 class="card-title mb-0 text-truncate" title={prize.name}>{prize.name}</h6>
      <div>
        {#if selected}
          <span class="badge badge-selection me-1">
            <i class="bi bi-check-circle-fill" aria-hidden="true"></i>
            <span class="visually-hidden">Selected for the next draw</span>
          </span>
        {/if}
        <span class="badge bg-secondary">
          {formatNumber(prize.quantity)}
          <span class="visually-hidden">{pluralise(prize.quantity, 'prize')} available</span>
        </span>
      </div>
    </div>
  </div>

  <div class="card-body d-flex flex-column">
    {#if prize.description}
      <p class="card-text text-muted small mb-2">{prize.description}</p>
    {/if}

    <div class="d-flex justify-content-between align-items-center small text-muted mb-2">
      <span>Added {formatDate(prize.timestamp)}</span>
      {#if prize.winnersCount}
        <span class="badge bg-light text-muted prize-winners-badge">
          {formatNumber(prize.winnersCount)}
          {pluralise(prize.winnersCount, 'winner')}
        </span>
      {/if}
    </div>

    <div class="mt-auto pt-2">
      <div class="d-flex justify-content-between align-items-center">
        <button
          type="button"
          class="btn btn-sm"
          class:btn-selection={selected}
          class:btn-outline-selection={!selected}
          aria-pressed={selected}
          onclick={onselect}
        >
          <i
            class="bi"
            class:bi-check-circle-fill={selected}
            class:bi-check-circle={!selected}
            aria-hidden="true"
          ></i>
          <span class="ms-1">{selected ? 'Selected' : 'Select'}</span>
        </button>

        <div class="btn-group btn-group-sm">
          <button
            type="button"
            class="btn btn-outline-secondary"
            title="Edit prize"
            aria-label="Edit {prize.name}"
            onclick={onedit}
          >
            <i class="bi bi-pencil" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="btn btn-outline-danger"
            title="Delete prize"
            aria-label="Delete {prize.name}"
            onclick={ondelete}
          >
            <i class="bi bi-trash" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  /* Was an inline `style="font-size: 0.8rem"` in the Alpine markup. */
  .prize-winners-badge {
    font-size: 0.8rem;
  }
</style>
