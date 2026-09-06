<script lang="ts">
  import Dialog from '$lib/components/Dialog.svelte';
  import Pager from '$lib/components/table/Pager.svelte';
  import SortHeader from '$lib/components/table/SortHeader.svelte';
  import { Pagination } from '$lib/components/table/pagination.svelte';
  import { smsBadge } from '$lib/components/winners/smsStatus';
  import { data } from '$lib/state/data.svelte';
  import { historyFilters } from '$lib/state/filters.svelte';
  import { historyActions } from '$lib/state/history.svelte';
  import type { HistoryEntry } from '$lib/types';
  import { formatDate, formatDateTime, formatNumber, orderIdOf, pluralise } from '$lib/utils/format';

  // One call per component is all Svelte allows; the three filter controls suffix it.
  const uid = $props.id();

  const stats = $derived(historyFilters.stats);
  const sortField = $derived(historyFilters.sortField);
  const sortDir = $derived(historyFilters.sortDir);

  /** See WinnersTable: a change to any of these makes the current page a page of another result. */
  const resetKey = $derived(
    [
      historyFilters.list,
      historyFilters.prize,
      historyFilters.date,
      historyFilters.sortField,
      historyFilters.sortDir
    ].join('|')
  );

  const pagination = new Pagination<HistoryEntry>(
    () => historyFilters.filtered,
    () => resetKey,
    'history_page_size'
  );

  /** The draw whose winners are open in the dialog. */
  let viewing = $state<HistoryEntry | null>(null);

  function namesOf(entry: HistoryEntry): string {
    return entry.winners.map((winner) => winner.displayName).join(', ');
  }
</script>

<svelte:head><title>History · River Winner</title></svelte:head>

<h1 class="visually-hidden">Selection history</h1>

<!-- A failed load is rendered by the console layout, in place of this screen entirely. -->
<div class="card">
  <div class="card-body">
    <h5 class="card-title">Selection History &amp; Statistics</h5>

    <!-- Computed over every draw, not the filtered subset: these are the totals for the event,
         and a filter is a way of looking at them, not a way of changing them. -->
    <div class="history-stats">
      <div class="stat-card">
        <div class="stat-number">{formatNumber(stats.totalSelections)}</div>
        <div class="stat-label">Total Selections</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">{formatNumber(stats.totalWinners)}</div>
        <div class="stat-label">Total Winners</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">{formatNumber(stats.averageWinners)}</div>
        <div class="stat-label">Avg Winners/Selection</div>
      </div>
      <div class="stat-card">
        <div class="stat-number stat-number-text">{stats.mostUsedPrize}</div>
        <div class="stat-label">Most Used Prize</div>
      </div>
    </div>

    <!-- The dropdowns cascade the same way the Winners filters do; `historyFilters` owns it. -->
    <div class="row mb-3 g-2">
      <div class="col-md">
        <label class="form-label" for="{uid}-list">Filter by List</label>
        <select id="{uid}-list" class="form-select" bind:value={historyFilters.list}>
          <option value="">All Lists</option>
          {#each historyFilters.uniqueLists as list (list)}
            <option value={list}>{list}</option>
          {/each}
        </select>
      </div>

      <div class="col-md">
        <label class="form-label" for="{uid}-prize">Filter by Prize</label>
        <select id="{uid}-prize" class="form-select" bind:value={historyFilters.prize}>
          <option value="">All Prizes</option>
          {#each historyFilters.uniquePrizes as prize (prize)}
            <option value={prize}>{prize}</option>
          {/each}
        </select>
      </div>

      <div class="col-md">
        <label class="form-label" for="{uid}-date">Filter by Date</label>
        <input id="{uid}-date" type="date" class="form-control" bind:value={historyFilters.date} />
      </div>

      <div class="col-md-auto d-flex align-items-end">
        <button
          type="button"
          class="btn btn-outline-secondary"
          disabled={!historyFilters.hasFilters}
          onclick={() => historyFilters.clear()}
        >
          <i class="bi bi-x-circle me-1" aria-hidden="true"></i>Clear All
        </button>
      </div>
    </div>

    <div class="d-flex justify-content-between align-items-center mb-2 text-muted">
      <small aria-live="polite">
        Showing {formatNumber(historyFilters.filtered.length)} of
        {formatNumber(data.history.length)}
        {pluralise(data.history.length, 'selection')}
      </small>
    </div>

    <!-- table-stack + data-label: see WinnersTable. -->
    <div class="table-responsive">
      <!-- svelte-ignore a11y_no_redundant_roles -->
      <table class="table table-striped table-stack" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <SortHeader
              label="Date"
              kind="date"
              active={sortField === 'date'}
              direction={sortDir}
              onsort={() => historyFilters.toggleSort('date')}
            />
            <SortHeader
              label="List"
              active={sortField === 'list'}
              direction={sortDir}
              onsort={() => historyFilters.toggleSort('list')}
            />
            <SortHeader
              label="Prize"
              active={sortField === 'prize'}
              direction={sortDir}
              onsort={() => historyFilters.toggleSort('prize')}
            />
            <SortHeader
              label="Count"
              kind="number"
              active={sortField === 'count'}
              direction={sortDir}
              onsort={() => historyFilters.toggleSort('count')}
            />
            <th scope="col">Winners</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>

        <tbody role="rowgroup">
          {#if data.loading}
            <tr class="table-stack-empty">
              <td colspan="6" class="text-center text-muted">
                <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
                Loading selection history…
              </td>
            </tr>
          {:else}
            {#each pagination.visible as entry (entry.historyId)}
              {@const names = namesOf(entry)}
              <tr role="row">
                <td role="cell" data-label="Date">{formatDate(entry.timestamp)}</td>
                <td role="cell" data-label="List">{entry.listName}</td>
                <td role="cell" data-label="Prize">{entry.prize}</td>
                <td role="cell" data-label="Count">{formatNumber(entry.winners.length)}</td>
                <td role="cell" data-label="Winners">
                  <!-- Truncated with the full list in `title`; the dialog behind the row action
                       is what makes a long draw actually readable. -->
                  <span class="d-inline-block text-truncate history-winner-names" title={names}>
                    {names}
                  </span>
                </td>
                <td role="cell" data-label="" class="py-1">
                  <div class="btn-group btn-group-sm" role="group" aria-label="Actions for this selection">
                    <button
                      type="button"
                      class="btn btn-sm btn-outline-secondary"
                      title="View winners"
                      aria-label="View the winners of this selection"
                      onclick={() => (viewing = entry)}
                    >
                      <i class="bi bi-people" aria-hidden="true"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-sm btn-outline-danger"
                      title="Delete this selection"
                      aria-label="Delete this selection"
                      onclick={() => void historyActions.deleteSelection(entry)}
                    >
                      <i class="bi bi-trash" aria-hidden="true"></i>
                    </button>
                  </div>
                </td>
              </tr>
            {:else}
              <tr class="table-stack-empty">
                <td colspan="6" class="text-center text-muted"> No selections match the current filters. </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    {#if pagination.needed && !data.loading}
      <Pager
        page={pagination.page}
        pageCount={pagination.pageCount}
        size={pagination.size}
        total={pagination.total}
        firstIndex={pagination.firstIndex}
        lastIndex={pagination.lastIndex}
        noun="selections"
        onpage={(page) => pagination.goto(page)}
        onsize={(size) => (pagination.size = size)}
      />
    {/if}
  </div>
</div>

{#if viewing}
  {@const entry = viewing}
  <Dialog
    bind:open={
      () => viewing !== null,
      (value) => {
        if (!value) viewing = null;
      }
    }
    title="{entry.prize} — {formatDateTime(entry.timestamp)}"
    size="modal-lg"
  >
    <p class="text-muted">
      {formatNumber(entry.winners.length)}
      {pluralise(entry.winners.length, 'winner')} drawn from "{entry.listName}".
    </p>

    <ul class="list-group list-group-flush">
      {#each entry.winners as winner (winner.winnerId)}
        {@const record = data.winnerById(winner.winnerId)}
        <li class="list-group-item d-flex flex-wrap align-items-center gap-2 px-0">
          <span class="badge bg-primary winner-id-badge">
            {record ? orderIdOf(record) : 'N/A'}
          </span>
          <span class="me-auto">{winner.displayName}</span>

          {#if record}
            {@const sms = smsBadge(record)}
            {#if record.pickedUp}
              <span class="badge bg-success">
                <i class="bi bi-check-circle-fill" aria-hidden="true"></i> Picked up
              </span>
            {:else}
              <span class="badge bg-warning">
                <i class="bi bi-clock" aria-hidden="true"></i> Pending
              </span>
            {/if}
            <span class={sms.class}>
              <i class="bi {sms.icon}" aria-hidden="true"></i>
              {sms.text}
            </span>
          {:else}
            <!-- Possible only for records predating the delete path that prunes history. -->
            <span class="badge bg-secondary">
              <i class="bi bi-dash-circle" aria-hidden="true"></i> Record deleted
            </span>
          {/if}
        </li>
      {/each}
    </ul>

    {#snippet footer()}
      <button type="button" class="btn btn-secondary" onclick={() => (viewing = null)}>Close</button>
    {/snippet}
  </Dialog>
{/if}
