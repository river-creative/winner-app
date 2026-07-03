// ================================
// LOCAL JSON STORAGE SERVICE
// ================================

import { showSessionExpired } from './session.js';

// API base path - use relative path to work from any base URL
// This works whether app is at /, /win, or any other path
const API_BASE = './api';

// Wrapper for authenticated API calls: surface an expired/invalid session (401) to the
// user with a re-login prompt instead of letting callers silently swallow it as empty data.
async function apiFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    showSessionExpired();
    throw new Error('Session expired');
  }
  return response;
}

// Collection names matching current schema
const COLLECTIONS = {
  lists: 'lists',
  winners: 'winners',
  prizes: 'prizes',
  history: 'history',
  settings: 'settings',
  backups: 'backups',
  archive: 'archive'
};

// Track all active intervals for proper cleanup
const activeIntervals = new Map();
let intervalIdCounter = 0;

// Cleanup all intervals on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    activeIntervals.forEach((interval) => {
      if (interval.intervalId) {
        clearInterval(interval.intervalId);
      }
    });
    activeIntervals.clear();
  });
}

// Get key field for each collection (matches current schema)
function getKeyField(collectionName) {
  const keyFields = {
    lists: 'listId',
    winners: 'winnerId',
    prizes: 'prizeId',
    history: 'historyId',
    settings: 'key',
    backups: 'backupId',
    templates: 'templateId',
    archive: 'listId'
  };
  return keyFields[collectionName] || 'id';
}

// Save document to collection (local-first approach with server sync)
async function saveToStore(collectionName, data, options = {}) {
  try {
    const keyField = getKeyField(collectionName);
    const docId = data[keyField];
    
    if (!docId) {
      throw new Error(`Document must have a '${keyField}' field`);
    }
    
    // No longer need sharding - local storage handles large lists fine
    
    // Save to server
    
    const response = await apiFetch(`${API_BASE}/${collectionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    // Saved successfully
    
    return result.id || docId;
    
  } catch (error) {
    console.error(`Error saving to ${collectionName}:`, error);
    throw error;
  }
}

// Universal get function - handles single docs, all docs, and sharded lists automatically
async function getFromStore(collectionName, key = null) {
  try {

    // If key provided, get single document
    if (key) {
      // Standard single document retrieval
      const url = `${API_BASE}/${collectionName}/${key}`;
      const response = await apiFetch(url);

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    }
    
    // If no key provided, get all documents
    const response = await apiFetch(`${API_BASE}/${collectionName}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const results = await response.json();
    // Data loaded from server
    
    return results;
    
  } catch (error) {
    console.error(`Error getting from ${collectionName}:`, error);
    // Return empty array if API is unavailable - app should work with defaults
    return [];
  }
}

// Delete document from collection
async function deleteFromStore(collectionName, key) {
  try {
    // Delete from server
    
    const response = await apiFetch(`${API_BASE}/${collectionName}/${key}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // Deleted successfully
    return key;
    
  } catch (error) {
    console.error(`Error deleting from ${collectionName}:`, error);
    throw error;
  }
}

// Listen to collection changes (polling-based since we don't have WebSocket)
function listenToCollection(collectionName, callback) {
  let lastData = null;
  const listenerId = `listener_${collectionName}_${++intervalIdCounter}`;
  
  async function pollForChanges() {
    try {
      const currentData = await getFromStore(collectionName);
      const currentDataStr = JSON.stringify(currentData);
      
      if (lastData !== currentDataStr) {
        lastData = currentDataStr;
        callback(currentData);
      }
    } catch (error) {
      console.error(`Error polling ${collectionName}:`, error);
    }
  }
  
  // Poll every 5 seconds
  const intervalId = setInterval(pollForChanges, 5000);
  
  // Track this interval
  activeIntervals.set(listenerId, {
    intervalId,
    collectionName,
    startedAt: Date.now()
  });
  
  // Initial load
  pollForChanges();
  
  // Return cleanup function
  return () => {
    const interval = activeIntervals.get(listenerId);
    if (interval && interval.intervalId) {
      clearInterval(interval.intervalId);
      activeIntervals.delete(listenerId);
      console.log(`Cleaned up listener for ${collectionName}`);
    }
  };
}

// Query documents with filters (simplified version)
async function queryStore(collectionName, filters = []) {
  try {
    // For now, get all documents and filter client-side
    // Could be enhanced to support server-side filtering
    const allData = await getFromStore(collectionName);
    
    let results = allData;
    
    // Apply filters client-side
    for (const filter of filters) {
      if (filter.type === 'where') {
        results = results.filter(item => {
          const value = item[filter.field];
          switch (filter.operator) {
            case '==':
              return value === filter.value;
            case '!=':
              return value !== filter.value;
            case '>':
              return value > filter.value;
            case '<':
              return value < filter.value;
            case '>=':
              return value >= filter.value;
            case '<=':
              return value <= filter.value;
            default:
              return true;
          }
        });
      } else if (filter.type === 'orderBy') {
        results.sort((a, b) => {
          const aVal = a[filter.field];
          const bVal = b[filter.field];
          const direction = filter.direction === 'desc' ? -1 : 1;
          
          if (aVal < bVal) return -1 * direction;
          if (aVal > bVal) return 1 * direction;
          return 0;
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error(`Error querying ${collectionName}:`, error);
    throw error;
  }
}

// Update specific fields in a document
async function updateWinner(winnerId, updateData) {
  try {
    // Update winner pickup status
    
    // Get the existing winner data first
    const existingWinner = await getFromStore('winners', winnerId);
    if (!existingWinner) {
      throw new Error(`Winner ${winnerId} not found`);
    }
    
    // Merge update data with existing data
    const updatedWinner = {
      ...existingWinner,
      ...updateData
    };
    
    // Save the updated winner
    await saveToStore('winners', updatedWinner);
    
    // Winner updated
    return updatedWinner;
  } catch (error) {
    console.error(`Error updating winner ${winnerId}:`, error);
    throw error;
  }
}

// Batch fetch multiple collections in a single request
async function batchFetch(requests) {
  try {
    // Batch fetch collections
    
    const response = await apiFetch(`${API_BASE}/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to batch fetch: ${response.statusText}`);
    }
    
    const results = await response.json();
    // Batch fetch complete
    return results;
    
  } catch (error) {
    console.error('Error in batch fetch:', error);
    // Return empty results if API is unavailable
    const emptyResults = {};
    requests.forEach(req => {
      emptyResults[req.collection] = [];
    });
    return emptyResults;
  }
}

// Batch save multiple documents in a single request
async function batchSave(operations) {
  try {
    // Batch save documents
    
    const response = await apiFetch(`${API_BASE}/batch-save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operations })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to batch save: ${response.statusText}`);
    }
    
    const result = await response.json();
    // Batch save complete
    return result;
    
  } catch (error) {
    console.error('Error in batch save:', error);
    throw error;
  }
}

// Archive a list (save metadata to archive, delete original list)
async function archiveList(listId) {
  try {
    // Get the list to archive
    const list = await getFromStore('lists', listId);
    if (!list) {
      throw new Error(`List ${listId} not found`);
    }

    // Create archive entry with metadata only (no entries)
    const archiveEntry = {
      listId: list.listId,
      metadata: { ...list.metadata },
      archivedAt: Date.now()
    };

    // Save to archive collection
    await saveToStore('archive', archiveEntry);

    // Delete the original list
    await deleteFromStore('lists', listId);

    // Also delete any shards if this was a sharded list
    if (list.isSharded && list.shardIds) {
      for (const shardId of list.shardIds) {
        try {
          await deleteFromStore('lists', shardId);
        } catch (e) {
          console.warn(`Failed to delete shard ${shardId}:`, e);
        }
      }
    }

    return archiveEntry;
  } catch (error) {
    console.error(`Error archiving list ${listId}:`, error);
    throw error;
  }
}

// Check if a list is referenced by winners or history
async function isListReferenced(listId) {
  try {
    const [winners, history] = await Promise.all([
      getFromStore('winners'),
      getFromStore('history')
    ]);

    const hasWinners = winners.some(w => w.listId === listId);
    const hasHistory = history.some(h => h.listId === listId);

    return hasWinners || hasHistory;
  } catch (error) {
    console.error(`Error checking list references:`, error);
    return false;
  }
}

// Export the clean API - only the essentials
export const Database = {
  saveToStore,     // Handles everything: local-first, sharding
  getFromStore,    // Universal: single docs, all docs, sharded lists - handles everything
  deleteFromStore, // Server-based deletes
  listenToCollection, // Polling-based updates
  queryStore,      // Client-side filtered queries
  updateWinner,    // Update winner pickup status
  batchFetch,      // Batch fetch multiple collections
  batchSave,       // Batch save multiple documents
  archiveList,     // Archive list metadata and delete original
  isListReferenced, // Check if list has winners/history
  initDB: async () => {
    // Test server connectivity
    try {
        const response = await fetch(`${API_BASE}/health`);
      if (response.ok) {
        // Server connected
        return true;
      }
    } catch (error) {
      console.error('❌ Server connection failed:', error);
      throw new Error('Cannot connect to server');
    }
  },
  // Export COLLECTIONS constant
  COLLECTIONS
};

window.Database = Database;