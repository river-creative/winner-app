<script lang="ts">
  import Dialog from '$lib/components/Dialog.svelte';
  import { REPORT_TIME_RANGES, REPORT_TYPES } from '$lib/constants/options';
  import type { ImportSource } from '$lib/services/lists';
  import { toasts } from '$lib/state/toasts.svelte';
  import * as api from '$lib/api/client';
  import { parseCsv } from '$lib/utils/csv';

  interface Props {
    onclose: () => void;
    /** Hands the parsed rows to the import wizard. */
    onready: (source: ImportSource) => void;
  }

  let { onclose, onready }: Props = $props();

  let open = $state(true);
  let fetching = $state(false);

  /**
   * Progress is shown inside this dialog rather than through the shared `ui.withProgress`
   * overlay: a native `<dialog>` opened with `showModal()` lives in the browser's top layer, so
   * that overlay would run behind it and never be seen.
   */
  let status = $state('');

  let reportType = $state('');
  let eventId = $state('19');
  let timeRange = $state<string>(REPORT_TIME_RANGES[0].value);
  let customStart = $state('');
  let customEnd = $state('');

  const reportLabel = $derived(REPORT_TYPES.find((option) => option.value === reportType)?.label ?? '');
  const timeLabel = $derived(REPORT_TIME_RANGES.find((option) => option.value === timeRange)?.label ?? '');

  /**
   * The suggested name follows the two selects until the operator types something.
   *
   * Held as an override rather than copied into the field by an effect: an effect watching the
   * selects and writing the name would overwrite whatever the operator had already typed, which
   * is exactly what the old `updateListName` handler did.
   */
  let nameOverride = $state<string | null>(null);
  const suggestedName = $derived(
    reportType ? `${reportLabel.replace(' (License Required)', '')} - ${timeLabel}` : ''
  );
  const listName = $derived(nameOverride ?? suggestedName);

  async function importReport() {
    if (!reportType) {
      toasts.warning('Please choose a report type.');
      return;
    }
    if (!eventId.trim()) {
      toasts.warning('Please enter an event ID.');
      return;
    }
    if (timeRange === 'custom' && (!customStart || !customEnd)) {
      toasts.warning('Please specify custom start and end times.');
      return;
    }

    const params: Record<string, string> = {
      event_id: eventId.trim(),
      report_type: timeRange
    };
    if (timeRange === 'custom') {
      params.custom_start = customStart;
      params.custom_end = customEnd;
    }

    fetching = true;
    status = 'Fetching data from the reports server…';
    try {
      const csv = await api.fetchReportCsv(reportType, params);

      // The upstream answers 200 with this sentence rather than an empty CSV.
      if (!csv.trim() || csv.trim() === 'No data found') {
        throw new Error('No entries found in the report for the selected time range.');
      }

      status = 'Parsing CSV data…';
      const parsed = parseCsv(csv);

      // Aborted rather than partially imported: a ragged row means the column count is wrong,
      // and importing the rows that happened to line up hides that from the operator.
      if (parsed.errors.length > 0) {
        throw new Error(`Could not parse the report: ${parsed.errors.slice(0, 3).join(' ')}`);
      }
      if (parsed.data.length === 0) {
        throw new Error('No entries found in the report.');
      }

      const source: ImportSource = {
        rows: parsed.data,
        headers: parsed.headers,
        listName: listName.trim() || suggestedName || 'Giveaway Report',
        fileName: `${reportType}_${eventId.trim()}_${timeRange}.csv`,
        mpSource: null
      };

      toasts.success(`Fetched ${source.rows.length} entries. Configure how the data should be displayed.`);
      onready(source);
      open = false;
    } catch (error) {
      toasts.fromError(error, 'Could not import the report.');
    } finally {
      fetching = false;
      status = '';
    }
  }
</script>

<Dialog bind:open title="Import from Giveaway Report" size="modal-lg" {onclose}>
  <div class="mb-3">
    <label for="report-type" class="form-label">Report Type</label>
    <select id="report-type" class="form-select" bind:value={reportType} required>
      <option value="">Select a report…</option>
      {#each REPORT_TYPES as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>

  <div class="mb-3">
    <label for="report-event-id" class="form-label">Event ID</label>
    <!--
      `value`/`oninput` rather than `bind:value`: Svelte coerces a bound `type="number"` input to
      a JS number, which would turn this state into a number and make `eventId.trim()` throw. The
      id is passed to the reports API as a query-string value, so it stays a string throughout.
    -->
    <input
      id="report-event-id"
      type="number"
      class="form-control"
      value={eventId}
      required
      oninput={(event) => (eventId = event.currentTarget.value)}
    />
  </div>

  <div class="mb-3">
    <label for="report-time-range" class="form-label">Time Range</label>
    <select id="report-time-range" class="form-select" bind:value={timeRange} required>
      {#each REPORT_TIME_RANGES as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>

  {#if timeRange === 'custom'}
    <div class="row">
      <div class="col-md-6 mb-3">
        <label for="report-custom-start" class="form-label">Start Time</label>
        <input id="report-custom-start" type="datetime-local" class="form-control" bind:value={customStart} />
      </div>
      <div class="col-md-6 mb-3">
        <label for="report-custom-end" class="form-label">End Time</label>
        <input id="report-custom-end" type="datetime-local" class="form-control" bind:value={customEnd} />
      </div>
    </div>
  {/if}

  <div class="mb-0">
    <label for="report-list-name" class="form-label">List Name</label>
    <input
      id="report-list-name"
      type="text"
      class="form-control"
      placeholder="e.g. Morning Car Giveaway"
      value={listName}
      oninput={(event) => (nameOverride = event.currentTarget.value)}
    />
    <div class="form-text">Filled in from the report and time range until you change it.</div>
  </div>

  {#if status}
    <div class="alert alert-info d-flex align-items-center gap-2 mt-3 mb-0" role="status">
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
      {status}
    </div>
  {/if}

  {#snippet footer()}
    <button type="button" class="btn btn-secondary" disabled={fetching} onclick={() => (open = false)}>
      Cancel
    </button>
    <button
      type="button"
      class="btn btn-primary"
      disabled={fetching || !reportType}
      onclick={() => void importReport()}
    >
      {#if fetching}
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      {:else}
        <i class="bi bi-download me-2" aria-hidden="true"></i>
      {/if}
      Import Report
    </button>
  {/snippet}
</Dialog>
