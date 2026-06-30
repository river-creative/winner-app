// Scan App - Entry point for the QR scanner page (Alpine.js version)
import { Database } from '../src/js/modules/database.js';
import { Settings } from '../src/js/modules/settings.js';
import { UI } from '../src/js/modules/ui.js';
import { Scanner } from './scanner.js';
import { WinnerSearch } from './winner-search.js';

// Status text reflecting which scanner tier is active.
function scanningStatus(engine) {
  if (engine === 'js') return 'Scanning… (basic scanner)';
  if (engine === 'native' || engine === 'wasm') return 'Scanning… (enhanced)';
  return 'Scanning for QR codes...';
}

// Initialize the scan application
async function initializeScanApp() {
  try {
    // Initialize database
    await Database.initDB();

    // Load settings and apply theme
    await Settings.loadSettings();
    Settings.setupTheme();

    // Get the Alpine store
    const store = Alpine.store('scan');

    // Apply saved theme
    document.body.setAttribute('data-theme', store.darkMode ? 'dark' : 'light');

    // Check if operator name is set, show modal if not
    if (!store.operatorName) {
      store.showOperatorModal = true;
    }

    // Initialize QR Scanner
    await Scanner.init();

    // Set up scanner callbacks
    Scanner.onWinnerFound = (winnerData) => {
      store.winner = winnerData.winner;
      store.prizes = winnerData.prizes;
      store.isFamilySearch = false;
      store.view = 'winner';
    };

    Scanner.onFamilyWinners = (familyData) => {
      store.scannedIdCard = familyData.scannedIdCard;
      store.searchResults = familyData.results;
      store.isFamilySearch = true;
      store.view = 'results';
    };

    Scanner.onNoWinner = (ticketCode) => {
      store.alertTicketCode = ticketCode;
      store.showAlert = true;
    };

    Scanner.onScanningChange = (isScanning) => {
      store.isScanning = isScanning;
      store.scanStatus = isScanning ? scanningStatus(store.scannerEngine) : 'Camera stopped';
    };

    Scanner.onStartingChange = (isStarting) => {
      store.isStarting = isStarting;
      if (isStarting) store.scanStatus = 'Starting camera…';
    };

    Scanner.onEngineSelected = (engine, reason) => {
      store.scannerEngine = engine;
      store.scannerReason = reason || '';
    };

    // Override store methods with real implementations
    store.startScanning = () => {
      Scanner.startScanning();
    };

    store.stopScanning = () => {
      Scanner.stopScanning();
    };

    store.performSearch = async () => {
      const input = store.searchInput.trim();
      if (!input) {
        UI.showToast('Please enter a ticket code or winner name', 'error');
        return;
      }

      try {
        const searchResult = await WinnerSearch.search(input);
        store.searchInput = ''; // Clear input

        if (searchResult.type === 'ticketCode') {
          if (searchResult.result) {
            // Check if this is a family winners result
            if (searchResult.result.type === 'familyWinners') {
              store.scannedIdCard = searchResult.result.scannedIdCard;
              store.searchResults = searchResult.result.results;
              store.isFamilySearch = true;
              store.view = 'results';
              Scanner.stopScanning();
            } else {
              store.winner = searchResult.result.winner;
              store.prizes = searchResult.result.prizes;
              store.isFamilySearch = false;
              store.view = 'winner';
              Scanner.stopScanning();
            }
          } else {
            store.alertTicketCode = input;
            store.showAlert = true;
          }
        } else {
          // Name search
          const results = searchResult.results;
          if (results.length === 0) {
            store.searchTerm = input;
            store.showNoResultsModal = true;
          } else if (results.length === 1) {
            store.winner = results[0].winner;
            store.prizes = results[0].prizes;
            store.isFamilySearch = false;
            store.view = 'winner';
            Scanner.stopScanning();
          } else {
            store.searchTerm = input;
            store.searchInput = input;
            store.searchResults = results;
            store.isFamilySearch = false;
            store.view = 'results';
          }
        }
      } catch (error) {
        console.error('Error searching:', error);
        UI.showToast('Error searching: ' + error.message, 'error');
      }
    };

    store.selectResult = (index) => {
      const result = store.searchResults[index];
      if (result) {
        store.winner = result.winner;
        store.prizes = result.prizes;
        store.view = 'winner';
      }
    };

    store.markPickedUp = async (index) => {
      const prize = store.prizes[index];
      if (!prize || prize.pickedUp) return;

      try {
        // Optimistic UI update
        store.prizes[index].pickedUp = true;
        store.prizes[index].pickupTimestamp = new Date().toISOString();
        store.prizes[index].pickupStation = store.operatorName;

        // Persist to database
        await Database.updateWinner(prize.winnerId, {
          pickedUp: true,
          pickupTimestamp: store.prizes[index].pickupTimestamp,
          pickupStation: store.operatorName
        });

        UI.showToast('Prize marked as picked up!', 'success');
      } catch (error) {
        // Revert on error
        store.prizes[index].pickedUp = false;
        store.prizes[index].pickupTimestamp = null;
        store.prizes[index].pickupStation = null;
        console.error('Error marking as picked up:', error);
        UI.showToast('Failed to update: ' + error.message, 'error');
      }
    };

    store.backToScanner = () => {
      store.view = 'scanner';
      store.winner = null;
      store.prizes = [];
      store.searchResults = [];
      store.searchInput = '';
      store.isFamilySearch = false;
      store.scannedIdCard = '';
      Scanner.startScanning();
    };

    store.dismissAlert = () => {
      store.showAlert = false;
      store.alertTicketCode = '';
      Scanner.startScanning();
    };

    // Auto-start scanning after a short delay
    setTimeout(() => Scanner.startScanning(), 500);

    UI.showToast('Scanner ready!', 'success');
  } catch (error) {
    console.error('Scan app initialization error:', error);
    UI.showToast('Failed to initialize scanner: ' + error.message, 'error');
  }
}

// Wait for both DOM and Alpine to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', waitForAlpine);
} else {
  waitForAlpine();
}

function waitForAlpine() {
  const checkAlpine = setInterval(() => {
    if (window.Alpine && Alpine.store('scan')) {
      clearInterval(checkAlpine);
      initializeScanApp();
    }
  }, 50);
}
