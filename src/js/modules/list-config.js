// ================================
// LIST CONFIGURATION WIZARD
// ================================
//
// The import wizard (#importWizard) is a single DOM instance shared by two flows:
//   - import — CSVParser, after a CSV or MinistryPlatform query has been previewed
//   - edit   — Lists, when the gear on a list card is clicked
//
// It is deliberately NOT duplicated into a modal for the edit flow: every control is
// addressed by a global element id (nameTemplate, info1Template, idColumnSelect, ...), so a
// second copy in the document would shadow the first and silently break importing.
//
// This module owns reading that DOM into a config object, writing a config object back into
// it, and switching between the two modes. Default detection (which name template to suggest
// for an unseen CSV) stays with CSVParser, which is the only flow that needs it.

export const WIZARD_MODE = {
  IMPORT: 'import',
  EDIT: 'edit'
};

// Which flow currently owns the wizard, and — in edit mode — the list being edited.
let currentMode = WIZARD_MODE.IMPORT;
let editingListId = null;

/**
 * Fail-fast element lookup. A missing wizard control means the markup and this module have
 * drifted apart; surfacing that immediately beats writing a config object full of undefined.
 */
function el(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`List config wizard is missing element #${id}`);
  }
  return element;
}

export function getWizardMode() {
  return { mode: currentMode, listId: editingListId };
}

/**
 * Read every wizard control into a config object shaped like list metadata.
 *
 * `idConfig` is always read, but the edit flow ignores it — see saveListConfigFromWizard in
 * lists.js for why an existing list's record ID cannot be changed.
 */
export function readWizardConfig() {
  const useColumnId = el('useColumnId');
  const idColumnSelect = el('idColumnSelect');

  let idConfig;
  if (useColumnId.checked) {
    const selectedColumn = idColumnSelect.value;
    if (!selectedColumn) {
      throw new Error('Please select a column for record IDs');
    }
    idConfig = { source: 'column', column: selectedColumn };
  } else {
    idConfig = { source: 'auto' };
  }

  const removeWinnersFromList = el('listRemoveWinnersFromList').checked;

  return {
    name: el('listName').value.trim(),
    idConfig,
    nameConfig: el('nameTemplate').value.trim(),
    infoConfig: {
      info1: el('info1Template').value.trim(),
      info2: el('info2Template').value.trim(),
      info3: el('info3Template').value.trim()
    },
    listSettings: {
      removeWinnersFromList,
      // Keeping winners in the list only makes sense alongside this guard, so it is forced
      // on in that case rather than left to the checkbox.
      preventWinningSamePrize: !removeWinnersFromList
        ? true
        : el('listPreventWinningSamePrize').checked,
      skipExistingWinners: el('listSkipExistingWinners').checked
    }
  };
}

/**
 * Fill the wizard from a stored config. Only the keys actually present are applied, so a list
 * saved before a given field existed keeps whatever default the caller already put in place
 * rather than being blanked.
 */
export function applyWizardConfig(config) {
  if (!config) return;

  if (typeof config.name === 'string') {
    el('listName').value = config.name;
  }

  // nameConfig is a plain template string; anything else is a pre-template list whose display
  // name came from Lists.formatDisplayName's field detection, so the suggested default stands.
  if (typeof config.nameConfig === 'string' && config.nameConfig) {
    el('nameTemplate').value = config.nameConfig;
  }

  if (config.infoConfig) {
    if (typeof config.infoConfig.info1 === 'string') el('info1Template').value = config.infoConfig.info1;
    if (typeof config.infoConfig.info2 === 'string') el('info2Template').value = config.infoConfig.info2;
    if (typeof config.infoConfig.info3 === 'string') el('info3Template').value = config.infoConfig.info3;
  }

  if (config.idConfig) {
    const useColumn = config.idConfig.source === 'column';
    el('useColumnId').checked = useColumn;
    el('autoGenerateId').checked = !useColumn;
    if (useColumn && config.idConfig.column) {
      const select = el('idColumnSelect');
      // The stored column may no longer be among the list's fields — an MP query that dropped
      // it, say. The picker is read-only when editing, so without this the one thing the step
      // exists to show would render blank for exactly the lists where it matters most.
      if (![...select.options].some(option => option.value === config.idConfig.column)) {
        const missing = document.createElement('option');
        missing.value = config.idConfig.column;
        missing.textContent = `${config.idConfig.column} (no longer in this list)`;
        select.appendChild(missing);
      }
      select.value = config.idConfig.column;
    }
    // The caller detected a column and may have flagged it "Auto-selected". That label is
    // untrue once the stored column replaces it, so it goes.
    document.getElementById('idAutoSelectIndicator')?.remove();
    // The visibility of the column picker is driven by a change listener on the radios.
    el(useColumn ? 'useColumnId' : 'autoGenerateId').dispatchEvent(new Event('change'));
  }

  if (config.listSettings) {
    const { removeWinnersFromList, preventWinningSamePrize, skipExistingWinners } = config.listSettings;

    if (typeof removeWinnersFromList === 'boolean') {
      el('listRemoveWinnersFromList').checked = removeWinnersFromList;
      // The checkbox is x-model bound, and the pane below it reacts to that value. Setting
      // .checked alone does not notify Alpine, so the dependent :checked/:disabled bindings
      // and the warning alert would keep rendering the previous list's value.
      el('listRemoveWinnersFromList').dispatchEvent(new Event('change'));
    }
    // preventWinningSamePrize is deliberately NOT restored. Its checkbox is one-way bound as
    // :checked="!removeWinners", so Alpine owns it: the stored value is always whatever that
    // rule produced at import, and readWizardConfig re-derives it the same way. Assigning
    // .checked here would stick only when removeWinnersFromList happened not to change —
    // making the saved value depend on which list was opened previously.
    if (typeof skipExistingWinners === 'boolean') {
      el('listSkipExistingWinners').checked = skipExistingWinners;
    }
  }
}

/**
 * Switch the wizard between importing and editing.
 *
 * Edit mode differs in three ways:
 *   - the record ID step is read-only, because entry ids are already assigned and winner
 *     records reference them (see lists.js)
 *   - the heading names the list, since the wizard is detached from the card that opened it
 *   - the confirm button saves instead of uploading
 */
export function setWizardMode({ mode, listId = null, listName = '' }) {
  currentMode = mode;
  editingListId = mode === WIZARD_MODE.EDIT ? listId : null;

  const editing = mode === WIZARD_MODE.EDIT;

  // `step` lives in the wizard's Alpine component and survives being hidden, so without this
  // the gear reopens on whichever step was last viewed rather than at the beginning.
  const wizardData = window.Alpine?.$data(el('importWizard'));
  if (wizardData) {
    wizardData.step = 1;
  }

  // Record ID step: visible either way so the user can see what the list is keyed by, but
  // locked once entries exist.
  for (const id of ['autoGenerateId', 'useColumnId', 'idColumnSelect']) {
    const control = el(id);
    control.disabled = editing;
    if (editing) {
      control.setAttribute('aria-describedby', 'idConfigLockedNote');
    } else {
      control.removeAttribute('aria-describedby');
    }
  }
  el('idConfigLockedNote').hidden = !editing;

  el('wizardHeading').textContent = editing
    ? `Edit Settings — ${listName}`
    : 'Import Configuration';

  // The import copy talks about the CSV filename, which means nothing when editing.
  el('listNameHelp').textContent = editing
    ? 'Renaming the list here does not affect its entries or winner history.'
    : 'If left empty, the CSV filename will be used as the list name.';

  const confirmBtn = el('confirmUpload');
  const icon = document.createElement('i');
  icon.className = editing ? 'bi bi-check-lg me-1' : 'bi bi-download me-1';
  confirmBtn.replaceChildren(icon, document.createTextNode(editing ? 'Save Changes' : 'Import Data'));

  // The shortcut button commits whatever is on screen. When editing, that is the list's own
  // configuration, not a set of defaults.
  el('skipToConfirmLabel').textContent = editing ? 'Save Now' : 'Use Defaults';
}

export const ListConfig = {
  WIZARD_MODE,
  getWizardMode,
  readWizardConfig,
  applyWizardConfig,
  setWizardMode
};
