<script lang="ts">
  import Dropdown from '$lib/components/Dropdown.svelte';
  import { winnerActions } from '$lib/state/winners.svelte';

  const checking = $derived(winnerActions.checkingSms);
</script>

<div class="section-toolbar">
  <h5 class="card-title section-toolbar-title">All Winners</h5>

  <Dropdown label="Actions" buttonClass="btn btn-primary" align="end">
    {#snippet trigger()}
      {#if checking}
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        <span class="visually-hidden">Checking SMS status. </span>
      {:else}
        <i class="bi bi-gear me-2" aria-hidden="true"></i>
      {/if}
      Actions
    {/snippet}

    {#snippet children(close)}
      <li>
        <button
          type="button"
          class="dropdown-item"
          role="menuitem"
          title="Check SMS delivery status for all pending messages"
          disabled={checking}
          onclick={() => {
            close();
            void winnerActions.checkSmsStatus();
          }}
        >
          {#if checking}
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Checking…
          {:else}
            <i class="bi bi-arrow-clockwise me-2" aria-hidden="true"></i>Check SMS Status
          {/if}
        </button>
      </li>
      <li>
        <button
          type="button"
          class="dropdown-item"
          role="menuitem"
          onclick={() => {
            close();
            winnerActions.exportCsv();
          }}
        >
          <i class="bi bi-download me-2" aria-hidden="true"></i>Export CSV
        </button>
      </li>
      <li><hr class="dropdown-divider" /></li>
      <li>
        <button
          type="button"
          class="dropdown-item text-danger"
          role="menuitem"
          onclick={() => {
            close();
            void winnerActions.clearAll();
          }}
        >
          <i class="bi bi-trash me-2" aria-hidden="true"></i>Clear All
        </button>
      </li>
    {/snippet}
  </Dropdown>
</div>
