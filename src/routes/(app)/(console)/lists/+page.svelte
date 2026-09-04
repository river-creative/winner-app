<script lang="ts">
  import Dropdown from '$lib/components/Dropdown.svelte';
  import ImportWizard from '$lib/components/lists/ImportWizard.svelte';
  import ListCard from '$lib/components/lists/ListCard.svelte';
  import ListEntriesDialog from '$lib/components/lists/ListEntriesDialog.svelte';
  import ListSettingsDialog from '$lib/components/lists/ListSettingsDialog.svelte';
  import MpImportDialog from '$lib/components/lists/MpImportDialog.svelte';
  import ReportImportDialog from '$lib/components/lists/ReportImportDialog.svelte';
  import { LIST_SORT_OPTIONS } from '$lib/constants/options';
  import {
    archiveList,
    deleteList,
    isListReferenced,
    sortLists,
    syncListFromMp,
    type ImportSource
  } from '$lib/services/lists';
  import { data } from '$lib/state/data.svelte';
  import { setup } from '$lib/state/setup.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import type { List, ListSortField, SortDirection } from '$lib/types';
  import { parseCsv, validateCsvFile } from '$lib/utils/csv';
  import { formatNumber, pluralise } from '$lib/utils/format';

  let sortField = $state<ListSortField>('name');
  let sortDir = $state<SortDirection>('asc');

  const sorted = $derived(sortLists(data.lists, sortField, sortDir));
  const hasLists = $derived(data.lists.length > 0);

  /** Only ever one wizard, whichever of the three sources opened it. */
  let importSource = $state<ImportSource | null>(null);
  let reportDialogOpen = $state(false);
  let mpDialogOpen = $state(false);

  let viewListId = $state<string | null>(null);
  let editListId = $state<string | null>(null);
  const editList = $derived<List | undefined>(editListId === null ? undefined : data.listById(editListId));

  let syncingListId = $state<string | null>(null);

  let fileInput = $state<HTMLInputElement>();

  function toggleSort(field: ListSortField) {
    if (sortField === field) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDir = 'asc';
    }
  }

  const activeSortLabel = $derived(
    LIST_SORT_OPTIONS.find((option) => option.field === sortField)?.label ?? sortField
  );

  function chevronFor(field: ListSortField): string {
    const option = LIST_SORT_OPTIONS.find((candidate) => candidate.field === field);
    if (!option || option.field !== sortField) return '';
    return sortDir === 'asc' ? option.asc : option.desc;
  }

  // -------------------------------------------------------------------------------------------
  // CSV import
  // -------------------------------------------------------------------------------------------

  async function handleFile(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    // Cleared straight away so choosing the same file twice in a row still fires `change`.
    event.currentTarget.value = '';
    if (!file) return;

    const fileCheck = validateCsvFile(file);
    if (!fileCheck.valid) {
      toasts.warning(fileCheck.error ?? 'That file cannot be imported.');
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseCsv(text);

      // Aborted rather than partially imported: a ragged row means the column count is wrong,
      // and importing only the rows that happened to line up hides that from the operator.
      if (parsed.errors.length > 0) {
        toasts.error(`Could not parse the file: ${parsed.errors.slice(0, 3).join(' ')}`);
        return;
      }
      if (parsed.data.length === 0) {
        toasts.warning('That file has no data rows.');
        return;
      }

      importSource = {
        rows: parsed.data,
        headers: parsed.headers,
        listName: file.name.replace(/\.[^/.]+$/, ''),
        fileName: file.name,
        mpSource: null
      };
    } catch (error) {
      toasts.fromError(error, 'Could not read that file.');
    }
  }

  // -------------------------------------------------------------------------------------------
  // Card actions
  // -------------------------------------------------------------------------------------------

  async function archive(list: List) {
    const confirmed = await ui.confirm({
      title: 'Archive List',
      message: `Archive "${list.metadata.name}"?`,
      details: [
        'The list is removed, but winners and history keep showing its name.',
        `Its ${formatNumber(list.entries.length)} ${pluralise(list.entries.length, 'entry', 'entries')} are discarded.`
      ],
      confirmText: 'Archive',
      variant: 'warning'
    });
    if (!confirmed) return;

    try {
      await archiveList(list);
      toasts.success(`"${list.metadata.name}" archived.`);
    } catch (error) {
      data.reportWriteFailure(error, 'the archive');
    }
  }

  /**
   * Delete, or archive when something still points at the list.
   *
   * A winner whose source list has been destroyed cannot say where it came from, so a referenced
   * list is always archived instead — and the confirmation says so rather than promising a
   * delete it will not perform.
   */
  async function remove(list: List) {
    const referenced = isListReferenced(list.listId);

    const confirmed = await ui.confirm({
      title: 'Delete List',
      message: referenced
        ? `"${list.metadata.name}" has winners or history attached, so it will be archived instead of deleted.`
        : `Delete "${list.metadata.name}"?`,
      details: referenced
        ? ['Winners and history keep showing its name.', 'Its entries are discarded.']
        : ['This cannot be undone.'],
      confirmText: referenced ? 'Archive' : 'Delete',
      variant: referenced ? 'warning' : 'danger'
    });
    if (!confirmed) return;

    try {
      if (referenced) {
        await archiveList(list);
        toasts.success(`"${list.metadata.name}" archived.`);
      } else {
        await deleteList(list.listId);
        toasts.success(`"${list.metadata.name}" deleted.`);
      }
    } catch (error) {
      data.reportWriteFailure(error, referenced ? 'the archive' : 'the list');
    }
  }

  async function sync(list: List) {
    if (syncingListId !== null) return;
    syncingListId = list.listId;
    try {
      const { added } = await syncListFromMp(list);
      if (added === 0) toasts.info('No new entries found — the list is up to date.');
      else
        toasts.success(
          `Sync complete. Added ${formatNumber(added)} new ${pluralise(added, 'entry', 'entries')}.`
        );
    } catch (error) {
      toasts.fromError(error, 'Could not sync this list from Ministry Platform.');
    } finally {
      syncingListId = null;
    }
  }
</script>

<svelte:head><title>Lists · River Winner</title></svelte:head>

<h1 class="visually-hidden">List management</h1>

<div class="card">
  <div class="card-body">
    <div class="section-toolbar">
      <h5 class="card-title section-toolbar-title">List Management</h5>

      {#if hasLists}
        <!-- Three pills from md up; the same state behind a single dropdown below it, where
             three pills plus the bulk pair plus Add cannot share a phone row. -->
        <div class="btn-group btn-group-sm d-none d-md-inline-flex" role="group" aria-label="Sort lists">
          {#each LIST_SORT_OPTIONS as option (option.field)}
            <button
              type="button"
              class="btn"
              class:btn-primary={sortField === option.field}
              class:btn-outline-secondary={sortField !== option.field}
              aria-pressed={sortField === option.field}
              onclick={() => toggleSort(option.field)}
            >
              {option.label}
              {#if chevronFor(option.field)}
                <i class="bi {chevronFor(option.field)}" aria-hidden="true"></i>
              {/if}
            </button>
          {/each}
        </div>

        <Dropdown
          class="d-md-none section-toolbar-sort"
          buttonClass="btn btn-outline-secondary btn-sm"
          label="Sort: {activeSortLabel}"
          icon={sortDir === 'asc' ? 'bi-sort-down' : 'bi-sort-up'}
          ariaLabel="Change how lists are sorted"
          align="start"
        >
          {#snippet children(close)}
            {#each LIST_SORT_OPTIONS as option (option.field)}
              <li>
                <button
                  type="button"
                  class="dropdown-item d-flex align-items-center justify-content-between"
                  class:active={sortField === option.field}
                  role="menuitem"
                  onclick={() => {
                    toggleSort(option.field);
                    close();
                  }}
                >
                  <span>{option.label}</span>
                  {#if chevronFor(option.field)}
                    <i class="bi {chevronFor(option.field)}" aria-hidden="true"></i>
                  {/if}
                </button>
              </li>
            {/each}
          {/snippet}
        </Dropdown>
      {/if}

      <div class="section-toolbar-group">
        {#if hasLists}
          <div class="btn-group btn-group-sm" role="group" aria-label="Bulk list selection">
            <button type="button" class="btn btn-outline-secondary" onclick={() => setup.selectAllLists()}>
              <i class="bi bi-check-square me-1" aria-hidden="true"></i>Select All
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary"
              disabled={setup.validSelectedCount === 0}
              onclick={() => setup.clearSelectedLists()}
            >
              <i class="bi bi-square me-1" aria-hidden="true"></i>Clear All
            </button>
          </div>
        {/if}

        <Dropdown buttonClass="btn btn-primary" label="Add" icon="bi-plus-circle" ariaLabel="Add a list">
          {#snippet children(close)}
            <li>
              <button
                type="button"
                class="dropdown-item"
                role="menuitem"
                onclick={() => {
                  close();
                  fileInput?.click();
                }}
              >
                <i class="bi bi-file-earmark-spreadsheet me-2" aria-hidden="true"></i>CSV File
              </button>
            </li>
            <li>
              <button
                type="button"
                class="dropdown-item"
                role="menuitem"
                onclick={() => {
                  close();
                  reportDialogOpen = true;
                }}
              >
                <i class="bi bi-ticket-perforated me-2" aria-hidden="true"></i>Pretix Report
              </button>
            </li>
            <li>
              <button
                type="button"
                class="dropdown-item"
                role="menuitem"
                onclick={() => {
                  close();
                  mpDialogOpen = true;
                }}
              >
                <i class="bi bi-database me-2" aria-hidden="true"></i>Ministry Platform
              </button>
            </li>
          {/snippet}
        </Dropdown>
      </div>
    </div>

    {#if data.loading}
      <!-- Skeletons rather than a spinner: the grid keeps its shape, so nothing jumps when the
           real cards arrive. `aria-busy` is what actually announces the wait. -->
      <div class="row g-3" aria-busy="true" aria-live="polite">
        <span class="visually-hidden">Loading lists…</span>
        {#each [0, 1, 2, 3, 4, 5] as placeholder (placeholder)}
          <div class="col-md-6 col-lg-4" aria-hidden="true">
            <div class="card h-100 placeholder-glow">
              <div class="card-header">
                <div class="d-flex justify-content-between align-items-center">
                  <span class="placeholder col-6"></span>
                  <span class="placeholder col-2"></span>
                </div>
              </div>
              <div class="card-body d-flex flex-column">
                <span class="placeholder col-8 mb-3"></span>
                <div class="mt-auto d-flex justify-content-between">
                  <span class="placeholder col-4"></span>
                  <span class="placeholder col-3"></span>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else if hasLists}
      <div class="row g-3">
        {#each sorted as list (list.listId)}
          <div class="col-md-6 col-lg-4">
            <ListCard
              {list}
              syncing={syncingListId === list.listId}
              onview={() => (viewListId = list.listId)}
              onedit={() => (editListId = list.listId)}
              onarchive={() => void archive(list)}
              ondelete={() => void remove(list)}
              onsync={() => void sync(list)}
            />
          </div>
        {/each}
      </div>
    {:else}
      <!-- Reached only on a successful, empty load: a failed load is rendered as an error by
           the console layout, never as "no lists yet". -->
      <div class="text-center py-5">
        <i class="bi bi-file-earmark-spreadsheet display-1 text-muted" aria-hidden="true"></i>
        <p class="text-muted mt-3">No lists uploaded yet</p>
        <button type="button" class="btn btn-primary" onclick={() => fileInput?.click()}>
          <i class="bi bi-file-earmark-spreadsheet me-2" aria-hidden="true"></i>Import a CSV file
        </button>
      </div>
    {/if}

    <!--
      `hidden`, not `.visually-hidden`: the Add menu and the empty-state button are the visible
      affordance, so a clipped-but-focusable input would just be a tab stop with nothing to see.
      A programmatic `.click()` still opens the picker on a hidden input.
    -->
    <input bind:this={fileInput} type="file" accept=".csv" hidden onchange={handleFile} />
  </div>
</div>

<!--
  Each dialog is created on demand and destroyed on close, so its form state is seeded from the
  record it was opened for at creation. That is what removes the need for an effect copying a
  prop into local state every time the target changes.
-->
{#if viewListId !== null}
  {#key viewListId}
    <ListEntriesDialog listId={viewListId} onclose={() => (viewListId = null)} />
  {/key}
{/if}

{#if editList}
  {#key editList.listId}
    <ListSettingsDialog list={editList} onclose={() => (editListId = null)} />
  {/key}
{/if}

{#if reportDialogOpen}
  <ReportImportDialog
    onclose={() => (reportDialogOpen = false)}
    onready={(source) => (importSource = source)}
  />
{/if}

{#if mpDialogOpen}
  <MpImportDialog onclose={() => (mpDialogOpen = false)} onready={(source) => (importSource = source)} />
{/if}

{#if importSource}
  {#key importSource}
    <ImportWizard source={importSource} onclose={() => (importSource = null)} />
  {/key}
{/if}
