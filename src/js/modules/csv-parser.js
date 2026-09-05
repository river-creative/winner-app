// ================================
// CSV PARSING & UPLOAD
// ================================

import { UI } from './ui.js';
import { Lists } from './lists.js';
import { Database } from './database.js';
import { DOMUtils } from './dom-utils.js';
import eventManager from './event-manager.js';
import { settings } from './settings.js';
import { Validation } from './validation.js';
import { SafeHTML } from './safe-html.js';
import { ListConfig, WIZARD_MODE } from './list-config.js';

let pendingCSVData = null;

// Utility functions for camelizing object keys
function camelize(key) {
  const prefix = key.match(/^_{1,2}/)?.[0] || '';
  const keyWithoutPrefix = key.slice(prefix.length);

  if (keyWithoutPrefix === '' || keyWithoutPrefix.match(/^\|+$/)) {
    return prefix;
  }

  const cleaned = keyWithoutPrefix
    .normalize('NFD') // Decompose Unicode characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritical marks
    .replace(/[^\p{Alphabetic}\p{Number}]+/gu, '|')
    .replace(/(?<=[a-z0-9])([A-Z][A-Za-z]*[A-Za-z]\b)/, str => '|' + str)
    .toLowerCase();

  const camelizedKey = cleaned.split('|').filter(Boolean).map((part, i) => (i === 0 ? part : capitalize(part))).join('');

  return prefix + camelizedKey;
}

/**
 * Recursively or shallowly transforms the keys of an object to camelCase.
 *
 * @param {Object|Array} obj - The object or array whose keys should be camelized.
 * @param {boolean} [deep=false] - Whether to recursively camelize nested objects and arrays.
 * @returns {Object|Array} A new object or array with camelized keys.
 */
function camelizeObj(obj, deep = false) {
  if (Array.isArray(obj)) {
    return deep ? obj.map(item => camelizeObj(item, true)) : obj;
  }

  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  return Object.entries(obj).reduce((acc, [key, value]) => {
    const newKey = camelize(key);
    const newValue = deep ? camelizeObj(value, true) : value;
    acc[newKey] = newValue;
    return acc;
  }, {});
}

function lowerCase(str) {
  return str.length && str[0].toLowerCase() + str.slice(1);
}

// Capitalize a string
function capitalize(str, { lowerRest = false } = {}) {
  if (!str) return str;
  if (lowerRest) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    return { data: [], errors: ['Empty file'] };
  }

  const headers = parseCSVLine(lines[0]);
  const data = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i]);
      if (values.length > 0) {
        const row = {};
        headers.forEach((header, index) => {
          row[header.trim()] = values[index]?.trim() || '';
        });
        // Camelize the row object keys for consistency
        const camelizedRow = camelizeObj(row);
        data.push(camelizedRow);
      }
    } catch (error) {
      errors.push(`Line ${i + 1}: ${error.message}`);
    }
  }

  return { data, errors };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

async function handleCSVUpload() {
  const csvFileInput = document.getElementById('csvFile');

  if (!csvFileInput || !csvFileInput.files || csvFileInput.files.length === 0) {
    return;
  }

  const csvFile = csvFileInput.files[0];
  
  // Validate CSV file
  const fileValidation = Validation.validateCSVFile(csvFile);
  if (!fileValidation.isValid) {
    UI.showToast(fileValidation.error, 'warning');
    csvFileInput.value = ''; // Clear the invalid file
    return;
  }

  const fileName = csvFile.name.replace(/\.[^/.]+$/, "");
  // Don't read list name here - it will be read when confirming
  const listName = fileName; // Use filename as temporary name for preview

  try {
    UI.showProgress('Processing CSV', 'Reading file...');

    const csvText = await UI.readFileAsText(csvFile);
    const { data, errors } = parseCSV(csvText);

    if (errors.length > 0) {
      throw new Error('CSV parsing errors: ' + errors.join(', '));
    }

    if (data.length === 0) {
      throw new Error('CSV file appears to be empty');
    }

    UI.hideProgress();

    pendingCSVData = {
      listName: listName,
      fileName: csvFile.name,
      data: data
    };

    showCSVPreview(data, listName);
  } catch (error) {
    UI.hideProgress();
    console.error('CSV upload error:', error);
    UI.showToast('Error processing CSV: ' + error.message, 'error');
  }
}

function showCSVPreview(data, listName) {
  const previewCard = document.getElementById('dataPreviewCard');
  const previewHeaders = document.getElementById('previewHeaders');
  const previewBody = document.getElementById('previewBody');

  if (!previewCard) {
    return;
  }

  const headers = Object.keys(data[0]);
  const previewData = data.slice(0, 10);

  // Built as DOM nodes rather than an innerHTML template: the headers and values
  // come straight from an uploaded file, so interpolating them into markup would
  // execute whatever the file contains. `data-label` carries the column name for
  // the stacked-card layout the responsive stylesheet applies below the md
  // breakpoint (see .table-stack).
  // The explicit row/cell roles keep the table semantics once .table-stack
  // switches these elements to display:block on a phone.
  const headerRow = SafeHTML.createElement('tr', '', { role: 'row' });
  headers.forEach(header => {
    headerRow.appendChild(SafeHTML.createElement('th', header, { scope: 'col', role: 'columnheader' }));
  });
  previewHeaders.replaceChildren(headerRow);

  const body = document.createDocumentFragment();
  previewData.forEach(row => {
    const tr = SafeHTML.createElement('tr', '', { role: 'row' });
    headers.forEach(header => {
      tr.appendChild(SafeHTML.createElement('td', String(row[header] ?? ''), {
        role: 'cell',
        'data-label': header
      }));
    });
    body.appendChild(tr);
  });
  previewBody.replaceChildren(body);

  // Same reason as the table above: listName is derived from the uploaded
  // filename, so it is set as text, never interpolated into markup.
  const previewTitle = document.querySelector('#dataPreviewCard .card-title');
  previewTitle.replaceChildren(
    document.createTextNode('Data Preview - '),
    SafeHTML.createElement('span', `"${listName}"`, { className: 'list-name' }),
    document.createTextNode(' '),
    SafeHTML.createElement('span',
      `(${data.length} total records, showing first ${previewData.length})`,
      { className: 'list-count' })
  );

  // Set the list name in the input field
  const listNameInput = document.getElementById('listName');
  if (listNameInput) {
    listNameInput.value = listName || '';
  }

  // Claim the shared wizard for importing — it may have been left in edit mode.
  ListConfig.setWizardMode({ mode: WIZARD_MODE.IMPORT });
  showNameConfiguration(headers, data[0]);

  previewCard.style.display = 'block';

  // Scroll to configuration card instead of preview since config is on top
  const nameConfigCard = document.getElementById('nameConfigCard');
  if (nameConfigCard) {
    nameConfigCard.scrollIntoView({ behavior: 'smooth' });
  }

  UI.showToast(`Preview ready! Showing first ${previewData.length} of ${data.length} records`, 'info');
}

// Intelligently detect name fields from headers
function detectNameTemplate(headers, firstRow) {
  // Normalize headers for case-insensitive matching
  const normalizedHeaders = {};
  headers.forEach(header => {
    normalizedHeaders[header.toLowerCase().replace(/[^a-z0-9]/g, '')] = header;
  });
  
  // Priority 1: Look for firstName and lastName fields
  const firstNameVariants = ['firstname', 'first_name', 'fname', 'givenname', 'given_name', 'first'];
  const lastNameVariants = ['lastname', 'last_name', 'lname', 'surname', 'familyname', 'family_name', 'last'];
  
  let firstNameField = null;
  let lastNameField = null;
  
  // Find first name field
  for (const variant of firstNameVariants) {
    const normalized = variant.replace(/[^a-z0-9]/g, '');
    if (normalizedHeaders[normalized]) {
      firstNameField = normalizedHeaders[normalized];
      break;
    }
  }
  
  // Find last name field
  for (const variant of lastNameVariants) {
    const normalized = variant.replace(/[^a-z0-9]/g, '');
    if (normalizedHeaders[normalized]) {
      lastNameField = normalizedHeaders[normalized];
      break;
    }
  }
  
  if (firstNameField && lastNameField) {
    return `{${firstNameField}} {${lastNameField}}`;
  }
  
  // Priority 2: Look for fullName or name field
  const fullNameVariants = ['fullname', 'full_name', 'name', 'displayname', 'display_name', 'contactname', 'contact_name', 'customername', 'customer_name'];
  
  for (const variant of fullNameVariants) {
    const normalized = variant.replace(/[^a-z0-9]/g, '');
    if (normalizedHeaders[normalized]) {
      return `{${normalizedHeaders[normalized]}}`;
    }
  }
  
  // Priority 3: Look for any field containing "name"
  for (const header of headers) {
    if (header.toLowerCase().includes('name')) {
      return `{${header}}`;
    }
  }
  
  // Priority 4: Look for email field (common identifier)
  const emailVariants = ['email', 'emailaddress', 'email_address', 'mail', 'e_mail'];
  for (const variant of emailVariants) {
    const normalized = variant.replace(/[^a-z0-9]/g, '');
    if (normalizedHeaders[normalized]) {
      return `{${normalizedHeaders[normalized]}}`;
    }
  }
  
  // Fallback: Use first two columns if multiple columns exist, otherwise first column
  if (headers.length > 2) {
    return `{${headers[1]}} {${headers[2]}}`;
  } else if (headers.length > 0) {
    return `{${headers[0]}}`;
  }
  
  return '';
}

/**
 * Populate and show the configuration wizard.
 *
 * `existingConfig` is supplied by the edit flow (Lists.editListConfig). Defaults are always
 * computed first and the stored config is overlaid on top, so a list saved before a given
 * field existed inherits the detected default rather than an empty control.
 */
function showNameConfiguration(headers, firstRow, existingConfig = null) {
  const nameConfigCard = document.getElementById('nameConfigCard');
  const availableFields = document.getElementById('availableFields');
  const nameTemplateInput = document.getElementById('nameTemplate');
  const namePreview = document.getElementById('namePreview');
  const idColumnSelect = document.getElementById('idColumnSelect');
  const columnIdSection = document.getElementById('columnIdSection');
  const autoGenerateId = document.getElementById('autoGenerateId');
  const useColumnId = document.getElementById('useColumnId');
  const skipExistingWinnersCheckbox = document.getElementById('listSkipExistingWinners');

  nameConfigCard.style.display = 'block';
  availableFields.innerHTML = '';

  // skipExistingWinners is a per-list setting. The global one is only the default a NEW list
  // starts from — toggling it here changes this list, never the app-wide preference.
  // An existing list's own value is applied afterwards by applyWizardConfig.
  skipExistingWinnersCheckbox.checked = settings.skipExistingWinners || false;
  skipExistingWinnersCheckbox.style.display = 'inline-block';
  const checkboxContainer = skipExistingWinnersCheckbox.closest('.mb-3');
  if (checkboxContainer) {
    checkboxContainer.style.display = 'block';
  }

  // Populate available fields for name template
  headers.forEach(header => {
    const fieldBtn = document.createElement('button');
    fieldBtn.className = 'btn btn-sm btn-outline-secondary';
    fieldBtn.textContent = header;
    fieldBtn.onclick = () => {
      const cursorPos = nameTemplateInput.selectionStart;
      const text = nameTemplateInput.value;
      const placeholder = `{${header}}`;
      nameTemplateInput.value = text.slice(0, cursorPos) + placeholder + text.slice(cursorPos);
      nameTemplateInput.focus();
      updatePreview();
    };
    availableFields.appendChild(fieldBtn);
  });

  // Populate available fields for info templates
  const infoAvailableFields = document.getElementById('infoAvailableFields');
  const info1Template = document.getElementById('info1Template');
  const info2Template = document.getElementById('info2Template');
  const info3Template = document.getElementById('info3Template');

  // Track which info field was last focused
  let lastFocusedInfoField = info1Template;

  info1Template.addEventListener('focus', () => lastFocusedInfoField = info1Template);
  info2Template.addEventListener('focus', () => lastFocusedInfoField = info2Template);
  info3Template.addEventListener('focus', () => lastFocusedInfoField = info3Template);

  infoAvailableFields.innerHTML = '';
  headers.forEach(header => {
    const fieldBtn = document.createElement('button');
    fieldBtn.className = 'btn btn-sm btn-outline-primary';
    fieldBtn.textContent = header;
    fieldBtn.onclick = (e) => {
      e.preventDefault();

      // Add field to the last focused info template
      const targetInput = lastFocusedInfoField;
      const cursorPos = targetInput.selectionStart || targetInput.value.length;
      const text = targetInput.value;
      const placeholder = `{${header}}`;
      targetInput.value = text.slice(0, cursorPos) + placeholder + text.slice(cursorPos);
      targetInput.focus();
      // Set cursor position after the inserted placeholder
      const newCursorPos = cursorPos + placeholder.length;
      targetInput.setSelectionRange(newCursorPos, newCursorPos);
      updateInfoPreviews();
    };
    infoAvailableFields.appendChild(fieldBtn);
  });

  // Populate ID column dropdown
  idColumnSelect.innerHTML = '<option value="">Select a column...</option>';
  headers.forEach(header => {
    const option = document.createElement('option');
    option.value = header;
    option.textContent = header;
    idColumnSelect.appendChild(option);
  });
  
  // Auto-select ID column with fallback chain
  const idFallbackChain = [
    'idCard', 'ID_Card', 'IDCard',
    'contactId', 'Contact_ID', 'ContactID', 'contactID',
    'ticketCode', 'Ticket_Code', 'TicketCode',
    'userId', 'User_ID', 'UserID', 'userID',
    'personId', 'Person_ID', 'PersonID', 'personID',
    'participantId', 'Participant_ID', 'ParticipantID', 'participantID',
    'id', 'ID', 'Id',
    'code', 'Code', 'CODE',
    'number', 'Number', 'NUMBER',
    'barcode', 'Barcode', 'BARCODE',
    'qrCode', 'QR_Code', 'QRCode',
    'identifier', 'Identifier', 'IDENTIFIER'
  ];
  
  // Find the first matching column from the fallback chain
  let selectedIdColumn = null;
  for (const fallbackName of idFallbackChain) {
    // Case-insensitive comparison
    const matchingHeader = headers.find(h => h.toLowerCase() === fallbackName.toLowerCase());
    if (matchingHeader) {
      selectedIdColumn = matchingHeader;
      break;
    }
  }
  
  // If we found a matching column, select it and switch to "Use column" mode
  if (selectedIdColumn) {
    idColumnSelect.value = selectedIdColumn;
    document.getElementById('useColumnId').checked = true;
    document.getElementById('autoGenerateId').checked = false;
    // Trigger change event to update UI
    const event = new Event('change');
    document.getElementById('useColumnId').dispatchEvent(event);
    
    // Add a small indicator that this was auto-selected
    const autoSelectIndicator = document.createElement('small');
    autoSelectIndicator.className = 'text-success ms-2';
    autoSelectIndicator.innerHTML = '<i class="bi bi-check-circle"></i> Auto-selected';
    autoSelectIndicator.id = 'idAutoSelectIndicator';
    
    // Add it after the select element
    const selectParent = idColumnSelect.parentElement;
    const existingIndicator = document.getElementById('idAutoSelectIndicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }
    selectParent.appendChild(autoSelectIndicator);
    
    // Remove the indicator when user changes selection
    idColumnSelect.addEventListener('change', function() {
      const indicator = document.getElementById('idAutoSelectIndicator');
      if (indicator) {
        indicator.remove();
      }
    }, { once: true });
  }

  // Intelligently detect name fields
  const defaultTemplate = detectNameTemplate(headers, firstRow);
  nameTemplateInput.value = defaultTemplate;

  // Set default info templates
  // Use the selected ID column for info1 if we found one, otherwise use first column
  if (selectedIdColumn) {
    info1Template.value = `{${selectedIdColumn}}`;
  } else if (headers.length >= 1) {
    info1Template.value = `{${headers[0]}}`;
  }
  // Set info2 to be the same as the display name
  info2Template.value = defaultTemplate;
  // Keep info3 blank by default
  info3Template.value = '';

  function updatePreview() {
    const template = nameTemplateInput.value;
    const previewText = template.replace(/\{([^}]+)\}/g, (match, key) => {
      return firstRow[key] || '';
    });
    namePreview.textContent = previewText;
  }

  function updateInfoPreviews() {
    const info1Preview = document.getElementById('info1Preview');
    const info2Preview = document.getElementById('info2Preview');
    const info3Preview = document.getElementById('info3Preview');

    const info1Text = info1Template.value.replace(/\{([^}]+)\}/g, (match, key) => {
      return firstRow[key] || '';
    });
    const info2Text = info2Template.value.replace(/\{([^}]+)\}/g, (match, key) => {
      return firstRow[key] || '';
    });
    const info3Text = info3Template.value.replace(/\{([^}]+)\}/g, (match, key) => {
      return firstRow[key] || '';
    });

    // Update preview text - show placeholder if empty, matching actual winner card behavior
    info1Preview.textContent = info1Text || '';
    info2Preview.textContent = info2Text || '';
    info3Preview.textContent = info3Text || '';

    // Don't hide the divs - actual winner cards always show all divs even if empty
    // This matches the createWinnerCard function in selection.js
  }

  // Setup ID source radio button listeners
  function toggleIdSection() {
    if (useColumnId.checked) {
      columnIdSection.style.display = 'block';
    } else {
      columnIdSection.style.display = 'none';
    }
  }

  // Remove existing listeners to prevent conflicts
  autoGenerateId.removeEventListener('change', toggleIdSection);
  useColumnId.removeEventListener('change', toggleIdSection);
  nameTemplateInput.removeEventListener('input', updatePreview);
  info1Template.removeEventListener('input', updateInfoPreviews);
  info2Template.removeEventListener('input', updateInfoPreviews);
  info3Template.removeEventListener('input', updateInfoPreviews);

  // Add fresh listeners
  autoGenerateId.addEventListener('change', toggleIdSection);
  useColumnId.addEventListener('change', toggleIdSection);
  nameTemplateInput.addEventListener('input', updatePreview);
  info1Template.addEventListener('input', updateInfoPreviews);
  info2Template.addEventListener('input', updateInfoPreviews);
  info3Template.addEventListener('input', updateInfoPreviews);

  // Overlay the stored configuration on top of the detected defaults (edit flow only).
  // Must run before the previews so they reflect what will actually be saved.
  ListConfig.applyWizardConfig(existingConfig);

  // Initial setup
  updatePreview();
  updateInfoPreviews();
  toggleIdSection();
}

async function handleConfirmUpload() {
  // The confirm button is shared with the edit flow; hand off when the wizard is not ours.
  const { mode, listId } = ListConfig.getWizardMode();
  if (mode === WIZARD_MODE.EDIT) {
    await Lists.saveListConfigFromWizard(listId);
    return;
  }

  if (!pendingCSVData) {
    UI.showToast('No data to upload', 'error');
    return;
  }

  try {
    UI.showProgress('Processing List', 'Validating data...');

    // One read of the whole wizard, shared with the edit flow so both stay in step.
    const wizardConfig = ListConfig.readWizardConfig();

    const finalListName = wizardConfig.name || pendingCSVData.listName;
    const nameConfig = wizardConfig.nameConfig;
    const infoConfig = wizardConfig.infoConfig;
    const idConfig = wizardConfig.idConfig;
    const skipExistingWinners = wizardConfig.listSettings.skipExistingWinners;

    // Validate ID configuration if using column-based IDs
    if (idConfig.source === 'column') {
      const validation = validateColumnIds(pendingCSVData.data, idConfig.column);
      if (!validation.isValid) {
        UI.hideProgress();
        UI.showToast(`ID validation failed: ${validation.error}`, 'error');
        return;
      }
    }

    UI.updateProgress(25, 'Creating list structure...');

    // Filter out existing winners if the option is enabled
    let dataToUpload = pendingCSVData.data;
    let skippedCount = 0;

    if (skipExistingWinners) {
      UI.updateProgress(30, 'Checking for existing winners...');
      const winners = await Database.getFromStore('winners');
      console.log('Total winners in database:', winners.length);

      const winnerIds = new Set();

      // Collect all winner IDs (unique IDs only, not names)
      winners.forEach(winner => {
        // Check entryId field
        if (winner.entryId) {
          winnerIds.add(winner.entryId);
        }
        // Check winnerId as fallback (in case it was used as the record ID)
        if (winner.winnerId) {
          winnerIds.add(winner.winnerId);
        }
      });

      if (settings.enableDebugLogs) { console.log('Winner IDs collected:', winnerIds.size); }

      // Filter the data - match by ID only
      dataToUpload = pendingCSVData.data.filter((row, index) => {
        const entryId = generateEntryId(row, index, idConfig);

        const isWinner = winnerIds.has(entryId);

        if (isWinner) {
          const displayName = nameConfig.replace(/\{([^}]+)\}/g, (match, key) => {
            return row[key.trim()] || '';
          }).trim();
          if (settings.enableDebugLogs) {
            console.log(`Skipping winner by ID match: "${displayName}" (ID: ${entryId})`);
          }
          skippedCount++;
          return false;
        }
        return true;
      });

      if (skippedCount > 0) {
        UI.showToast(`Skipping ${skippedCount} records that have already won prizes`, 'info');
      }

      if (dataToUpload.length === 0) {
        UI.hideProgress();
        UI.showToast('All records in this file have already won prizes. No new records to upload.', 'warning');
        return;
      }
    }

    UI.updateProgress(35, 'Creating list structure...');

    const listId = UI.generateId();

    const listData = {
      listId: listId,
      metadata: {
        listId: listId,
        name: finalListName,
        timestamp: Date.now(),
        originalFilename: pendingCSVData.fileName,
        entryCount: dataToUpload.length,
        originalCount: pendingCSVData.data.length,
        skippedWinners: skippedCount,
        nameConfig: nameConfig,
        infoConfig: infoConfig,
        idConfig: idConfig,
        // MP source info for sync capability (null if not from MP)
        mpSource: pendingCSVData.mpSource || null,
        // Sync tracking
        lastSyncAt: null,
        syncCount: 0,
        // Per-list settings, read from the wizard above. The global settings only supplied
        // the defaults the wizard opened with.
        listSettings: wizardConfig.listSettings
      },
      entries: dataToUpload.map((row, index) => ({
        id: generateEntryId(row, index, idConfig),
        index: index,
        data: row
      }))
    };

    UI.updateProgress(50, 'Saving locally...');

    // Save list (handles sharding automatically for large lists)
    await Database.saveToStore('lists', listData, {
      onProgress: (progress, message) => {
        UI.updateProgress(50 + (progress * 0.4), message); // Scale progress to 50-90%
      }
    });

    UI.updateProgress(100, 'Complete! Syncing to cloud in background...');

    // Hide progress after a short delay to show completion
    setTimeout(() => {
      UI.hideProgress();
    }, 1000);

    const entriesText = dataToUpload.length > 1000 ?
      `${dataToUpload.length} entries (auto-sharded for optimal performance)` :
      `${dataToUpload.length} entries`;

    const skippedText = skippedCount > 0 ? ` (${skippedCount} duplicates skipped)` : '';

    UI.showToast(`List "${finalListName}" imported with ${entriesText}${skippedText}!`, 'success');

    // Clear form and hide preview (don't show cancel toast after success)
    document.getElementById('listName').value = '';
    document.getElementById('csvFile').value = '';
    handleCancelUpload(false);

    pendingCSVData = null;

    // Refresh Alpine store (updates UI reactively)
    await Lists.loadLists();
  } catch (error) {
    UI.hideProgress();
    console.error('Error confirming upload:', error);
    UI.showToast('Error uploading list: ' + error.message, 'error');
  }
}

// The wizard's config getters now live in list-config.js as readWizardConfig(), shared with
// the edit flow so importing and editing can never read the same controls differently.

function validateColumnIds(data, columnName) {
  const ids = [];
  const duplicates = [];
  const emptyValues = [];

  for (let i = 0; i < data.length; i++) {
    const value = data[i][columnName];
    const rowNum = i + 1;

    // Check for empty values
    if (!value || value.toString().trim() === '') {
      emptyValues.push(rowNum);
      continue;
    }

    const trimmedValue = value.toString().trim();

    // Check for duplicates
    if (ids.includes(trimmedValue)) {
      duplicates.push({
        value: trimmedValue,
        row: rowNum
      });
    } else {
      ids.push(trimmedValue);
    }
  }

  if (emptyValues.length > 0) {
    return {
      isValid: false,
      error: `Empty ID values found in rows: ${emptyValues.slice(0, 5).join(', ')}${emptyValues.length > 5 ? ` and ${emptyValues.length - 5} more` : ''}`
    };
  }

  if (duplicates.length > 0) {
    const duplicateList = duplicates.slice(0, 3).map(d => `"${d.value}" (row ${d.row})`).join(', ');
    return {
      isValid: false,
      error: `Duplicate ID values found: ${duplicateList}${duplicates.length > 3 ? ` and ${duplicates.length - 3} more` : ''}`
    };
  }

  return {
    isValid: true
  };
}

function generateEntryId(row, index, idConfig) {
  if (idConfig.source === 'column') {
    const value = row[idConfig.column];
    return value ? value.toString().trim() : UI.generateId();
  } else {
    return UI.generateId();
  }
}

function handleCancelUpload(showToast = true) {
  const wasEditing = ListConfig.getWizardMode().mode === WIZARD_MODE.EDIT;

  document.getElementById('dataPreviewCard').style.display = 'none';
  document.getElementById('nameConfigCard').style.display = 'none';
  pendingCSVData = null;

  // Always hand the wizard back in import mode, or the next CSV upload opens a wizard still
  // locked to the list that was being edited.
  ListConfig.setWizardMode({ mode: WIZARD_MODE.IMPORT });

  if (showToast) {
    UI.showToast(wasEditing ? 'Changes discarded' : 'Upload cancelled', 'info');
  }
}

export const CSVParser = {
  parseCSV,
  handleCSVUpload,
  handleConfirmUpload,
  handleCancelUpload,
  showCSVPreview,
  // Used by Lists.editListConfig to drive the same wizard in edit mode.
  showNameConfiguration,
  get pendingCSVData() { return pendingCSVData; },
  set pendingCSVData(data) { pendingCSVData = data; }
};

window.CSVParser = CSVParser;