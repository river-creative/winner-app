<script lang="ts">
  import { tick } from 'svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import { buildList, entryIdFor, existingWinnerIds, saveList, type ImportSource } from '$lib/services/lists';
  import { data } from '$lib/state/data.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import type { IdConfig } from '$lib/types';
  import { detectIdColumn, detectNameTemplate, validateColumnIds } from '$lib/utils/csv';
  import { applyTemplate, formatNumber, pluralise } from '$lib/utils/format';
  import WinnerBehaviourFields from './WinnerBehaviourFields.svelte';

  /** Kept out of the markup because a bare `{` in an attribute starts a Svelte expression. */
  const NAME_TEMPLATE_PLACEHOLDER = '{lastName}, {firstName}';

  interface Props {
    /**
     * The rows to import. Read once at creation — the parent wraps this component in `{#key}` so
     * a second import always gets a fresh instance rather than these fields being re-seeded by
     * an effect.
     */
    source: ImportSource;
    onclose: () => void;
  }

  let { source, onclose }: Props = $props();

  let open = $state(true);

  const STEPS = [
    { number: 1, label: 'Record ID', icon: 'bi-key', title: 'Record ID Configuration' },
    { number: 2, label: 'Import Options', icon: 'bi-filter', title: 'Import Options' },
    { number: 3, label: 'Winner Behavior', icon: 'bi-trophy', title: 'Winner Behavior' },
    { number: 4, label: 'Display Name', icon: 'bi-person-badge', title: 'Display Name' },
    { number: 5, label: 'Card Display', icon: 'bi-card-heading', title: 'Winner Card Display' }
  ] as const;
  const TOTAL_STEPS = STEPS.length;

  let step = $state(1);
  let importing = $state(false);

  /**
   * Import progress is reported inside this dialog rather than through `ui.withProgress`.
   *
   * The shared overlay is an ordinary positioned element and this is a native `<dialog>` opened
   * with `showModal()`, which puts it in the browser's top layer — above every z-index on the
   * page. The overlay would run, and be invisible, behind the wizard.
   */
  let importPercent = $state(0);
  let importStatus = $state('');

  function report(percent: number, text: string) {
    importPercent = percent;
    importStatus = text;
  }

  /*
   * `source` is read once, on purpose: it is the fixed input to this wizard run, and every field
   * below is seeded from it. The parent wraps this component in `{#key source}`, so a second
   * import destroys and rebuilds it rather than mutating a run already in progress — which is
   * what makes reading the initial value correct rather than a missed reactive dependency.
   */
  // svelte-ignore state_referenced_locally
  const headers = source.headers;
  // svelte-ignore state_referenced_locally
  const firstRow = source.rows[0] ?? {};

  const detectedIdColumn = detectIdColumn(headers);
  const detectedNameTemplate = detectNameTemplate(headers);

  // svelte-ignore state_referenced_locally
  let listName = $state(source.listName);

  /**
   * Defaults to auto-generated ids when no column looks like one.
   *
   * The old form defaulted to "use a column" with nothing selected, so an operator who pressed
   * "Use Defaults" on a file with no id column got a validation error instead of an import.
   */
  let idSource = $state<'auto' | 'column'>(detectedIdColumn ? 'column' : 'auto');
  let idColumn = $state(detectedIdColumn ?? '');
  let idAutoSelected = $state(detectedIdColumn !== undefined);

  let skipExistingWinners = $state(settings.current.skipExistingWinners);
  let removeWinners = $state(settings.current.preventDuplicates);
  let preventSamePrize = $state(settings.current.preventSamePrize);

  let nameTemplate = $state(detectedNameTemplate);

  // info1 names the record, info2 repeats the display name, info3 is left for the operator —
  // the same defaults the Alpine form seeded.
  let info1 = $state(detectedIdColumn ? `{${detectedIdColumn}}` : headers[0] ? `{${headers[0]}}` : '');
  let info2 = $state(detectedNameTemplate);
  let info3 = $state('');

  let nameInput = $state<HTMLInputElement>();
  let info1Input = $state<HTMLInputElement>();
  let info2Input = $state<HTMLInputElement>();
  let info3Input = $state<HTMLInputElement>();

  /** Which of the three card fields a chip should insert into. Set by focus, as before. */
  let lastFocusedInfo = $state<'info1' | 'info2' | 'info3'>('info1');

  const namePreview = $derived(applyTemplate(nameTemplate, firstRow));
  const info1Preview = $derived(applyTemplate(info1, firstRow));
  const info2Preview = $derived(applyTemplate(info2, firstRow));
  const info3Preview = $derived(applyTemplate(info3, firstRow));

  const progressWidth = $derived(((step - 1) / (TOTAL_STEPS - 1)) * 100);
  const currentStep = $derived(STEPS[step - 1] ?? STEPS[0]);

  /**
   * Insert `{field}` at the caret rather than appending it.
   *
   * `tick()` first: the value is bound to state, so the DOM only holds the new text after Svelte
   * has flushed — setting the selection before that would place the caret in the old string.
   */
  async function insertField(
    field: string,
    current: string,
    input: HTMLInputElement | undefined,
    apply: (next: string) => void
  ) {
    const caret = input?.selectionStart ?? current.length;
    const placeholder = `{${field}}`;
    apply(current.slice(0, caret) + placeholder + current.slice(caret));

    await tick();
    input?.focus();
    const position = caret + placeholder.length;
    input?.setSelectionRange(position, position);
  }

  function insertIntoLastFocusedInfo(field: string) {
    if (lastFocusedInfo === 'info2') {
      void insertField(field, info2, info2Input, (next) => (info2 = next));
    } else if (lastFocusedInfo === 'info3') {
      void insertField(field, info3, info3Input, (next) => (info3 = next));
    } else {
      void insertField(field, info1, info1Input, (next) => (info1 = next));
    }
  }

  function setSkipExistingWinners(checked: boolean) {
    skipExistingWinners = checked;
    // The checkbox is also the global preference, exactly as the old form treated it.
    settings.set('skipExistingWinners', checked);
  }

  async function runImport() {
    if (importing) return;

    const idConfig: IdConfig =
      idSource === 'column' ? { source: 'column', column: idColumn } : { source: 'auto' };

    if (idConfig.source === 'column') {
      if (!idColumn) {
        toasts.warning('Please select a column for record IDs.');
        step = 1;
        return;
      }
      const validation = validateColumnIds(source.rows, idColumn);
      if (!validation.valid) {
        toasts.error(`ID validation failed: ${validation.error ?? 'unknown problem.'}`);
        step = 1;
        return;
      }
    }

    const finalName = listName.trim() || source.listName;
    if (!finalName) {
      toasts.warning('Please give the list a name.');
      return;
    }

    importing = true;
    report(10, 'Preparing records…');
    try {
      /*
       * Each row's id is computed ONCE, here, and the same value is used both for the winner
       * filter below and for the stored entry.
       *
       * The old importer called its id generator twice — once inside the filter and once when
       * building the entries — so with auto-generated ids the two never matched and "skip
       * records that have already won" silently skipped nothing.
       */
      const identified = source.rows.map((row) => ({ row, id: entryIdFor(row, idConfig) }));

      let kept = identified;
      let skipped = 0;

      if (skipExistingWinners) {
        report(30, 'Checking for existing winners…');
        const winnerIds = existingWinnerIds(data.winners);
        kept = identified.filter((candidate) => !winnerIds.has(candidate.id));
        skipped = identified.length - kept.length;

        if (kept.length === 0) {
          throw new Error('Every record in this import has already won a prize. Nothing was imported.');
        }
      }

      report(50, 'Creating list structure…');
      const list = buildList({
        name: finalName,
        originalFilename: source.fileName,
        rows: kept.map((candidate) => candidate.row),
        ids: kept.map((candidate) => candidate.id),
        originalCount: source.rows.length,
        skippedWinners: skipped,
        nameConfig: nameTemplate.trim(),
        infoConfig: { info1: info1.trim(), info2: info2.trim(), info3: info3.trim() },
        idConfig,
        listSettings: {
          removeWinnersFromList: removeWinners,
          // Forced on for a list that keeps its winners — see WinnerBehaviourFields.
          preventWinningSamePrize: removeWinners ? preventSamePrize : true
        },
        mpSource: source.mpSource
      });

      report(75, 'Saving…');
      await saveList(list);
      report(100, 'Complete.');

      const skippedText = skipped
        ? ` (${formatNumber(skipped)} already-won ${pluralise(skipped, 'record')} skipped)`
        : '';
      toasts.success(
        `List "${list.metadata.name}" imported with ${formatNumber(list.entries.length)} ${pluralise(list.entries.length, 'entry', 'entries')}${skippedText}.`
      );

      open = false;
    } catch (error) {
      toasts.fromError(error, 'Could not import the list. Nothing was saved.');
    } finally {
      importing = false;
    }
  }
</script>

<Dialog bind:open title="Configure Import" size="modal-xl" {onclose}>
  <div class="import-wizard">
    <div class="mb-3">
      <label for="import-list-name" class="form-label">List Name</label>
      <input
        id="import-list-name"
        type="text"
        class="form-control"
        placeholder={source.listName}
        bind:value={listName}
      />
      <div class="form-text">
        {formatNumber(source.rows.length)}
        {pluralise(source.rows.length, 'record')} from {source.fileName}
      </div>
    </div>

    <div class="wizard-progress mb-4">
      <div class="d-flex justify-content-between align-items-center position-relative">
        <div class="wizard-progress-line"></div>
        <div class="wizard-progress-line-active" style="width: {progressWidth}%"></div>

        {#each STEPS as item (item.number)}
          <button
            type="button"
            class="wizard-step"
            class:active={step >= item.number}
            class:current={step === item.number}
            aria-current={step === item.number ? 'step' : undefined}
            aria-label="Step {item.number} of {TOTAL_STEPS}: {item.label}"
            onclick={() => (step = item.number)}
          >
            <span class="wizard-step-circle">
              {#if step > item.number}
                <i class="bi bi-check" aria-hidden="true"></i>
              {:else}
                {item.number}
              {/if}
            </span>
            <span class="wizard-step-label">{item.label}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="wizard-content">
      <!--
        Keyed on the step so `.wizard-pane`'s fade-in animation replays on every move. The Alpine
        version rendered five panes and toggled them, which had the same effect; one pane whose
        contents merely swap would run the animation once, on open, and never again.
      -->
      {#key step}
        <div class="wizard-pane">
          <h5 class="mb-3">
            <i class="bi {currentStep.icon} me-2 text-primary" aria-hidden="true"></i>
            {currentStep.title}
          </h5>

          {#if step === 1}
            <p class="text-muted mb-4">Configure how each record is uniquely identified.</p>

            <fieldset class="mb-3">
              <legend class="form-label">Record ID Source</legend>

              <div class="form-check">
                <input
                  class="form-check-input"
                  type="radio"
                  name="import-id-source"
                  id="import-id-auto"
                  value="auto"
                  checked={idSource === 'auto'}
                  onchange={() => (idSource = 'auto')}
                />
                <label class="form-check-label" for="import-id-auto"> Auto-generate unique IDs </label>
                <div class="form-text">System will create unique identifiers automatically.</div>
              </div>

              <div class="form-check mt-2">
                <input
                  class="form-check-input"
                  type="radio"
                  name="import-id-source"
                  id="import-id-column"
                  value="column"
                  checked={idSource === 'column'}
                  onchange={() => (idSource = 'column')}
                />
                <label class="form-check-label" for="import-id-column"> Use column as record ID </label>
                <div class="form-text">
                  Use an existing column (e.g. employee ID, email) as the unique identifier.
                </div>
              </div>
            </fieldset>

            {#if idSource === 'column'}
              <div class="mb-0">
                <label for="import-id-column-select" class="form-label">
                  Select ID Column
                  {#if idAutoSelected}
                    <small class="text-success ms-2">
                      <i class="bi bi-check-circle" aria-hidden="true"></i> Auto-selected
                    </small>
                  {/if}
                </label>
                <select
                  id="import-id-column-select"
                  class="form-select"
                  value={idColumn}
                  onchange={(event) => {
                    idColumn = event.currentTarget.value;
                    // The badge only ever claims the *initial* guess, so the first manual
                    // change clears it.
                    idAutoSelected = false;
                  }}
                >
                  <option value="">Select a column…</option>
                  {#each headers as header (header)}
                    <option value={header}>{header}</option>
                  {/each}
                </select>
                <div class="form-text">Selected column values must be unique for each record.</div>
              </div>
            {/if}
          {:else if step === 2}
            <p class="text-muted mb-4">Configure how records should be processed during import.</p>

            <div class="form-check mb-3">
              <input
                class="form-check-input"
                type="checkbox"
                id="import-skip-winners"
                checked={skipExistingWinners}
                onchange={(event) => setSkipExistingWinners(event.currentTarget.checked)}
              />
              <label class="form-check-label" for="import-skip-winners">
                Skip records that are already in the winner list
              </label>
              <div class="form-text">
                Records are matched by their unique ID. Records with the same name but different IDs will
                still be uploaded.
              </div>
            </div>
          {:else if step === 3}
            <p class="text-muted mb-4">Configure how winners are handled after selection.</p>

            <WinnerBehaviourFields
              idPrefix="import"
              bind:removeWinners
              bind:preventSamePrize
              noticeVariant="warning"
            />
          {:else if step === 4}
            <p class="text-muted mb-4">
              Configure how names are displayed in lists. Click a field below to insert it at the cursor.
            </p>

            <div class="row">
              <div class="col-lg-6">
                <div class="mb-3">
                  <label for="import-name-template" class="form-label">Name Template</label>
                  <input
                    bind:this={nameInput}
                    id="import-name-template"
                    type="text"
                    class="form-control"
                    placeholder={NAME_TEMPLATE_PLACEHOLDER}
                    bind:value={nameTemplate}
                  />
                </div>
              </div>
              <div class="col-lg-6">
                <div class="mb-3">
                  <span class="form-label d-block" id="import-name-preview-label">Preview</span>
                  <div
                    class="p-2 border rounded template-preview"
                    aria-labelledby="import-name-preview-label"
                    aria-live="polite"
                  >
                    {namePreview}
                  </div>
                </div>
              </div>
            </div>

            <div class="mb-0">
              <span class="form-label d-block" id="import-name-fields-label">Available Fields</span>
              <div class="d-flex flex-wrap gap-2" aria-labelledby="import-name-fields-label">
                {#each headers as header (header)}
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    onclick={() =>
                      void insertField(header, nameTemplate, nameInput, (next) => (nameTemplate = next))}
                  >
                    {header}
                  </button>
                {/each}
              </div>
            </div>
          {:else}
            <p class="text-muted mb-4">
              Configure what information appears on winner cards during selection.
            </p>

            <div class="row">
              <div class="col-lg-4">
                <div class="mb-3">
                  <label for="import-info1" class="form-label">
                    Info 1 <span class="text-muted small">(Primary)</span>
                  </label>
                  <input
                    bind:this={info1Input}
                    id="import-info1"
                    type="text"
                    class="form-control"
                    bind:value={info1}
                    onfocus={() => (lastFocusedInfo = 'info1')}
                  />
                  <div class="form-text">Main identifier</div>
                </div>
              </div>
              <div class="col-lg-4">
                <div class="mb-3">
                  <label for="import-info2" class="form-label">
                    Info 2 <span class="text-muted small">(Secondary)</span>
                  </label>
                  <input
                    bind:this={info2Input}
                    id="import-info2"
                    type="text"
                    class="form-control"
                    bind:value={info2}
                    onfocus={() => (lastFocusedInfo = 'info2')}
                  />
                  <div class="form-text">Secondary info</div>
                </div>
              </div>
              <div class="col-lg-4">
                <div class="mb-3">
                  <label for="import-info3" class="form-label">
                    Info 3 <span class="text-muted small">(Tertiary)</span>
                  </label>
                  <input
                    bind:this={info3Input}
                    id="import-info3"
                    type="text"
                    class="form-control"
                    bind:value={info3}
                    onfocus={() => (lastFocusedInfo = 'info3')}
                  />
                  <div class="form-text">Additional info</div>
                </div>
              </div>
            </div>

            <div class="mb-3">
              <span class="form-label d-block" id="import-info-fields-label">Available Fields</span>
              <div class="d-flex flex-wrap gap-2" aria-labelledby="import-info-fields-label">
                {#each headers as header (header)}
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-primary"
                    onclick={() => insertIntoLastFocusedInfo(header)}
                  >
                    {header}
                  </button>
                {/each}
              </div>
              <div class="form-text">Inserted into the field you last used ({lastFocusedInfo}).</div>
            </div>

            <div class="mb-0">
              <span class="form-label d-block" id="import-card-preview-label">Preview</span>
              <div
                class="p-3 border rounded winner-card-stage"
                aria-labelledby="import-card-preview-label"
                aria-live="polite"
              >
                <div class="winner-card">
                  <div class="winner-number">1</div>
                  <div class="winner-info1">{info1Preview}</div>
                  <div class="winner-info2">{info2Preview}</div>
                  <div class="winner-info3">{info3Preview}</div>
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/key}
    </div>
  </div>

  {#snippet footer()}
    {#if importing}
      <div class="w-100 mb-2">
        <div
          class="progress"
          role="progressbar"
          aria-label="Import progress"
          aria-valuenow={Math.round(importPercent)}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="progress-bar" style:width="{importPercent}%"></div>
        </div>
        <p class="small text-muted mb-0 mt-1" aria-live="polite">{importStatus}</p>
      </div>
    {/if}

    <div class="wizard-navigation d-flex justify-content-between align-items-center w-100 pt-3">
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-secondary" disabled={importing} onclick={() => (open = false)}>
          <i class="bi bi-x-lg me-1" aria-hidden="true"></i>Cancel
        </button>
        {#if step < TOTAL_STEPS}
          <button
            type="button"
            class="btn btn-outline-primary"
            disabled={importing}
            onclick={() => void runImport()}
          >
            <i class="bi bi-skip-forward me-1" aria-hidden="true"></i>Use Defaults
          </button>
        {/if}
      </div>

      <div class="d-flex gap-2">
        <!-- `.invisible` is `visibility: hidden`, which also takes it out of the tab order. -->
        <button
          type="button"
          class="btn btn-outline-secondary"
          class:invisible={step === 1}
          onclick={() => (step = Math.max(1, step - 1))}
        >
          <i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Back
        </button>
        {#if step < TOTAL_STEPS}
          <button
            type="button"
            class="btn btn-primary"
            onclick={() => (step = Math.min(TOTAL_STEPS, step + 1))}
          >
            Next<i class="bi bi-arrow-right ms-1" aria-hidden="true"></i>
          </button>
        {:else}
          <button type="button" class="btn btn-success" disabled={importing} onclick={() => void runImport()}>
            {#if importing}
              <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
            {:else}
              <i class="bi bi-download me-1" aria-hidden="true"></i>
            {/if}
            Import Data
          </button>
        {/if}
      </div>
    </div>
  {/snippet}
</Dialog>

<style>
  /*
    Viewport-independent, so it stays with the component (responsive.css owns width rules only).
  */
  .template-preview {
    min-height: 38px;
    background: var(--bs-secondary-bg, #f8f9fa);
  }

  /*
    `.winner-card` sizes its type in `cqw` against `.winners-grid`, and starts at `opacity: 0`
    because the draw animates it in. A standalone preview has neither, so the stage supplies the
    query container and the card is made visible here rather than by changing the shared class.
  */
  .winner-card-stage {
    container-type: inline-size;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 170px;
    background: var(--gradient-bg, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%));
  }

  .winner-card-stage :global(.winner-card) {
    opacity: 1;
    width: min(280px, 100%);
    height: auto;
    min-height: 110px;
  }
</style>
