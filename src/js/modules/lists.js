// ================================
// LISTS MANAGEMENT
// ================================

import { Database } from './database.js';
import { UI } from './ui.js';

// Load lists - uses centralized data store
// Alpine x-for templates react automatically to store changes
async function loadLists(listsData = null) {
  try {
    if (window.Alpine) {
      const dataStore = Alpine.store('data');
      if (dataStore) {
        if (listsData) {
          // If data was passed, update centralized store directly
          dataStore.lists = listsData;
        } else {
          // Otherwise load from database
          await dataStore.load('lists');
        }
      }
    }
  } catch (error) {
    console.error('Error loading lists:', error);
    UI.showToast('Error loading lists: ' + error.message, 'error');
  }
}

async function viewList(listId) {
  try {
    const list = await Database.getFromStore('lists', listId);
    if (list) {
      // Use Alpine viewModal component
      if (window.alpineViewModal) {
        await window.alpineViewModal.showList(list);
      } else {
        console.error('Alpine viewModal not initialized');
        UI.showToast('Error: Modal not ready', 'error');
      }
    }
  } catch (error) {
    console.error('Error viewing list:', error);
    UI.showToast('Error viewing list: ' + error.message, 'error');
  }
}

async function deleteListConfirm(listId) {
  // Check if list is referenced by winners or history
  const isReferenced = await Database.isListReferenced(listId);

  const message = isReferenced
    ? 'This list has associated winners or history. It will be archived so records can still reference it. Continue?'
    : 'Are you sure you want to delete this list? This action cannot be undone.';

  UI.showConfirmationModal(
    'Delete List',
    message,
    async () => {
      try {
        if (isReferenced) {
          // Auto-archive if referenced
          await Database.archiveList(listId);
          UI.showToast('List archived', 'success');
        } else {
          // Direct delete if not referenced
          await Database.deleteFromStore('lists', listId);
          UI.showToast('List deleted', 'success');
        }
        await loadLists(); // Updates Alpine store reactively
        // Drop the removed list from the persisted draw selection so the
        // public view can't show phantom selections (stale count / wrong name).
        window.Alpine?.store('setup')?.deselectList(listId);
      } catch (error) {
        console.error('Error deleting list:', error);
        UI.showToast('Error deleting list: ' + error.message, 'error');
      }
    }
  );
}

// Archive list manually (metadata only, entries discarded)
function archiveListConfirm(listId) {
  UI.showConfirmationModal(
    'Archive List',
    'Archive this list? The list will be removed but winners and history will still show its name. Entries will be discarded.',
    async () => {
      try {
        await Database.archiveList(listId);
        UI.showToast('List archived', 'success');
        await loadLists(); // Updates Alpine store reactively
        // Drop the archived list from the persisted draw selection so the
        // public view can't show phantom selections (stale count / wrong name).
        window.Alpine?.store('setup')?.deselectList(listId);
      } catch (error) {
        console.error('Error archiving list:', error);
        UI.showToast('Error archiving list: ' + error.message, 'error');
      }
    }
  );
}

function formatDisplayName(entry, nameConfig) {
  // New template-based format (nameConfig is a string)
  if (typeof nameConfig === 'string') {
    return nameConfig.replace(/\{([^}]+)\}/g, (match, key) => {
      return entry.data[key.trim()] || '';
    }).trim() || 'Unknown';
  }


  // Ultimate fallback: try common name fields
  const commonFields = ['name', 'full_name', 'first_name', 'last_name'];
  for (const field of commonFields) {
    if (entry.data[field]) {
      return entry.data[field];
    }
  }
  // If no name fields found, use first available field
  const firstField = Object.keys(entry.data)[0];
  return entry.data[firstField] || 'Unknown';
}

async function deleteListEntry(listId, entryId) {
  try {
    // Validate inputs
    if (!listId || !entryId) {
      UI.showToast('Invalid list or entry ID', 'error');
      console.error('deleteListEntry called with invalid params:', { listId, entryId });
      return;
    }

    const list = await Database.getFromStore('lists', listId);
    if (!list) {
      UI.showToast('List not found', 'error');
      return;
    }

    // Find and remove the entry
    const entryIndex = list.entries.findIndex(e => e.id === entryId);
    if (entryIndex === -1) {
      UI.showToast('Entry not found in list', 'error');
      return;
    }

    const entryName = formatDisplayName(list.entries[entryIndex], list.metadata.nameConfig);

    UI.showConfirmationModal(
      'Delete Entry',
      `Are you sure you want to delete "${entryName}" from this list?`,
      async () => {
        try {
          // Remove the entry from the list
          list.entries.splice(entryIndex, 1);

          // Update entry count in metadata
          list.metadata.entryCount = list.entries.length;

          // Re-index remaining entries
          list.entries.forEach((entry, index) => {
            entry.index = index;
          });

          // Save the updated list
          await Database.saveToStore('lists', list);

          UI.showToast(`Entry "${entryName}" deleted`, 'success');

          // Refresh Alpine store and modal view
          await loadLists();
          if (window.alpineViewModal) {
            await window.alpineViewModal.refreshList();
          }
        } catch (error) {
          console.error('Error deleting entry:', error);
          UI.showToast('Error deleting entry: ' + error.message, 'error');
        }
      }
    );
  } catch (error) {
    console.error('Error in deleteListEntry:', error);
    UI.showToast('Error: ' + error.message, 'error');
  }
}

// Sync list from Ministry Platform
async function syncList(listId) {
  try {
    // Get the list
    const list = await Database.getFromStore('lists', listId);
    if (!list) {
      UI.showToast('List not found', 'error');
      return;
    }

    // Check if list is syncable (has MP source info)
    if (!list.metadata.mpSource) {
      UI.showToast('This list was not imported from Ministry Platform and cannot be synced', 'warning');
      return;
    }

    const mpSource = list.metadata.mpSource;

    UI.showProgress('Syncing List', 'Fetching data from Ministry Platform...');

    // Re-execute the MP query with stored parameters
    const response = await fetch('/api/mp/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        queryId: mpSource.queryId,
        params: mpSource.params
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      UI.hideProgress();
      UI.showToast(result.error || 'Failed to fetch data from Ministry Platform', 'error');
      return;
    }

    UI.updateProgress(40, 'Processing entries...');

    const newData = result.data;

    // Build set of existing entry IDs
    const existingIds = new Set(list.entries.map(e => e.id));

    // Determine ID column from idConfig
    const idColumn = list.metadata.idConfig?.column || 'idCard';

    // If removeWinnersFromList is active, get existing winner IDs to exclude
    let winnerIds = new Set();
    if (list.metadata.listSettings?.removeWinnersFromList !== false) {
      const winners = await Database.getFromStore('winners');
      if (winners && Array.isArray(winners)) {
        // Filter winners that came from this list
        winners.forEach(w => {
          if (w.listId === listId && w.entryId) {
            winnerIds.add(w.entryId);
          }
        });
      }
    }

    UI.updateProgress(60, 'Finding new entries...');

    // Find new entries (not in existing list and not already winners)
    const newEntries = [];
    for (const record of newData) {
      const entryId = record[idColumn]?.toString().trim();
      if (!entryId) continue;
      if (existingIds.has(entryId)) continue;
      // Exclude if already a winner (when removeWinnersFromList is active)
      if (winnerIds.has(entryId)) continue;

      newEntries.push({
        id: entryId,
        index: list.entries.length + newEntries.length,
        data: record
      });
    }

    if (newEntries.length === 0) {
      UI.hideProgress();
      UI.showToast('No new entries found - list is up to date', 'info');

      // Update sync timestamp even if no new entries
      list.metadata.lastSyncAt = Date.now();
      list.metadata.syncCount = (list.metadata.syncCount || 0) + 1;
      await Database.saveToStore('lists', list);
      await loadLists();
      return;
    }

    UI.updateProgress(80, `Adding ${newEntries.length} new entries...`);

    // Add new entries to list
    list.entries.push(...newEntries);
    list.metadata.entryCount = list.entries.length;
    list.metadata.lastSyncAt = Date.now();
    list.metadata.syncCount = (list.metadata.syncCount || 0) + 1;

    // Save updated list
    await Database.saveToStore('lists', list);

    UI.hideProgress();
    UI.showToast(`Sync complete! Added ${newEntries.length} new entries`, 'success');

    // Refresh lists display
    await loadLists();

  } catch (error) {
    UI.hideProgress();
    console.error('Error syncing list:', error);
    UI.showToast('Error syncing list: ' + error.message, 'error');
  }
}

// Edit list configuration (opens modal)
async function editListConfig(listId) {
  try {
    const list = await Database.getFromStore('lists', listId);
    if (!list) {
      UI.showToast('List not found', 'error');
      return;
    }

    // Get modal element and its Alpine data
    const modalEl = document.getElementById('editListConfigModal');
    if (!modalEl) {
      UI.showToast('Edit modal not found', 'error');
      return;
    }

    // Get current settings with defaults
    const removeWinners = list.metadata?.listSettings?.removeWinnersFromList ?? true;
    const listName = list.metadata?.name || '';

    // Update Alpine data on the modal
    const alpineData = Alpine.$data(modalEl);
    if (alpineData) {
      alpineData.listId = listId;
      alpineData.listName = listName;
      alpineData.removeWinners = removeWinners;
    }

    // Show the modal
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

  } catch (error) {
    console.error('Error opening edit config:', error);
    UI.showToast('Error opening settings: ' + error.message, 'error');
  }
}

// Save list configuration
async function saveListConfig(listId) {
  try {
    const list = await Database.getFromStore('lists', listId);
    if (!list) {
      UI.showToast('List not found', 'error');
      return;
    }

    // Get values from modal
    const modalEl = document.getElementById('editListConfigModal');
    const alpineData = Alpine.$data(modalEl);

    const listName = alpineData?.listName || document.getElementById('editListName')?.value;
    const removeWinners = alpineData?.removeWinners ?? document.getElementById('editRemoveWinnersFromList')?.checked ?? true;

    // preventWinningSamePrize is auto-enabled when NOT removing winners
    const preventSamePrize = !removeWinners
      ? true
      : (document.getElementById('editPreventWinningSamePrize')?.checked ?? false);

    // Update list metadata
    list.metadata.name = listName;

    // Initialize listSettings if not present
    if (!list.metadata.listSettings) {
      list.metadata.listSettings = {};
    }

    list.metadata.listSettings.removeWinnersFromList = removeWinners;
    list.metadata.listSettings.preventWinningSamePrize = preventSamePrize;

    // Save the updated list
    await Database.saveToStore('lists', list);

    // Hide modal
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) {
      modal.hide();
    }

    UI.showToast('List settings saved', 'success');

    // Refresh lists display
    await loadLists();

  } catch (error) {
    console.error('Error saving list config:', error);
    UI.showToast('Error saving settings: ' + error.message, 'error');
  }
}

// Export public functions
export const Lists = {
  loadLists,
  viewList,
  deleteListConfirm,
  archiveListConfirm,
  deleteListEntry,
  formatDisplayName,
  syncList,
  editListConfig,
  saveListConfig
};

// Keep for onclick handlers in Alpine templates
window.Lists = Lists;