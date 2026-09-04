<script lang="ts">
  import * as api from '$lib/api/client';
  import Dialog from '$lib/components/Dialog.svelte';
  import { fieldNames, mpRecordToRow, type ImportSource } from '$lib/services/lists';
  import { toasts } from '$lib/state/toasts.svelte';
  import type { MpEvent, MpQuery, MpQueryParam, MpRecord } from '$lib/types';
  import { formatNumber, pluralise } from '$lib/utils/format';

  interface Props {
    onclose: () => void;
    /** Hands the fetched records to the import wizard, with `mpSource` set for sync. */
    onready: (source: ImportSource) => void;
  }

  let { onclose, onready }: Props = $props();

  let open = $state(true);

  // ---------------------------------------------------------------------------------------
  // Parameter classification
  //
  // Transcribed from src/js/modules/ministryplatform.js. A query's parameters are not a flat
  // form: three of them are event pickers wearing different clothes, and which one you get is
  // decided by the parameter's *name and type*, not by a field that says so.
  // ---------------------------------------------------------------------------------------

  type ParamKind = 'dateRange' | 'eventId' | 'eventName' | 'plain';

  function classify(key: string, config: MpQueryParam): ParamKind {
    const mentionsDays = config.label?.toLowerCase().includes('day') ?? false;
    const mentionsDateRange = config.description?.toLowerCase().includes('date range') ?? false;
    if (config.label && (mentionsDays || mentionsDateRange)) return 'dateRange';
    if (key === 'eventId' && config.type === 'number') return 'eventId';
    if (key === 'eventId' && config.type === 'text') return 'eventName';
    return 'plain';
  }

  /** A parameter the operator never sees: it carries its own value, or its own event search. */
  function isPreconfigured(config: MpQueryParam): boolean {
    if (config.value || config.searchTerm) return true;
    return config.daysPast !== undefined && config.daysFuture !== undefined;
  }

  function paramEntries(query: MpQuery | null): Array<[string, MpQueryParam]> {
    return Object.entries(query?.params ?? {});
  }

  // ---------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------

  let queries = $state<MpQuery[]>([]);
  let loadingQueries = $state(true);
  let queryId = $state('');
  let errorMessage = $state<string | null>(null);

  /** Every operator-supplied parameter value, keyed by parameter name. */
  let paramValues = $state<Record<string, string>>({});
  /** Days past / days future per date-range parameter. */
  let dateRanges = $state<Record<string, { past: string; future: string }>>({});
  let eventNameSearch = $state('');

  let events = $state<MpEvent[]>([]);
  let eventParamKey = $state<string | null>(null);
  let selectedEventIds = $state<string[]>([]);
  let loadingEvents = $state(false);
  let eventSearchRan = $state(false);

  let records = $state<MpRecord[] | null>(null);
  let executing = $state(false);

  let nameOverride = $state<string | null>(null);

  const currentQuery = $derived<MpQuery | null>(queries.find((query) => query.id === queryId) ?? null);

  const visibleParams = $derived(
    paramEntries(currentQuery)
      .filter(([, config]) => !isPreconfigured(config))
      .map(([key, config]) => ({ key, config, kind: classify(key, config) }))
      // The event-name picker gets its own block below, exactly as the old module did.
      .filter((param) => param.kind !== 'eventName')
  );

  const needsEventNameInput = $derived(
    paramEntries(currentQuery).find(
      ([, config]) => config.type === 'text' && !config.searchTerm && !config.value && config.required
    ) ?? null
  );

  const suggestedName = $derived(currentQuery?.name ?? '');
  const listName = $derived(nameOverride ?? suggestedName);

  /** Grouped into `<optgroup>`s, in first-seen category order — the backend's own ordering. */
  const grouped = $derived.by(() => {
    const groups: Array<{ category: string; items: MpQuery[] }> = [];
    for (const query of queries) {
      const category = query.category || query.metadata?.category || 'Other';
      const existing = groups.find((group) => group.category === category);
      if (existing) existing.items.push(query);
      else groups.push({ category, items: [query] });
    }
    return groups;
  });

  const previewFields = $derived.by(() => {
    if (!records || records.length === 0) return [];
    // An empty array is truthy: queries made in the query editor are seeded with
    // `previewFields: []`, and falling through with that renders a table of zero columns.
    const configured = currentQuery?.metadata?.previewFields;
    if (configured?.length) return configured;
    return Object.keys(records[0] ?? {});
  });

  const previewRows = $derived(records?.slice(0, 10) ?? []);

  // ---------------------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------------------

  async function loadQueries() {
    loadingQueries = true;
    errorMessage = null;
    try {
      queries = await api.mpGetQueries();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Could not load queries.';
    } finally {
      loadingQueries = false;
    }
  }

  // Safe at component creation: this dialog only exists once it has been opened, and the app
  // does not server-render (src/routes/+layout.ts sets `ssr = false`).
  void loadQueries();

  /**
   * Everything downstream of the query is reset here, in the change handler, rather than by an
   * effect watching `queryId` — an effect that clears state it does not own is how the old
   * module ended up with a stale preview under a freshly chosen query.
   */
  async function selectQuery(nextId: string) {
    queryId = nextId;
    paramValues = {};
    dateRanges = {};
    eventNameSearch = '';
    events = [];
    eventParamKey = null;
    selectedEventIds = [];
    eventSearchRan = false;
    records = null;
    nameOverride = null;
    errorMessage = null;

    const query = queries.find((candidate) => candidate.id === nextId);
    if (!query) return;

    const entries = paramEntries(query);

    // Auto-execute only when every required parameter carries a hardcoded value AND no
    // parameter is an event search — an event search has to be answered first.
    const allRequiredHardcoded = entries.every(([, config]) => !config.required || !!config.value);
    const hasSearchOrDateRange = entries.some(
      ([, config]) => config.searchTerm || config.daysPast || config.daysFuture
    );

    if (allRequiredHardcoded && !hasSearchOrDateRange) {
      await executeQuery();
    } else if (hasSearchOrDateRange) {
      await loadEventsForSelection(query);
    }
    // Anything else needs the operator: the parameter blocks below are already rendered.
  }

  /** The parameter an event search answers: `eventId`, or whichever one carries the search. */
  function eventParamOf(query: MpQuery): [string, MpQueryParam] | undefined {
    return paramEntries(query).find(
      ([key, config]) => key === 'eventId' || !!config.searchTerm || !!config.daysPast || !!config.daysFuture
    );
  }

  async function loadEventsForSelection(query: MpQuery) {
    const found = eventParamOf(query);
    if (!found) return;
    const [key, config] = found;

    await searchEvents(key, {
      searchTerm: config.searchTerm,
      daysPast: config.daysPast,
      daysFuture: config.daysFuture
    });
  }

  async function searchEvents(key: string, search: api.MpEventSearch) {
    loadingEvents = true;
    eventSearchRan = true;
    errorMessage = null;
    eventParamKey = key;
    selectedEventIds = [];
    try {
      events = await api.mpSearchEvents(search);
    } catch (error) {
      events = [];
      errorMessage = error instanceof Error ? error.message : 'Could not load events.';
    } finally {
      loadingEvents = false;
    }
  }

  function searchByDateRange(key: string) {
    const range = dateRanges[key] ?? { past: '3', future: '3' };
    void searchEvents(key, {
      daysPast: Number(range.past) || 0,
      daysFuture: Number(range.future) || 0
    });
  }

  function searchByName() {
    const term = eventNameSearch.trim();
    const target = needsEventNameInput;
    if (!term) {
      toasts.warning('Please enter an event name.');
      return;
    }
    if (!target) return;
    void searchEvents(target[0], { searchTerm: term });
  }

  function useSelectedEvents() {
    if (!eventParamKey) return;
    if (selectedEventIds.length === 0) {
      toasts.warning('Please select at least one event.');
      return;
    }
    paramValues = { ...paramValues, [eventParamKey]: selectedEventIds.join(', ') };
    void executeQuery();
  }

  /** The value that will actually be sent for a parameter — hardcoded, then typed, then default. */
  function valueFor(key: string, config: MpQueryParam): string {
    if (config.value) return config.value;
    return paramValues[key] ?? config.defaultValue ?? '';
  }

  function collectParams(query: MpQuery): Record<string, string> {
    const collected: Record<string, string> = {};
    for (const [key, config] of paramEntries(query)) {
      const value = valueFor(key, config);
      if (value) collected[key] = value;
    }
    return collected;
  }

  async function executeQuery() {
    const query = currentQuery;
    if (!query) return;

    executing = true;
    errorMessage = null;
    try {
      records = await api.mpExecuteQuery(query.id, collectParams(query));
    } catch (error) {
      records = null;
      errorMessage = error instanceof Error ? error.message : 'Could not execute the query.';
    } finally {
      executing = false;
    }
  }

  function configureImport() {
    const query = currentQuery;
    if (!query || !records || records.length === 0) {
      toasts.warning('There are no records to import.');
      return;
    }

    const rows = records.map(mpRecordToRow);

    onready({
      rows,
      headers: fieldNames(rows),
      listName: listName.trim() || query.name,
      fileName: `MinistryPlatform_${query.name}.json`,
      mpSource: {
        queryId: query.id,
        queryName: query.name,
        // The parameters actually sent, so a later sync re-runs the same query.
        params: collectParams(query),
        importedAt: Date.now()
      }
    });
    open = false;
  }

  function eventLabel(event: MpEvent): string {
    const date = event.eventStartDate
      ? new Date(event.eventStartDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
      : '—';
    return `${event.eventID} | ${date} | ${event.eventTitle || 'Unnamed Event'}`;
  }
</script>

<Dialog bind:open title="Import from Ministry Platform" size="modal-lg" {onclose}>
  <div class="mb-3">
    <label for="mp-query" class="form-label">Select Query</label>
    <select
      id="mp-query"
      class="form-select"
      value={queryId}
      disabled={loadingQueries}
      onchange={(event) => void selectQuery(event.currentTarget.value)}
    >
      <option value="">{loadingQueries ? 'Loading queries…' : 'Select a query…'}</option>
      {#each grouped as group (group.category)}
        <optgroup label={group.category}>
          {#each group.items as query (query.id)}
            <option value={query.id}>{query.name}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
    {#if currentQuery?.description}
      <div class="form-text">{currentQuery.description}</div>
    {/if}
  </div>

  {#if visibleParams.length > 0 || needsEventNameInput}
    <h6 class="mb-3">Query Parameters</h6>

    {#each visibleParams as param (param.key)}
      <div class="mb-3 query-param-row">
        {#if param.kind === 'dateRange'}
          {@const range = dateRanges[param.key] ?? { past: '3', future: '3' }}
          <span class="form-label d-block" id="mp-range-{param.key}-label">
            <i class="bi bi-calendar-range me-2" aria-hidden="true"></i>Date Range
            <span class="text-danger" aria-hidden="true">*</span>
          </span>
          <div class="row g-2">
            <div class="col-6">
              <label class="form-label small" for="mp-range-{param.key}-past">Days Past</label>
              <input
                id="mp-range-{param.key}-past"
                type="number"
                min="0"
                class="form-control"
                placeholder="e.g. 3"
                value={range.past}
                oninput={(event) =>
                  (dateRanges = {
                    ...dateRanges,
                    [param.key]: { ...range, past: event.currentTarget.value }
                  })}
              />
            </div>
            <div class="col-6">
              <label class="form-label small" for="mp-range-{param.key}-future">Days Future</label>
              <input
                id="mp-range-{param.key}-future"
                type="number"
                min="0"
                class="form-control"
                placeholder="e.g. 3"
                value={range.future}
                oninput={(event) =>
                  (dateRanges = {
                    ...dateRanges,
                    [param.key]: { ...range, future: event.currentTarget.value }
                  })}
              />
            </div>
          </div>
          <button
            type="button"
            class="btn btn-primary mt-2"
            disabled={loadingEvents}
            onclick={() => searchByDateRange(param.key)}
          >
            <i class="bi bi-search me-2" aria-hidden="true"></i>Search Events
          </button>
        {:else if param.kind === 'eventId'}
          <label class="form-label" for="mp-param-{param.key}">
            {param.config.label || 'Event ID'}
            <span class="text-danger" aria-hidden="true">*</span>
          </label>
          <div class="input-group">
            <input
              id="mp-param-{param.key}"
              type="text"
              class="form-control"
              autocomplete="off"
              inputmode="numeric"
              pattern="[0-9, ]+"
              placeholder="Enter event ID(s) separated by commas (e.g. 71619, 71141)"
              value={valueFor(param.key, param.config)}
              oninput={(event) => (paramValues = { ...paramValues, [param.key]: event.currentTarget.value })}
            />
            <button
              type="button"
              class="btn btn-primary"
              disabled={executing}
              onclick={() => {
                if (!valueFor(param.key, param.config).trim()) {
                  toasts.warning('Please enter event ID(s).');
                  return;
                }
                void executeQuery();
              }}
            >
              <i class="bi bi-search me-2" aria-hidden="true"></i>Search Events
            </button>
          </div>
        {:else}
          <label class="form-label" for="mp-param-{param.key}">
            {param.config.label || param.key}
            {#if param.config.required}<span class="text-danger" aria-hidden="true">*</span>{/if}
          </label>
          <div class="input-group">
            <input
              id="mp-param-{param.key}"
              type={param.config.type === 'number' ? 'number' : 'text'}
              class="form-control"
              placeholder={param.config.placeholder || `Enter ${param.config.label || param.key}`}
              value={valueFor(param.key, param.config)}
              oninput={(event) => (paramValues = { ...paramValues, [param.key]: event.currentTarget.value })}
            />
            <button
              type="button"
              class="btn btn-primary"
              disabled={executing}
              onclick={() => {
                if (param.config.required && !valueFor(param.key, param.config).trim()) {
                  toasts.warning(`Please enter ${param.config.label || param.key}.`);
                  return;
                }
                void executeQuery();
              }}
            >
              <i class="bi bi-search me-2" aria-hidden="true"></i>Search
            </button>
          </div>
          {#if param.config.description}
            <div class="form-text">{param.config.description}</div>
          {/if}
        {/if}
      </div>
    {/each}

    {#if needsEventNameInput}
      {@const [key, config] = needsEventNameInput}
      <div class="mb-3 query-param-row">
        <label class="form-label" for="mp-event-name">
          {config.label || key}
          <span class="text-danger" aria-hidden="true">*</span>
        </label>
        <div class="input-group">
          <input
            id="mp-event-name"
            type="text"
            class="form-control"
            autocomplete="off"
            placeholder="Enter event name to search"
            bind:value={eventNameSearch}
            onkeydown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              searchByName();
            }}
          />
          <button type="button" class="btn btn-primary" disabled={loadingEvents} onclick={searchByName}>
            <i class="bi bi-search me-2" aria-hidden="true"></i>Search Events
          </button>
        </div>
      </div>
    {/if}
  {/if}

  {#if loadingEvents}
    <div class="alert alert-info d-flex align-items-center gap-2" role="status">
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
      Searching for events…
    </div>
  {:else if eventSearchRan && events.length === 0 && !errorMessage}
    <div class="alert alert-warning" role="status">No events found matching the criteria.</div>
  {:else if events.length > 0}
    <div class="mb-3">
      <label class="form-label" for="mp-events">
        <i class="bi bi-calendar-check me-2" aria-hidden="true"></i>
        Select Events ({events.length} found)
      </label>
      <select
        id="mp-events"
        class="form-select"
        multiple
        size={Math.min(10, events.length)}
        bind:value={selectedEventIds}
      >
        {#each events as event (event.eventID)}
          <option value={String(event.eventID)}>{eventLabel(event)}</option>
        {/each}
      </select>

      <div class="d-flex justify-content-between align-items-center mt-2 gap-2 flex-wrap">
        <div class="btn-group btn-group-sm" role="group" aria-label="Event selection">
          <button
            type="button"
            class="btn btn-outline-secondary"
            onclick={() => (selectedEventIds = events.map((event) => String(event.eventID)))}
          >
            Select All
          </button>
          <button type="button" class="btn btn-outline-secondary" onclick={() => (selectedEventIds = [])}>
            Select None
          </button>
        </div>
        <button type="button" class="btn btn-primary" disabled={executing} onclick={useSelectedEvents}>
          {#if executing}
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
          {:else}
            <i class="bi bi-search me-2" aria-hidden="true"></i>
          {/if}
          Get Participants
        </button>
      </div>
    </div>
  {/if}

  {#if executing}
    <div class="alert alert-info d-flex align-items-center gap-2" role="status">
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
      Running the query…
    </div>
  {:else if records}
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h6 class="mb-0">Preview</h6>
      <span class="badge bg-primary">
        {formatNumber(records.length)}
        {pluralise(records.length, 'record')}
      </span>
    </div>

    <div class="table-responsive mp-preview-scroll">
      <!--
        The roles are load-bearing, not redundant: responsive.css §7 switches `.table-stack` to
        `display: block` below md, which strips the implicit table semantics these restore.
      -->
      <!-- svelte-ignore a11y_no_redundant_roles -->
      <table class="table table-sm table-striped table-stack" role="table">
        <!-- svelte-ignore a11y_no_redundant_roles -->
        <thead role="rowgroup">
          <!-- svelte-ignore a11y_no_redundant_roles -->
          <tr role="row">
            {#each previewFields as field (field)}
              <th scope="col">{field}</th>
            {/each}
          </tr>
        </thead>
        <!-- svelte-ignore a11y_no_redundant_roles -->
        <tbody role="rowgroup">
          {#each previewRows as record, index (index)}
            <!-- svelte-ignore a11y_no_redundant_roles -->
            <tr role="row">
              {#each previewFields as field (field)}
                <td role="cell" data-label={field}>{record[field] ?? ''}</td>
              {/each}
            </tr>
          {:else}
            <tr class="table-stack-empty">
              <td
                role="cell"
                data-label=""
                colspan={Math.max(1, previewFields.length)}
                class="text-center text-muted"
              >
                No data returned
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if records.length > previewRows.length}
      <p class="text-muted small mb-0">
        … and {formatNumber(records.length - previewRows.length)} more records.
      </p>
    {/if}
  {/if}

  <div class="mb-0 mt-3">
    <label for="mp-list-name" class="form-label">List Name</label>
    <input
      id="mp-list-name"
      type="text"
      class="form-control"
      placeholder="e.g. Youth Group Members"
      value={listName}
      oninput={(event) => (nameOverride = event.currentTarget.value)}
    />
  </div>

  {#if errorMessage}
    <div class="alert alert-danger mt-3 mb-0" role="alert">{errorMessage}</div>
  {/if}

  {#snippet footer()}
    <button type="button" class="btn btn-secondary" onclick={() => (open = false)}>Cancel</button>
    {#if records && records.length > 0}
      <button type="button" class="btn btn-primary" onclick={configureImport}>
        <i class="bi bi-gear me-2" aria-hidden="true"></i>Configure Import
      </button>
    {/if}
  {/snippet}
</Dialog>

<style>
  /* Height only, and viewport-independent — responsive.css owns the width rules. */
  .mp-preview-scroll {
    max-height: 300px;
    overflow-y: auto;
  }
</style>
