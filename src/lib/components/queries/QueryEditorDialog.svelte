<script lang="ts">
  import Dialog from '$lib/components/Dialog.svelte';
  import InfoTip from '$lib/components/InfoTip.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import type { MpQuery, MpQueryMetadata, MpQueryParam } from '$lib/types';

  /**
   * The draft the form edits.
   *
   * Everything the form touches is required here, so no field needs an `undefined` branch at
   * every use site. It stays structurally assignable to `MpQuery`, and the snapshot it is built
   * from carries any field this editor does not know about straight back to the server.
   */
  interface QueryDraft extends MpQuery {
    description: string;
    table: string;
    select: string;
    filter: string;
    fetchParentPhone: boolean;
    params: Record<string, MpQueryParam>;
    metadata: MpQueryMetadata & { category: string };
  }

  interface Props {
    open: boolean;
    /** The row being edited, or a blank query. Never mutated — the draft is a copy. */
    source: MpQuery;
    isEditing: boolean;
    /** True while the parent's request is in flight. */
    saving: boolean;
    onsave: (query: MpQuery) => void;
  }

  let { open = $bindable(), source, isEditing, saving, onsave }: Props = $props();

  function toDraft(query: MpQuery): QueryDraft {
    // A plain deep copy of the row, so nothing typed here reaches the table until a save
    // succeeds. The dialog is mounted only while it is open, so this runs exactly once and
    // there is no state to keep in sync afterwards.
    const copy: MpQuery = $state.snapshot(query);
    return {
      ...copy,
      description: copy.description ?? '',
      table: copy.table ?? '',
      select: copy.select ?? '',
      filter: copy.filter ?? '',
      fetchParentPhone: copy.fetchParentPhone ?? false,
      params: copy.params ?? {},
      metadata: { ...copy.metadata, category: copy.metadata?.category ?? '' }
    };
  }

  // Reading `source` once is the point: the draft must NOT follow the row while the operator
  // edits it. The dialog is mounted only while it is open, so there is never a second value to
  // pick up.
  // svelte-ignore state_referenced_locally
  let draft = $state<QueryDraft>(toDraft(source));

  /** Parameters added in this session: only those may still be renamed. */
  let newParamKeys = $state<string[]>([]);

  const paramKeys = $derived(Object.keys(draft.params));

  // -------------------------------------------------------------------------------------------
  // Parameters
  // -------------------------------------------------------------------------------------------

  function addParam() {
    let index = 1;
    while (draft.params[`param${index}`]) index += 1;

    const name = `param${index}`;
    draft.params[name] = { type: 'number', label: '', required: true };
    newParamKeys = [...newParamKeys, name];
  }

  function updateParam(key: string, patch: Partial<MpQueryParam>) {
    const existing = draft.params[key];
    if (!existing) return;
    draft.params[key] = { ...existing, ...patch };
  }

  /**
   * Renaming rewrites the key, so a collision would silently overwrite another parameter and
   * take its configuration with it. Refused instead, and the box is put back.
   */
  function renameParam(oldKey: string, input: HTMLInputElement) {
    const next = input.value.trim();
    if (!next || next === oldKey) {
      input.value = oldKey;
      return;
    }

    if (draft.params[next]) {
      toasts.warning(`A parameter called “${next}” already exists.`);
      input.value = oldKey;
      return;
    }

    const existing = draft.params[oldKey];
    if (!existing) return;

    delete draft.params[oldKey];
    draft.params[next] = existing;
    newParamKeys = newParamKeys.map((key) => (key === oldKey ? next : key));
  }

  function removeParam(key: string) {
    delete draft.params[key];
    newParamKeys = newParamKeys.filter((candidate) => candidate !== key);
  }

  // -------------------------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------------------------

  function save() {
    const id = draft.id.trim();
    const name = draft.name.trim();

    if (!id || !name) {
      toasts.warning('ID and Name are required.');
      return;
    }

    draft.id = id;
    draft.name = name;

    // Hand the parent a plain object: the API client stringifies it, and the caller may keep it.
    onsave($state.snapshot(draft));
  }
</script>

<Dialog bind:open title={isEditing ? 'Edit Query' : 'New Query'} size="modal-lg">
  <div class="row g-3">
    <div class="col-md-6">
      <label class="form-label" for="query-id">ID <span class="text-danger">*</span></label>
      <input
        id="query-id"
        type="text"
        class="form-control"
        placeholder="e.g., my-custom-query"
        disabled={isEditing}
        aria-describedby="query-id-help"
        bind:value={draft.id}
      />
      <div id="query-id-help" class="form-text">Lowercase letters, numbers, and hyphens only</div>
    </div>

    <div class="col-md-6">
      <label class="form-label" for="query-name">Name <span class="text-danger">*</span></label>
      <input
        id="query-name"
        type="text"
        class="form-control"
        placeholder="e.g., My Custom Query"
        bind:value={draft.name}
      />
    </div>

    <div class="col-12">
      <label class="form-label" for="query-description">Description</label>
      <input
        id="query-description"
        type="text"
        class="form-control"
        placeholder="Brief description of the query"
        bind:value={draft.description}
      />
    </div>

    <div class="col-md-6">
      <label class="form-label" for="query-table">Table</label>
      <input
        id="query-table"
        type="text"
        class="form-control"
        placeholder="e.g., Event_Participants"
        bind:value={draft.table}
      />
    </div>

    <div class="col-md-6">
      <label class="form-label" for="query-category">Category</label>
      <input
        id="query-category"
        type="text"
        class="form-control"
        placeholder="e.g., Events"
        bind:value={draft.metadata.category}
      />
    </div>

    <div class="col-12">
      <label class="form-label" for="query-select">Select Fields</label>
      <textarea
        id="query-select"
        class="form-control font-monospace"
        rows="3"
        placeholder="e.g., Contact_ID, First_Name, Last_Name"
        bind:value={draft.select}></textarea>
    </div>

    <div class="col-12">
      <label class="form-label" for="query-filter">Filter (WHERE clause)</label>
      <textarea
        id="query-filter"
        class="form-control font-monospace"
        rows="3"
        placeholder={'e.g., Event_ID IN ({{eventId}}) AND Status = 1'}
        aria-describedby="query-filter-help"
        bind:value={draft.filter}></textarea>
      <div id="query-filter-help" class="form-text">
        {'Use {{paramName}} for dynamic parameters'}
      </div>
    </div>

    <!-- ------------------------------------------------------------------- Parameters -->
    <div class="col-12">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <span class="form-label mb-0" id="query-params-label">Parameters</span>
        <button type="button" class="btn btn-sm btn-outline-primary" onclick={addParam}>
          <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Add
        </button>
      </div>

      {#if paramKeys.length > 0}
        <div class="border rounded p-2" role="group" aria-labelledby="query-params-label">
          <!--
            Column headings only make sense while the fields sit in one row; below md the
            .query-param-row rule in responsive.css stacks them and each field carries its own
            label instead.
          -->
          <div class="row g-2 mb-2 text-muted small fw-bold d-none d-md-flex" aria-hidden="true">
            <div class="col-md-3">Name</div>
            <div class="col-md-3">Label</div>
            <div class="col-md-2">Type</div>
            <div class="col-md-2">Default</div>
            <div class="col-md-2"></div>
          </div>

          {#each paramKeys as key (key)}
            {@const param = draft.params[key]}
            {#if param}
              <div class="row g-2 mb-2 align-items-center query-param-row">
                <div class="col-12 col-md-3">
                  {#if newParamKeys.includes(key)}
                    <label class="form-label small text-muted mb-1 d-md-none" for="query-param-name-{key}">
                      Name
                    </label>
                    <input
                      id="query-param-name-{key}"
                      type="text"
                      class="form-control form-control-sm font-monospace"
                      placeholder="name"
                      aria-label="Parameter name"
                      value={key}
                      onchange={(event) => renameParam(key, event.currentTarget)}
                    />
                  {:else}
                    <!--
                      An existing name is referenced by the filter and by every saved list built
                      from this query, so it is shown rather than edited.
                    -->
                    <span class="form-label small text-muted mb-1 d-md-none d-block">Name</span>
                    <code class="text-primary">{'{{' + key + '}}'}</code>
                  {/if}
                </div>

                <div class="col-12 col-md-3">
                  <label class="form-label small text-muted mb-1 d-md-none" for="query-param-label-{key}">
                    Label
                  </label>
                  <input
                    id="query-param-label-{key}"
                    type="text"
                    class="form-control form-control-sm"
                    placeholder="Label"
                    aria-label="Label for parameter {key}"
                    value={param.label}
                    oninput={(event) => updateParam(key, { label: event.currentTarget.value })}
                  />
                </div>

                <div class="col-6 col-md-2">
                  <label class="form-label small text-muted mb-1 d-md-none" for="query-param-type-{key}">
                    Type
                  </label>
                  <select
                    id="query-param-type-{key}"
                    class="form-select form-select-sm"
                    aria-label="Type of parameter {key}"
                    value={param.type}
                    onchange={(event) =>
                      updateParam(key, {
                        type: event.currentTarget.value === 'text' ? 'text' : 'number'
                      })}
                  >
                    <option value="number">number</option>
                    <option value="text">text</option>
                  </select>
                </div>

                <div class="col-6 col-md-2">
                  <label class="form-label small text-muted mb-1 d-md-none" for="query-param-default-{key}">
                    Default
                  </label>
                  <!--
                    `defaultValue`, not `value`. The old editor wrote this box into `value`,
                    which the import screen reads as a hardcoded constant and hides the
                    parameter entirely — so a "default" typed here stopped the operator being
                    asked for it at all. Any existing `value` is left untouched by the snapshot.
                  -->
                  <input
                    id="query-param-default-{key}"
                    type="text"
                    class="form-control form-control-sm"
                    placeholder="Default"
                    aria-label="Default value for parameter {key}"
                    value={param.defaultValue ?? ''}
                    oninput={(event) => updateParam(key, { defaultValue: event.currentTarget.value })}
                  />
                </div>

                <div class="col-12 col-md-2 text-end">
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-danger"
                    aria-label="Remove parameter {key}"
                    onclick={() => removeParam(key)}
                  >
                    <i class="bi bi-trash" aria-hidden="true"></i>
                    <span class="ms-1 d-md-none">Remove</span>
                  </button>
                </div>
              </div>
            {/if}
          {/each}
        </div>
      {:else}
        <p class="text-muted small mb-0">No parameters defined. Click Add to create one.</p>
      {/if}
    </div>

    <!-- ---------------------------------------------------------------------- Options -->
    <div class="col-12">
      <span class="form-label d-block">Options</span>
      <div class="form-check">
        <input
          id="query-fetch-parent-phone"
          class="form-check-input"
          type="checkbox"
          bind:checked={draft.fetchParentPhone}
        />
        <label class="form-check-label" for="query-fetch-parent-phone">
          Fetch Parent Phone
          <InfoTip
            text="For child records, fetch the Head of Household's mobile phone and add as parentPhone field"
          />
        </label>
      </div>
    </div>
  </div>

  {#snippet footer()}
    <button type="button" class="btn btn-secondary" disabled={saving} onclick={() => (open = false)}>
      Cancel
    </button>
    <button type="button" class="btn btn-primary" disabled={saving} onclick={save}>
      {#if saving}
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Saving…
      {:else}
        <i class="bi bi-check-lg me-2" aria-hidden="true"></i>Save Query
      {/if}
    </button>
  {/snippet}
</Dialog>
