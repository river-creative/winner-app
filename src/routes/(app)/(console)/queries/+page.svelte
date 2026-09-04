<script lang="ts">
  import * as api from '$lib/api/client';
  import QueryEditorDialog from '$lib/components/queries/QueryEditorDialog.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import type { MpQuery } from '$lib/types';

  let queries = $state<MpQuery[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  /** The row the editor is working from, or a blank query. `null` closes the editor. */
  let editorSource = $state<MpQuery | null>(null);
  let editorIsEditing = $state(false);
  let saving = $state(false);

  async function load() {
    loading = true;
    error = null;
    try {
      queries = await api.mpGetQueries();
    } catch (cause) {
      // A failed load must never render as "no queries configured yet": that reads as a wiped
      // configuration and invites an operator to recreate queries that are already there.
      error = cause instanceof Error ? cause.message : 'Could not load the queries.';
    } finally {
      loading = false;
    }
  }

  // Fetching is a side effect, and this one has no reactive dependencies, so it runs once when
  // the screen mounts — and again if the operator navigates away and back.
  $effect(() => {
    void load();
  });

  function openNew() {
    editorIsEditing = false;
    editorSource = {
      id: '',
      name: '',
      description: '',
      table: 'Event_Participants',
      select: '',
      filter: '',
      params: {},
      metadata: { category: 'Events', previewFields: [] }
    };
  }

  function openEdit(query: MpQuery) {
    editorIsEditing = true;
    // Passed by reference; the dialog snapshots it, so the row stays untouched until a save
    // succeeds and `load()` replaces the whole list.
    editorSource = query;
  }

  async function saveQuery(query: MpQuery) {
    saving = true;
    try {
      if (editorIsEditing) await api.mpUpdateQuery(query.id, query);
      else await api.mpCreateQuery(query);

      editorSource = null;
      await load();
      toasts.success('Query saved');
    } catch (cause) {
      // The editor stays open with everything still typed into it, so nothing has to be redone.
      toasts.fromError(cause, 'Could not save the query.');
    } finally {
      saving = false;
    }
  }

  async function deleteQuery(query: MpQuery) {
    const confirmed = await ui.confirm({
      title: 'Delete query',
      message: `Delete “${query.name}”? Lists already imported with it are not affected.`,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      await api.mpDeleteQuery(query.id);
      await load();
      toasts.success('Query deleted');
    } catch (cause) {
      toasts.fromError(cause, 'Could not delete the query.');
    }
  }
</script>

<svelte:head><title>MP Queries · River Winner</title></svelte:head>

<h1 class="visually-hidden">Ministry Platform queries</h1>

<div class="card">
  <div class="card-body">
    <div class="section-toolbar">
      <h2 class="card-title section-toolbar-title h5">MP Queries</h2>
      <button type="button" class="btn btn-primary" onclick={openNew}>
        <i class="bi bi-plus-lg me-2" aria-hidden="true"></i>Add Query
      </button>
    </div>

    {#if loading}
      <div class="text-center py-4">
        <div class="spinner-border" role="status">
          <span class="visually-hidden">Loading…</span>
        </div>
      </div>
    {:else if error}
      <div class="alert alert-danger d-flex flex-wrap gap-2 align-items-center" role="alert">
        <div class="flex-grow-1">
          <strong>Could not load the queries.</strong>
          <span class="d-block small">{error}</span>
        </div>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick={() => void load()}>
          Retry
        </button>
      </div>
    {:else}
      <div class="table-responsive">
        <!--
          The explicit ARIA roles are load-bearing, not decoration: below md the `.table-stack`
          rules in responsive.css §7 set `display: block` on the table, its rows and its cells to
          turn each row into a card, which strips the implicit table semantics from every one of
          them. Every cell also needs a `data-label` — that attribute is what the stacked layout
          renders as the row's field name.
        -->
        <!-- svelte-ignore a11y_no_redundant_roles -->
        <table class="table table-striped table-hover table-stack" role="table">
          <!-- svelte-ignore a11y_no_redundant_roles -->
          <thead role="rowgroup">
            <!-- svelte-ignore a11y_no_redundant_roles -->
            <tr role="row">
              <th scope="col">Name</th>
              <th scope="col">Description</th>
              <th scope="col">Category</th>
              <th scope="col">Table</th>
              <th scope="col" class="text-end">Actions</th>
            </tr>
          </thead>
          <!-- svelte-ignore a11y_no_redundant_roles -->
          <tbody role="rowgroup">
            {#each queries as query (query.id)}
              <!-- svelte-ignore a11y_no_redundant_roles -->
              <tr role="row">
                <td role="cell" data-label="Name">
                  <strong>{query.name}</strong>
                  <br />
                  <small class="text-muted">{query.id}</small>
                </td>
                <td role="cell" data-label="Description">{query.description ?? ''}</td>
                <td role="cell" data-label="Category">
                  <span class="badge bg-secondary">{query.category || 'Other'}</span>
                </td>
                <td role="cell" data-label="Table"><code>{query.table || '-'}</code></td>
                <td role="cell" data-label="" class="text-end">
                  <div class="btn-group btn-group-sm" role="group" aria-label="Actions for {query.name}">
                    <button
                      type="button"
                      class="btn btn-outline-primary"
                      title="Edit"
                      aria-label="Edit query"
                      onclick={() => openEdit(query)}
                    >
                      <i class="bi bi-pencil" aria-hidden="true"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-danger"
                      title="Delete"
                      aria-label="Delete query"
                      onclick={() => void deleteQuery(query)}
                    >
                      <i class="bi bi-trash" aria-hidden="true"></i>
                    </button>
                  </div>
                </td>
              </tr>
            {:else}
              <tr class="table-stack-empty">
                <td colspan="5" class="text-center text-muted">No queries configured yet.</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

{#if editorSource}
  <QueryEditorDialog
    bind:open={
      () => true,
      (value) => {
        // Escape, the close button, the backdrop and Cancel all arrive here as "not open".
        if (!value) editorSource = null;
      }
    }
    source={editorSource}
    isEditing={editorIsEditing}
    {saving}
    onsave={(query) => void saveQuery(query)}
  />
{/if}
