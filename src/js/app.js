// ================================
// MAIN APPLICATION LOGIC
// ================================

import { Database } from './modules/database.js';
import { DOMUtils } from './modules/dom-utils.js';
import eventManager from './modules/event-manager.js';
import { Settings, settings } from './modules/settings.js';
import { UI } from './modules/ui.js';
import { Lists } from './modules/lists.js';
import { Prizes } from './modules/prizes.js';
import { Winners } from './modules/winners.js';
import { Selection } from './modules/selection.js';
import { CSVParser } from './modules/csv-parser.js';
import { Export } from './modules/export.js';
import { Sounds } from './modules/sounds.js';
import { Texting } from './modules/texting.js';
import { Reports } from './modules/reports.js';
import { MinistryPlatform } from './modules/ministryplatform.js';
import { Templates } from './modules/templates.js';
import KeyboardShortcuts from './modules/keyboard-shortcuts.js';

// Global state variables (now truly central)
export let appModal = null;
let _currentList = null; // Internal variable
let _lastAction = null; // Internal variable
let _currentWinners = []; // Current batch of winners

// Export functions to get/set these central state variables
export function setCurrentList(list) {
  _currentList = list;
}

export function getCurrentList() {
  return _currentList;
}

export function setLastAction(action) {
  _lastAction = action;
}

export function getLastAction() {
  return _lastAction;
}

export function setCurrentWinners(winners) {
  _currentWinners = winners;
  // Show SMS button when winners are set
  const smsBtn = document.getElementById('sendSMSBtn');
  if (smsBtn && winners && winners.length > 0) {
    smsBtn.classList.remove('d-none');
  }
}

export function getCurrentWinners() {
  return _currentWinners;
}

export function clearCurrentWinners() {
  _currentWinners = [];
  // Hide SMS button when no current winners
  const smsBtn = document.getElementById('sendSMSBtn');
  if (smsBtn) {
    smsBtn.classList.add('d-none');
  }
}

// Load data in background without blocking UI
async function loadDataInBackground() {
  try {
    // Use centralized data store to load all collections
    if (window.Alpine) {
      const dataStore = Alpine.store('data');
      if (dataStore) {
        await dataStore.loadAll();
      }
    }

    // Get data from centralized store for vanilla JS modules that still need it
    const lists = window.Alpine?.store('data')?.lists || [];
    const prizes = window.Alpine?.store('data')?.prizes || [];
    const winners = window.Alpine?.store('data')?.winners || [];

    // Update any remaining vanilla JS UI components
    await Lists.loadLists(lists);
    await Prizes.loadPrizes(prizes);
    await Winners.loadWinners(winners, lists);
    // Alpine stores populated above handle quick select dropdowns via x-for
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

// Application initialization
export async function initializeApp() {
  try {
    await Database.initDB();

    // Load settings first, then load data - this ensures proper dropdown restoration
    await Settings.loadSettings();
    Settings.setupTheme(); // Apply theme once settings are loaded
    
    // Apply visibility settings based on loaded settings
    UI.applyVisibilitySettings();

    // Load all data once in background
    loadDataInBackground();

    // Initialize sound system
    Sounds.initSounds();
    
    // Initialize report import functionality
    Reports.initReportImport();
    
    // Initialize keyboard shortcuts for public view
    KeyboardShortcuts.init();

    // Initialize templates functionality
    Templates.initTemplates();
    
    // Initialize MinistryPlatform import functionality
    MinistryPlatform.init();

    // Initialize modals after everything else is ready
    // Alpine handles confirmModal, formModal, and viewModal components
    setTimeout(() => {
      // Handle stacked modal backdrops - ensure confirmModal backdrop is above other modals
      const confirmModalElement = document.getElementById('confirmModal');
      confirmModalElement?.addEventListener('show.bs.modal', () => {
        // Delay to let Bootstrap create the backdrop
        setTimeout(() => {
          const backdrops = document.querySelectorAll('.modal-backdrop');
          if (backdrops.length > 1) {
            // Set the newest backdrop (for confirmModal) to higher z-index
            backdrops[backdrops.length - 1].style.zIndex = '1065';
          }
        }, 10);
      });
    }, 100);

    setupEventListeners();

    // Firestore handles sync automatically with offline persistence

  } catch (error) {
    console.error('Initialization error:', error);
    UI.showToast('Failed to initialize application: ' + error.message, 'error');
  }
}

// Event Listeners Setup
function setupEventListeners() {
  setupInterfaceToggles();
  setupQuickSelection();
  setupManagementListeners();
  setupWinnerFilters();
  setupDisplayMode();
  setupTabListeners();
  setupHistoryDelegation();
}

function setupHistoryDelegation() {
  // Setup event delegation for history delete buttons (only once)
  const tbody = document.getElementById('historyTableBody');
  if (tbody) {
    eventManager.delegate(tbody, '[data-history-id]', 'click', function(e) {
      const historyId = this.getAttribute('data-history-id');
      deleteHistoryConfirm(historyId);
    });
  }
}

function setupTabListeners() {
  // Ensure proper tab activation with show class
  const tabButtons = document.querySelectorAll('[data-bs-toggle="tab"]');
  tabButtons.forEach(button => {
    button.addEventListener('shown.bs.tab', async function (event) {
      // Ensure the show class is properly applied
      const targetId = event.target.getAttribute('data-bs-target');
      const targetPane = document.querySelector(targetId);
      if (targetPane) {
        // Remove show from all panes
        document.querySelectorAll('.tab-pane').forEach(pane => {
          pane.classList.remove('show');
        });
        // Add show to active pane
        targetPane.classList.add('show');
      }
      
      // Reload data for specific tabs when they are shown
      const tabId = targetId?.replace('#', '');
      switch(tabId) {
        case 'lists':
          await Lists.loadLists();
          break;
        case 'prizes':
          await Prizes.loadPrizes();
          break;
        case 'winners':
          await Winners.loadWinners();
          break;
        case 'history':
          await loadHistory(); // Alpine store update triggers reactive stats
          break;
        case 'setup':
          // Refresh Alpine stores with latest data
          await Lists.loadLists();
          await Prizes.loadPrizes();
          break;
      }
    });
  });
}

function setupInterfaceToggles() {
  const managementToggle = document.getElementById('managementToggle');
  const backToPublicBtn = document.getElementById('backToPublicBtn');
  const fullscreenToggle = document.getElementById('fullscreenToggle');
  const sendSMSBtn = document.getElementById('sendSMSBtn');

  if (managementToggle) {
    managementToggle.addEventListener('click', function () {
      // Use Alpine store for view toggle
      if (window.Alpine && Alpine.store('ui')) {
        Alpine.store('ui').showManagement();
      }
    });
  }

  if (backToPublicBtn) {
    backToPublicBtn.addEventListener('click', async function () {
      try {
        // Force reload ALL data from database to ensure everything is current
        await Settings.loadSettings();
        Settings.applyTheme();
        Settings.loadSettingsToForm();
        
        // Reload lists and prizes into Alpine stores
        await Lists.loadLists();
        await Prizes.loadPrizes();

        // Update remaining vanilla UI components
        UI.applyVisibilitySettings();
        
        // Reload winners
        await Winners.loadWinners();
        
        // Update history stats
        await loadHistory();

        // Switch to public interface using Alpine store
        if (window.Alpine && Alpine.store('ui')) {
          Alpine.store('ui').showPublic();
        }
      } catch (error) {
        console.error('Error refreshing data:', error);
        UI.showToast('Error refreshing data: ' + error.message, 'error');
      }
    });
  }

  if (fullscreenToggle) {
    eventManager.on(fullscreenToggle, 'click', function () {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
        DOMUtils.safeSetHTML(fullscreenToggle, '<i class="bi bi-fullscreen-exit"></i>', true);
      } else {
        document.exitFullscreen();
        DOMUtils.safeSetHTML(fullscreenToggle, '<i class="bi bi-fullscreen"></i>', true);
      }
    });
  }
  
  // Add keyboard shortcut 'v' to toggle between views
  document.addEventListener('keydown', function(e) {
    // Only trigger if not typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'v' || e.key === 'V') {
      // Use Alpine store for view toggle
      if (window.Alpine && Alpine.store('ui')) {
        const uiStore = Alpine.store('ui');
        if (uiStore.view === 'management') {
          // Switch to public view (same as clicking "Public View" button)
          if (backToPublicBtn) {
            backToPublicBtn.click();
          }
        } else {
          // Switch to management view
          uiStore.showManagement();
        }
      }
    }
  });

  if (sendSMSBtn) {
    sendSMSBtn.addEventListener('click', function (e) {
      e.preventDefault();
      Texting.sendToCurrentWinners();
    });
  }
}

function setupQuickSelection() {
  // List / prize / winner-count selection is handled reactively by the Alpine
  // `setup` store (see index.html) — the checkboxes, cards, Select All/Clear All
  // buttons, and displays all bind to it. Only the public-view action buttons
  // need imperative wiring here.
  const bigPlayButton = document.getElementById('bigPlayButton');
  const newSelectionBtn = document.getElementById('newSelectionBtn');
  const undoSelectionBtn = document.getElementById('undoSelectionBtn');

  if (bigPlayButton) bigPlayButton.addEventListener('click', Selection.handleBigPlayClick);
  if (newSelectionBtn) newSelectionBtn.addEventListener('click', Winners.resetToSelectionMode);
  if (undoSelectionBtn) undoSelectionBtn.addEventListener('click', Winners.undoLastSelection);
}

function setupManagementListeners() {
  // CSV Upload handlers
  const csvFileInput = document.getElementById('csvFile');
  const confirmUpload = document.getElementById('confirmUpload');
  const cancelUpload = document.getElementById('cancelUpload');

  // The file input change is now triggered from the button click
  if (csvFileInput) {
    csvFileInput.addEventListener('change', async (event) => {
      await CSVParser.handleCSVUpload(event);
    });
  }
  if (confirmUpload) confirmUpload.addEventListener('click', CSVParser.handleConfirmUpload);
  if (cancelUpload) cancelUpload.addEventListener('click', CSVParser.handleCancelUpload);

  // Prize Management
  const addPrizeBtn = document.getElementById('addPrizeBtn');
  if (addPrizeBtn) addPrizeBtn.addEventListener('click', Prizes.handleAddPrize);

  // New Add Prize Modal Button
  const addPrizeModalBtn = document.getElementById('addPrizeModalBtn');
  if (addPrizeModalBtn) addPrizeModalBtn.addEventListener('click', Prizes.showAddPrizeModal);

  // Upload List Button - Opens file browser directly
  const uploadListModalBtn = document.getElementById('uploadListModalBtn');
  if (uploadListModalBtn) {
    uploadListModalBtn.addEventListener('click', (e) => {
      e.preventDefault(); // Prevent anchor default behavior
      // Just trigger the file input directly - no modal needed for step 1
      const csvFileInput = document.getElementById('csvFile');
      if (csvFileInput) {
        csvFileInput.click();
      }
    });
  }


  // Settings are now auto-saved, no manual save button needed

  // Preview delay button
  const previewDelayBtn = document.getElementById('previewDelayBtn');
  if (previewDelayBtn) previewDelayBtn.addEventListener('click', Settings.testDelay);

  // Setup webhook toggle functionality
  Settings.setupWebhookToggle();

  // Setup SMS template character counter
  Settings.setupSMSTemplateCounter();

  // Setup auto-save for quick setup fields
  Settings.setupQuickSetupAutoSave();

  // Setup auto-save for all settings fields
  Settings.setupAllSettingsAutoSave();

  // Theme
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) themeToggle.addEventListener('click', Settings.toggleTheme);

  const themePresets = document.querySelectorAll('.theme-preset');
  themePresets.forEach(button => {
    button.addEventListener('click', Settings.handleThemePreset);
  });

  // Sound dropdowns are already populated on init, no need to refresh on tab show

  // Celebration test button
  const testCelebrationBtn = document.getElementById('testCelebrationEffect');
  if (testCelebrationBtn) {
    testCelebrationBtn.addEventListener('click', () => {
      const celebrationEffect = document.getElementById('celebrationEffect')?.value || 'confetti';

      if (celebrationEffect === 'confetti' || celebrationEffect === 'both') {
        if (window.Animations && window.Animations.startConfettiAnimation) {
          window.Animations.startConfettiAnimation();
        } else {
          console.error('❌ Animations.startConfettiAnimation not available');
        }
      }

      if (celebrationEffect === 'coins' || celebrationEffect === 'both') {
        // Coin animation would trigger here if implemented
      }
    });
  }

  // Sound dropdowns are already populated on init, no need to refresh on tab show

  // Export/Import
  const exportWinnersBtn = document.getElementById('exportWinnersBtn');
  const clearWinnersBtn = document.getElementById('clearWinnersBtn');
  const checkSMSStatusBtn = document.getElementById('checkSMSStatusBtn');
  const backupData = document.getElementById('backupData');
  const restoreData = document.getElementById('restoreData');
  const backupOnline = document.getElementById('backupOnline');
  const restoreOnline = document.getElementById('restoreOnline');
  const undoLastSelection = document.getElementById('undoLastSelection');

  if (exportWinnersBtn) eventManager.on(exportWinnersBtn, 'click', Export.handleExportWinners);
  if (clearWinnersBtn) eventManager.on(clearWinnersBtn, 'click', Winners.clearAllWinners);
  if (checkSMSStatusBtn) {
    eventManager.on(checkSMSStatusBtn, 'click', async () => {
      const { Texting } = await import('./modules/texting.js');
      checkSMSStatusBtn.disabled = true;
      DOMUtils.safeSetHTML(checkSMSStatusBtn, '<i class="bi bi-arrow-clockwise spinner-border spinner-border-sm me-2"></i>Checking...', true);

      try {
        const count = await Texting.checkAllPendingStatuses();
        if (count > 0) {
          UI.showToast(`Checked status for ${count} pending message${count > 1 ? 's' : ''}`, 'success');
          // Reload winners to update Alpine store with new SMS statuses
          await Winners.loadWinners();
        } else {
          UI.showToast('No pending SMS messages to check', 'info');
        }
      } catch (error) {
        console.error('SMS status check error:', error);
        UI.showToast(`Error checking SMS statuses: ${error.message}`, 'error');
      } finally {
        checkSMSStatusBtn.disabled = false;
        DOMUtils.safeSetHTML(checkSMSStatusBtn, '<i class="bi bi-arrow-clockwise me-2"></i>Check SMS Status', true);
      }
    });
  }
  if (backupData) eventManager.on(backupData, 'click', Export.handleBackupData);
  if (restoreData) eventManager.on(restoreData, 'click', Export.handleRestoreData);
  if (backupOnline) eventManager.on(backupOnline, 'click', Export.handleBackupOnline);
  if (restoreOnline) eventManager.on(restoreOnline, 'click', Export.handleRestoreOnline);
  if (undoLastSelection) eventManager.on(undoLastSelection, 'click', Winners.undoLastSelection);

  // Clear filters button - now handled by Alpine @click in HTML
}

function setupWinnerFilters() {
  const prizeFilter = document.getElementById('filterPrize');
  const listFilter = document.getElementById('filterList');
  const selectionFilter = document.getElementById('filterSelection');
  const dateFilter = document.getElementById('filterDate');

  // Debounce filter changes to avoid multiple requests
  let filterTimeout;
  const debouncedLoadWinners = () => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => Winners.loadWinners(), 100);
  };

  if (prizeFilter) prizeFilter.addEventListener('change', debouncedLoadWinners);
  if (listFilter) listFilter.addEventListener('change', debouncedLoadWinners);
  if (selectionFilter) selectionFilter.addEventListener('change', debouncedLoadWinners);
  if (dateFilter) dateFilter.addEventListener('change', debouncedLoadWinners);
}

function setupDisplayMode() {
  // Sequential settings are now always visible in the Winner Display Effects section
  // No need to toggle visibility based on selection mode
}

// History Management - Alpine handles rendering, this just updates the store
export async function loadHistory() {
  try {
    const history = await Database.getFromStore('history');
    // Update centralized data store - history store uses getter from data store
    if (window.Alpine) {
      const dataStore = Alpine.store('data');
      if (dataStore) dataStore.history = history || [];
    }
  } catch (error) {
    console.error('Error loading history:', error);
    UI.showToast('Error loading history: ' + error.message, 'error');
  }
}

export async function deleteHistoryConfirm(historyId) {
  UI.showConfirmationModal('Delete History Entry', 'Are you sure you want to delete this history entry?', async () => {
    try {
      await Database.deleteFromStore('history', historyId);
      UI.showToast('History entry deleted', 'success');
      await loadHistory(); // Updates Alpine store, which triggers reactive UI update
    } catch (error) {
      console.error('Error deleting history entry:', error);
      UI.showToast('Error deleting history entry: ' + error.message, 'error');
    }
  });
}

// Make function available globally for inline onclick handlers
window.deleteHistoryConfirm = deleteHistoryConfirm;
window.setCurrentWinners = setCurrentWinners; // For debugging
