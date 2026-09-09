<script lang="ts">
  import Dialog from '$lib/components/Dialog.svelte';
  import { displayColumns, saveList } from '$lib/services/lists';
  import { data } from '$lib/state/data.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import type { List } from '$lib/types';
  import { formatDisplayName, formatNumber } from '$lib/utils/format';

  interface Props {
    listId: string;
    onclose: () => void;
  }

  let { listId, onclose }: Props = $props();

  let open = $state(true);

  /**
   * Read back out of the store rather than held as a prop value, so a deletion here — or a sync
   * running behind this dialog — is reflected without the parent having to push a new list in.
   */
  const list = $derived<List | undefined>(data.listById(listId));

  const columns = $derived(list ? displayColumns(list.entries) : []);
  const entries = $derived(list?.entries ?? []);

  const PAGE_SIZES = [25, 50, 100] as const;
  let pageSize = $state<number>(25);
  let page = $state(1);

  const totalPages = $derived(Math.max(1, Math.ceil(entries.length / pageSize)));

  /**
   * Deleting the last entry of the last page, or shrinking the page size, can leave `page` past
   * the end. Clamping on read rather than writing `page` back from an effect keeps this a single
   * source of truth — an effect that rewrites the state it watches is the loop runes exist to
   * remove.
   */
  const currentPage = $derived(Math.min(page, totalPages));
  const firstIndex = $derived((currentPage - 1) * pageSize);
  const visible = $derived(entries.slice(firstIndex, firstIndex + pageSize));

  let deletingId = $state<string | null>(null);

  async function deleteEntry(entryId: string) {
    const current = list;
    if (!current) return;

    const entry = current.entries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      toasts.error('That entry is no longer in this list.');
      return;
    }

    const name = formatDisplayName(entry, current.metadata.nameConfig);
    const confirmed = await ui.confirm({
      title: 'Delete Entry',
      message: `Delete "${name}" from this list?`,
      details: ['This cannot be undone.'],
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    deletingId = entryId;
    try {
      // Plainly filtered by id, which is how every other removal works — `removeEntries` on the
      // server included. This used to renumber every surviving entry as well, on the stated
      // premise that "a draw that removes winners writes the surviving entries back by it";
      // nothing has ever targeted a row by position, so that rewrote and re-uploaded a whole
      // list to delete one row of it.
      const remaining = current.entries.filter((candidate) => candidate.id !== entryId);

      await saveList({
        ...current,
        entries: remaining,
        metadata: { ...current.metadata, entryCount: remaining.length }
      });

      toasts.success(`Entry "${name}" deleted.`);
    } catch (error) {
      data.reportWriteFailure(error, 'the list');
    } finally {
      deletingId = null;
    }
  }
</script>

<Dialog bind:open title={list ? `List: ${list.metadata.name}` : 'List'} size="modal-xl" {onclose}>
  {#if !list}
    <p class="text-muted mb-0">This list is no longer available.</p>
  {:else}
    {#if !settings.current.hideEntryCounts}
      <div class="mb-3">
        <strong>Total Entries:</strong>
        {formatNumber(entries.length)}
        {#if list.metadata.skippedWinners}
          <span class="text-muted ms-2">
            ({formatNumber(list.metadata.skippedWinners)} winners skipped during upload)
          </span>
        {/if}
      </div>
    {/if}

    <div class="table-responsive list-entries-scroll">
      <!--
        The roles below are NOT redundant, which is why each one carries an ignore: responsive.css
        §7 switches this table's parts to `display: block` under the md breakpoint to stack each
        row as a card, and that strips the implicit table semantics off every element it touches.
        Spelling the roles out is what keeps the table announced as a table on a phone.
      -->
      <!-- svelte-ignore a11y_no_redundant_roles -->
      <table class="table table-striped table-sm table-stack" role="table">
        <!-- svelte-ignore a11y_no_redundant_roles -->
        <thead class="sticky-top bg-body" role="rowgroup">
          <!-- svelte-ignore a11y_no_redundant_roles -->
          <tr role="row">
            <th scope="col" style="width: 60px;">#</th>
            <th scope="col">Display Name</th>
            {#each columns as column (column)}
              <th scope="col">{column}</th>
            {/each}
            <th scope="col" style="width: 80px;">Actions</th>
          </tr>
        </thead>
        <!-- svelte-ignore a11y_no_redundant_roles -->
        <tbody role="rowgroup">
          <!--
            Keyed by position, not by `entry.id`: id uniqueness is only enforced for imports that
            chose a column (validateColumnIds), so a list restored from an old backup can hold
            two entries with the same id — and a duplicate key is a hard runtime error in Svelte.
            The rows carry no transition or local state, so position is a safe key here.
          -->
          {#each visible as entry, offset (firstIndex + offset)}
            {@const displayName = formatDisplayName(entry, list.metadata.nameConfig)}
            <!-- svelte-ignore a11y_no_redundant_roles -->
            <tr role="row">
              <!--
                Every cell carries `data-label` and an explicit `role`: responsive.css §7 turns
                each row into a card below md with `content: attr(data-label)`, and the roles are
                what keep the table semantics once those elements become `display: block`.
              -->
              <td role="cell" data-label="#">{firstIndex + offset + 1}</td>
              <td role="cell" data-label="Display Name">{displayName}</td>
              {#each columns as column (column)}
                <td role="cell" data-label={column}>{entry.data[column] ?? ''}</td>
              {/each}
              <td role="cell" data-label="">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger"
                  title="Delete this entry"
                  aria-label="Delete entry {displayName}"
                  disabled={deletingId !== null}
                  onclick={() => void deleteEntry(entry.id)}
                >
                  {#if deletingId === entry.id}
                    <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
                  {:else}
                    <i class="bi bi-trash" aria-hidden="true"></i>
                  {/if}
                </button>
              </td>
            </tr>
          {:else}
            <tr class="table-stack-empty">
              <td role="cell" data-label="" colspan={columns.length + 3} class="text-center text-muted">
                No entries in this list
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!--
      Paginated rather than rendered whole: a list is specified to hold 20 000 entries, and that
      many rows in the DOM freezes the dialog on open.
    -->
    {#if entries.length > 0}
      <div class="d-flex flex-wrap align-items-center gap-2 mt-3">
        <label class="form-label mb-0 small" for="entries-page-size">Rows per page</label>
        <select
          id="entries-page-size"
          class="form-select form-select-sm w-auto"
          value={pageSize}
          onchange={(event) => {
            pageSize = Number(event.currentTarget.value);
            page = 1;
          }}
        >
          {#each PAGE_SIZES as size (size)}
            <option value={size}>{size}</option>
          {/each}
        </select>

        <span class="text-muted small ms-auto" aria-live="polite">
          {formatNumber(firstIndex + 1)}–{formatNumber(firstIndex + visible.length)}
          of {formatNumber(entries.length)}
        </span>

        <div class="btn-group btn-group-sm" role="group" aria-label="Entry pages">
          <button
            type="button"
            class="btn btn-outline-secondary"
            disabled={currentPage <= 1}
            aria-label="Previous page"
            onclick={() => (page = Math.max(1, currentPage - 1))}
          >
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
          </button>
          <span class="btn btn-outline-secondary disabled" aria-hidden="true">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            class="btn btn-outline-secondary"
            disabled={currentPage >= totalPages}
            aria-label="Next page"
            onclick={() => (page = Math.min(totalPages, currentPage + 1))}
          >
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    {/if}

    <div class="mt-3 text-muted small">
      <i class="bi bi-info-circle" aria-hidden="true"></i>
      Individual records can be deleted from this list. This action cannot be undone.
    </div>
  {/if}

  {#snippet footer()}
    <button type="button" class="btn btn-secondary" onclick={() => (open = false)}>Close</button>
  {/snippet}
</Dialog>

<style>
  /*
    Height only — the sticky header needs a scroll container of its own, and this one is
    viewport-independent, so it stays with the component rather than going to responsive.css.
  */
  .list-entries-scroll {
    max-height: 400px;
    overflow-y: auto;
  }
</style>
