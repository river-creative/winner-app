<script lang="ts">
  import Pager from '$lib/components/table/Pager.svelte';
  import SortHeader from '$lib/components/table/SortHeader.svelte';
  import { Pagination } from '$lib/components/table/pagination.svelte';
  import { smsBadge } from './smsStatus';
  import { data } from '$lib/state/data.svelte';
  import { winnerFilters } from '$lib/state/filters.svelte';
  import { winnerActions } from '$lib/state/winners.svelte';
  import type { Winner } from '$lib/types';
  import { formatDate, orderIdOf } from '$lib/utils/format';

  /**
   * Anything in here makes the current page a page of a different question, so the pager goes
   * back to the top rather than leaving the operator on page 7 of a two-page result — or, worse,
   * on a page 7 that now holds completely different rows because the sort was reversed.
   */
  const resetKey = $derived(
    [
      winnerFilters.prize,
      winnerFilters.list,
      winnerFilters.batch,
      winnerFilters.date,
      winnerFilters.sortField,
      winnerFilters.sortDir
    ].join('|')
  );

  const pagination = new Pagination<Winner>(
    () => winnerFilters.filtered,
    () => resetKey,
    'winners_page_size'
  );

  const sortField = $derived(winnerFilters.sortField);
  const sortDir = $derived(winnerFilters.sortDir);
</script>

<!--
  `table-stack`: below the md breakpoint responsive.css §7 turns every row into a card labelled
  from the `data-label` attributes, so each `<td>` must carry one — the actions cell carries an
  empty one, which is what makes it span the card instead of growing a heading. The explicit ARIA
  roles are what keep the table semantics once the CSS switches the elements to `display: block`,
  which is also why the redundant-role warnings below are suppressed rather than fixed.
-->
<div class="table-responsive">
  <!-- svelte-ignore a11y_no_redundant_roles -->
  <table class="table table-striped table-stack" role="table">
    <thead role="rowgroup">
      <tr role="row">
        <!-- Not sortable: the id is a ticket code from four different sources, so an ordering
             over it would not mean anything the operator could predict. -->
        <th scope="col">ID</th>
        <SortHeader
          label="Name"
          active={sortField === 'name'}
          direction={sortDir}
          onsort={() => winnerFilters.toggleSort('name')}
        />
        <SortHeader
          label="Prize"
          active={sortField === 'prize'}
          direction={sortDir}
          onsort={() => winnerFilters.toggleSort('prize')}
        />
        <SortHeader
          label="Date"
          kind="date"
          active={sortField === 'date'}
          direction={sortDir}
          onsort={() => winnerFilters.toggleSort('date')}
        />
        <SortHeader
          label="List"
          active={sortField === 'list'}
          direction={sortDir}
          onsort={() => winnerFilters.toggleSort('list')}
        />
        <SortHeader
          label="Pickup"
          kind="date"
          active={sortField === 'pickup'}
          direction={sortDir}
          onsort={() => winnerFilters.toggleSort('pickup')}
        />
        <SortHeader
          label="SMS"
          active={sortField === 'sms'}
          direction={sortDir}
          onsort={() => winnerFilters.toggleSort('sms')}
        />
        <th scope="col">Actions</th>
      </tr>
    </thead>

    <tbody role="rowgroup">
      {#if data.loading}
        <tr class="table-stack-empty">
          <td colspan="8" class="text-center text-muted">
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
            Loading winners…
          </td>
        </tr>
      {:else}
        {#each pagination.visible as winner (winner.winnerId)}
          {@const sms = smsBadge(winner)}
          <tr role="row">
            <td role="cell" data-label="ID">
              <span class="badge bg-primary winner-id-badge">{orderIdOf(winner)}</span>
            </td>
            <td role="cell" data-label="Name">{winner.displayName}</td>
            <td role="cell" data-label="Prize">{winner.prize}</td>
            <td role="cell" data-label="Date">{formatDate(winner.timestamp)}</td>
            <td role="cell" data-label="List">{winner.listName}</td>
            <td role="cell" data-label="Pickup">
              {#if winner.pickedUp}
                <span class="badge bg-success">
                  <i class="bi bi-check-circle-fill" aria-hidden="true"></i> Picked up
                </span>
              {:else}
                <span class="badge bg-warning">
                  <i class="bi bi-clock" aria-hidden="true"></i> Pending
                </span>
              {/if}
            </td>
            <td role="cell" data-label="SMS">
              <span class={sms.class}>
                <i class="bi {sms.icon}" aria-hidden="true"></i>
                {sms.text}
              </span>
            </td>
            <td role="cell" data-label="" class="py-1">
              <div class="btn-group btn-group-sm" role="group" aria-label="Actions for {winner.displayName}">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-info"
                  title="Return to List"
                  aria-label="Return {winner.displayName} to their list"
                  onclick={() => void winnerActions.returnToList(winner)}
                >
                  <i class="bi bi-arrow-return-left" aria-hidden="true"></i>
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  class:btn-outline-secondary={winner.pickedUp}
                  class:btn-outline-success={!winner.pickedUp}
                  title={winner.pickedUp ? 'Mark as Pending' : 'Mark as Picked Up'}
                  aria-label={winner.pickedUp
                    ? `Mark ${winner.displayName} as pending`
                    : `Mark ${winner.displayName} as picked up`}
                  onclick={() => void winnerActions.togglePickup(winner)}
                >
                  <i
                    class="bi"
                    class:bi-x-circle={winner.pickedUp}
                    class:bi-check-circle={!winner.pickedUp}
                    aria-hidden="true"
                  ></i>
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger"
                  title="Delete"
                  aria-label="Delete {winner.displayName}"
                  onclick={() => void winnerActions.deleteWinner(winner)}
                >
                  <i class="bi bi-trash" aria-hidden="true"></i>
                </button>
              </div>
            </td>
          </tr>
        {:else}
          <tr class="table-stack-empty">
            <td colspan="8" class="text-center text-muted"> No winners match the current filters. </td>
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
    noun="winners"
    onpage={(page) => pagination.goto(page)}
    onsize={(size) => (pagination.size = size)}
  />
{/if}
