<script lang="ts">
  import { tick } from 'svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import {
    buildList,
    entryIdFor,
    existingWinnerIds,
    listAsImportSource,
    saveList,
    saveListConfig,
    skipsExistingWinners,
    type WizardTarget
  } from '$lib/services/lists';
  import { data } from '$lib/state/data.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import { removesWinners } from '$lib/state/setup.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import type { IdConfig, List } from '$lib/types';
  import { detectIdColumn, detectNameTemplate, validateColumnIds } from '$lib/utils/csv';
  import { applyTemplate, formatNumber, pluralise } from '$lib/utils/format';
  import WinnerBehaviourFields from './WinnerBehaviourFields.svelte';

  /** Kept out of the markup because a bare `{` in an attribute starts a Svelte expression. */
  const NAME_TEMPLATE_PLACEHOLDER = '{lastName}, {firstName}';

  /**
   * Shown where the field chips would be. Reachable only from the edit flow, on a list with no
   * entries: an import always has rows, but a list can be left empty by a hand-edited data file
   * or a restore, and refusing to open the wizard for it would mean it could no longer even be
   * renamed.
   */
  const NO_FIELDS_NOTE = 'This list has no fields, so there is nothing to insert.';

  interface Props {
    /**
     * What is being configured: a pending import, or a list that already exists.
     *
     * Read once at creation — the parent wraps this component in `{#key}` so a second target
     * always gets a fresh instance rather than these fields being re-seeded by an effect.
     */
    target: WizardTarget;
    onclose: () => void;
  }

  let { target, onclose }: Props = $props();

  /**
   * The two flows this one wizard serves.
   *
   * The gear on a list card opens exactly the same five steps the import does, pre-filled from
   * the list — so the edit flow turns its list into the same `ImportSource` shape and every
   * derivation below is written once. `editing` is the list when editing and null when
   * importing, which is the only thing the rest of the component tests.
   */
  // svelte-ignore state_referenced_locally
  const editing: List | null = target.mode === 'edit' ? target.list : null;
  // svelte-ignore state_referenced_locally
  const source = target.mode === 'edit' ? listAsImportSource(target.list) : target.source;

  let open = $state(true);

  const STEPS = [
    { number: 1, label: 'Record ID', icon: 'bi-key', title: 'Record ID Configuration' },
    {
      number: 2,
      // Its one setting governs records added by an import *and* by a later sync, so "Import
      // Options" is only half true for a list that has already been imported.
      label: editing ? 'Record Options' : 'Import Options',
      icon: 'bi-filter',
      title: editing ? 'Record Options' : 'Import Options'
    },
    { number: 3, label: 'Winner Behavior', icon: 'bi-trophy', title: 'Winner Behavior' },
    { number: 4, label: 'Display Name', icon: 'bi-person-badge', title: 'Display Name' },
    { number: 5, label: 'Card Display', icon: 'bi-card-heading', title: 'Winner Card Display' }
  ] as const;
  const TOTAL_STEPS = STEPS.length;

  let step = $state(1);
  /** A write is in flight — an import or a settings save. Both lock the same controls. */
  let busy = $state(false);

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
   * below is seeded from it. The parent wraps this component in `{#key}`, so a second target
   * destroys and rebuilds it rather than mutating a run already in progress — which is what
   * makes reading the initial value correct rather than a missed reactive dependency.
   */
  const headers = source.headers;
  const firstRow = source.rows[0] ?? {};

  /**
   * The rows shown under the Record ID step.
   *
   * Ten is what the old app showed, and it is enough to answer the only question this step
   * asks — which column identifies a record — without turning the dialog into a spreadsheet.
   */
  const PREVIEW_ROWS = 10;
  const previewRows = source.rows.slice(0, PREVIEW_ROWS);

  const detectedIdColumn = detectIdColumn(headers);
  const detectedNameTemplate = detectNameTemplate(headers);

  let listName = $state(source.listName);

  /*
   * Every field below seeds from the list when editing and from detection when importing. A
   * list saved before a given field existed falls through to the detected default rather than
   * opening with an empty control — `nameConfig` and `infoConfig` predate neither wizard.
   */

  /**
   * Defaults to auto-generated ids when no column looks like one.
   *
   * The old form defaulted to "use a column" with nothing selected, so an operator who pressed
   * "Use Defaults" on a file with no id column got a validation error instead of an import.
   */
  let idSource = $state<'auto' | 'column'>(
    editing ? (editing.metadata.idConfig?.source ?? 'auto') : detectedIdColumn ? 'column' : 'auto'
  );
  let idColumn = $state(editing ? (editing.metadata.idConfig?.column ?? '') : (detectedIdColumn ?? ''));
  /** The badge claims a *guess*. An existing list's column is its own, so it never applies. */
  let idAutoSelected = $state(!editing && detectedIdColumn !== undefined);

  /**
   * The stored id column may no longer be one of the list's fields — an MP query that dropped
   * it, say. The picker is read-only when editing, so without an option of its own the one
   * thing this step exists to show would render blank for exactly the lists where it matters.
   */
  const idColumnMissing = $derived(editing !== null && idColumn !== '' && !headers.includes(idColumn));

  /** Rows are a file's *records* while importing, and the list's *entries* while editing. */
  function countLabel(count: number): string {
    return editing
      ? `${formatNumber(count)} ${pluralise(count, 'entry', 'entries')}`
      : `${formatNumber(count)} ${pluralise(count, 'record')}`;
  }

  // Seeded from the global default on import; from then on the list owns its value, and the
  // global is only what a *new* list starts from.
  let skipExistingWinners = $state(
    editing
      ? skipsExistingWinners(editing, settings.current.skipExistingWinners)
      : settings.current.skipExistingWinners
  );
  let removeWinners = $state(editing ? removesWinners(editing) : settings.current.preventDuplicates);
  /*
   * The *stored* value, not a fresh default: the dialog this wizard replaced always opened this
   * unchecked and wrote back whatever it found, so opening a list's settings and pressing Save
   * silently cleared the flag.
   */
  let preventSamePrize = $state(
    editing
      ? (editing.metadata.listSettings?.preventWinningSamePrize ?? settings.current.preventSamePrize)
      : settings.current.preventSamePrize
  );

  let nameTemplate = $state(editing?.metadata.nameConfig || detectedNameTemplate);

  // info1 names the record, info2 repeats the display name, info3 is left for the operator —
  // the same defaults the Alpine form seeded. `??`, so a stored empty field stays empty.
  const detectedInfo1 = detectedIdColumn ? `{${detectedIdColumn}}` : headers[0] ? `{${headers[0]}}` : '';
  let info1 = $state(editing?.metadata.infoConfig?.info1 ?? detectedInfo1);
  let info2 = $state(editing?.metadata.infoConfig?.info2 ?? detectedNameTemplate);
  let info3 = $state(editing?.metadata.infoConfig?.info3 ?? '');

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

  /** 0 to 1 across the rail. Scaled, not sized — see `.wizard-progress-line-active`. */
  const progressFraction = $derived((step - 1) / (TOTAL_STEPS - 1));
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

  /**
   * Everything the operator can change, in one comparable shape.
   *
   * Built from the values that would be *written*, not from the controls: `preventSamePrize` is
   * forced on for a list that keeps its winners, so unticking "remove winners" changes what a
   * save would store even though that checkbox itself was never touched. Comparing the whole
   * shape also means a field added to this wizard later cannot be forgotten here.
   */
  const editable = $derived({
    listName: listName.trim(),
    idSource,
    idColumn,
    skipExistingWinners,
    removeWinners,
    preventSamePrize: removeWinners ? preventSamePrize : true,
    nameTemplate: nameTemplate.trim(),
    info1: info1.trim(),
    info2: info2.trim(),
    info3: info3.trim()
  });
  // svelte-ignore state_referenced_locally
  const initialEditable = JSON.stringify(editable);
  const dirty = $derived(JSON.stringify(editable) !== initialEditable);

  /**
   * Guards against a second prompt while the first is still on screen. A plain variable, not
   * `$state`: nothing renders it, and reactivity it does not need is reactivity that can
   * re-trigger something that does.
   */
  let confirmingClose = false;

  /**
   * Every dismissal the operator can reach — Escape, the backdrop, the × and Cancel — arrives
   * here, because `Dialog` writes its `open` prop through the setter bound below. So the guard
   * cannot be walked around, while the import and save paths, which assign `open` directly, are
   * deliberately never asked.
   */
  async function requestClose() {
    // A write is in flight. Cancel is disabled for it, and Escape must not be a way around that.
    if (busy || confirmingClose) return;

    if (dirty) {
      confirmingClose = true;
      try {
        const discard = await ui.confirm(
          editing
            ? {
                title: 'Discard Changes',
                message: `"${editing.metadata.name}" has unsaved changes.`,
                details: ['Closing now leaves the list exactly as it is.'],
                confirmText: 'Discard',
                cancelText: 'Keep Editing',
                variant: 'warning'
              }
            : {
                title: 'Discard Import',
                message: 'Nothing has been imported yet.',
                details: [
                  `Closing now discards this configuration and the ${countLabel(source.rows.length)}${
                    source.fileName ? ` from ${source.fileName}` : ''
                  }.`
                ],
                confirmText: 'Discard',
                cancelText: 'Keep Configuring',
                variant: 'warning'
              }
        );
        if (!discard) return;
      } finally {
        confirmingClose = false;
      }
    }

    open = false;
  }

  /** The footer's commit button, which saves a list's settings or runs the import. */
  function commit() {
    if (editing) void saveConfig(editing);
    else void runImport();
  }

  /**
   * Write the wizard back onto an existing list.
   *
   * Metadata only — see `saveListConfig`. The record ID step is read-only precisely so that this
   * can never need to touch entries.
   */
  async function saveConfig(list: List) {
    if (busy) return;

    const finalName = listName.trim();
    if (!finalName) {
      toasts.warning('Please give the list a name.');
      return;
    }

    busy = true;
    try {
      await saveListConfig(list, {
        name: finalName,
        nameConfig: nameTemplate.trim(),
        infoConfig: { info1: info1.trim(), info2: info2.trim(), info3: info3.trim() },
        listSettings: {
          removeWinnersFromList: removeWinners,
          // Forced on for a list that keeps its winners — see WinnerBehaviourFields.
          preventWinningSamePrize: removeWinners ? preventSamePrize : true,
          skipExistingWinners
        }
      });

      toasts.success(`Settings saved for "${finalName}".`);
      open = false;
    } catch (error) {
      data.reportWriteFailure(error, 'the list settings');
    } finally {
      busy = false;
    }
  }

  async function runImport() {
    if (busy) return;

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

    busy = true;
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
          preventWinningSamePrize: removeWinners ? preventSamePrize : true,
          // Stored per list from here on. The global setting supplied the value this checkbox
          // opened with and is deliberately not written back.
          skipExistingWinners
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
      busy = false;
    }
  }
</script>

<!--
  `open` is bound through a setter so every dismissal `Dialog` performs — Escape, the backdrop
  and the × — is routed through the unsaved-changes guard. The wizard's own writes assign `open`
  directly and so are never asked.
-->
<Dialog
  bind:open={
    () => open,
    (value) => {
      if (!value) void requestClose();
    }
  }
  title={editing ? `Edit Settings — ${editing.metadata.name}` : 'Configure Import'}
  size="modal-xl"
  {onclose}
>
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
        {#if editing}
          Renaming the list here does not affect its entries or its winner history.
        {:else}
          {countLabel(source.rows.length)} from {source.fileName}
        {/if}
      </div>
    </div>

    <div class="wizard-progress mb-4">
      <div class="d-flex justify-content-between align-items-center position-relative">
        <div class="wizard-progress-line"></div>
        <div class="wizard-progress-line-active" style="--wizard-progress: {progressFraction}"></div>

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

            <!--
              Read-only when editing, and shown rather than hidden: an operator has to be able to
              see what a list is keyed by. Changing it cannot be made safe once entries exist —
              leave the ids alone and the next sync keys new records by a different column,
              matches nothing and re-adds everyone as duplicates; re-key them and every
              `winners.entryId` pointing at this list dangles.

              A disabled control is out of the tab order, so this visible note — placed before
              the controls, so it is read first — is what carries the reason; `aria-describedby`
              on each control is the belt to its braces.
            -->
            {#if editing}
              <div class="alert alert-secondary py-2" id="import-id-locked">
                <small>
                  <i class="bi bi-lock me-1" aria-hidden="true"></i>
                  The record ID is set when a list is imported and cannot be changed afterwards — entries are keyed
                  by it and winner history refers to those keys. Re-import the list to change it.
                </small>
              </div>
            {/if}

            <fieldset class="mb-3" disabled={editing !== null}>
              <legend class="form-label">Record ID Source</legend>

              <div class="form-check">
                <input
                  class="form-check-input"
                  type="radio"
                  name="import-id-source"
                  id="import-id-auto"
                  value="auto"
                  checked={idSource === 'auto'}
                  aria-describedby={editing ? 'import-id-locked' : undefined}
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
                  aria-describedby={editing ? 'import-id-locked' : undefined}
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
                  disabled={editing !== null}
                  aria-describedby={editing ? 'import-id-locked' : undefined}
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
                  {#if idColumnMissing}
                    <option value={idColumn}>{idColumn} (no longer in this list)</option>
                  {/if}
                </select>
                <div class="form-text">Selected column values must be unique for each record.</div>
              </div>
            {/if}

            <!--
              The parsed rows, shown where the column that identifies a record is chosen — that
              decision cannot be made from a list of header names alone.

              Values are interpolated, so the compiler escapes them: the old app built this table
              by concatenating cell values into an HTML string, and anything a spreadsheet
              carried in a cell was parsed as markup and run. `?? ''` rather than `|| ''` so a
              numeric 0 prints as the 0 that is in the file instead of an empty cell. Every cell
              carries `data-label`, which is what lets responsive.css restack the table as one
              labelled card per row on a phone.
            -->
            <div class="mt-4">
              <span class="form-label d-block" id="import-data-preview-label">
                Data Preview
                <span class="text-muted fw-normal">
                  {#if previewRows.length > 0}
                    — {countLabel(source.rows.length)}, showing the first {previewRows.length}
                  {/if}
                </span>
              </span>

              {#if previewRows.length === 0}
                <!-- Only reachable when editing: an import cannot start with no rows. -->
                <p class="text-muted mb-0">This list has no entries, so there is nothing to preview.</p>
              {:else}
                <div class="table-responsive">
                  <!-- svelte-ignore a11y_no_redundant_roles -->
                  <table
                    class="table table-sm table-striped table-stack mb-0"
                    role="table"
                    aria-labelledby="import-data-preview-label"
                  >
                    <!-- svelte-ignore a11y_no_redundant_roles -->
                    <thead role="rowgroup">
                      <!-- svelte-ignore a11y_no_redundant_roles -->
                      <tr role="row">
                        {#each headers as header (header)}
                          <th scope="col" role="columnheader">{header}</th>
                        {/each}
                      </tr>
                    </thead>
                    <!-- svelte-ignore a11y_no_redundant_roles -->
                    <tbody role="rowgroup">
                      {#each previewRows as row, index (index)}
                        <!-- svelte-ignore a11y_no_redundant_roles -->
                        <tr role="row">
                          {#each headers as header (header)}
                            <td role="cell" data-label={header}>{row[header] ?? ''}</td>
                          {/each}
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>
          {:else if step === 2}
            <p class="text-muted mb-4">Configure how records are handled when they are added to this list.</p>

            <!--
              A per-list setting, not the global one. The Settings screen holds the default a new
              import opens with; from then on the list owns its value, so toggling it here can
              never change how a later import of a different list behaves.
            -->
            <div class="form-check mb-3">
              <input
                class="form-check-input"
                type="checkbox"
                id="import-skip-winners"
                bind:checked={skipExistingWinners}
              />
              <label class="form-check-label" for="import-skip-winners">
                Skip records that are already in the winner list
              </label>
              <div class="form-text">
                Records are matched by their unique ID. Records with the same name but different IDs are still
                added. Also applies when this list is synced from Ministry Platform.
              </div>
            </div>
          {:else if step === 3}
            <p class="text-muted mb-4">Configure how winners are handled after selection.</p>

            <!-- One prefix for the whole wizard, whichever flow opened it: every other control
                 in this file is `import-*` too, and these ids are never referenced from outside. -->
            <WinnerBehaviourFields idPrefix="import" bind:removeWinners bind:preventSamePrize />
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
                {:else}
                  <!-- Only reachable when editing a list with no entries to take fields from. -->
                  <p class="text-muted mb-0">{NO_FIELDS_NOTE}</p>
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
                {:else}
                  <p class="text-muted mb-0">{NO_FIELDS_NOTE}</p>
                {/each}
              </div>
              {#if headers.length > 0}
                <div class="form-text">Inserted into the field you last used ({lastFocusedInfo}).</div>
              {/if}
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
    <!-- Import only: a settings save is one small write, and reports itself with a toast. -->
    {#if busy && !editing}
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
        <button type="button" class="btn btn-secondary" disabled={busy} onclick={() => void requestClose()}>
          <i class="bi bi-x-lg me-1" aria-hidden="true"></i>Cancel
        </button>
        {#if step < TOTAL_STEPS}
          <!-- Commits what is on screen without walking the remaining steps. "Use Defaults" only
               makes sense for a fresh import; editing commits the list's own configuration. -->
          <button type="button" class="btn btn-outline-primary" disabled={busy} onclick={commit}>
            <i class="bi bi-skip-forward me-1" aria-hidden="true"></i>{editing ? 'Save Now' : 'Use Defaults'}
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
          <button type="button" class="btn btn-success" disabled={busy} onclick={commit}>
            {#if busy}
              <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
            {:else}
              <i class="bi me-1" class:bi-check-lg={editing} class:bi-download={!editing} aria-hidden="true"
              ></i>
            {/if}
            {editing ? 'Save Changes' : 'Import Data'}
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
