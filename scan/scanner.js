// Scanner Module - QR scanning orchestration (Alpine.js version)
//
// Delegates camera capture + decoding to the tiered scan engines (native
// BarcodeDetector -> zxing-wasm -> pure-JS fallback) and wires decoded ticket codes to
// the winner lookup + Alpine store callbacks.
import { UI } from '../src/js/modules/ui.js';
import { WinnerSearch } from './winner-search.js';
import { createScanEngine } from './scan-engines.js';

// Ignore repeat reads of the same value within this window (the loop-based engines emit
// the same code many times per second while it stays in frame).
const DEDUPE_WINDOW_MS = 1500;

class ScannerModule {
  constructor() {
    this.engine = null;
    this.videoElement = null;
    this.isScanning = false;

    // Dedupe / re-entrancy guards for the continuous decode stream.
    this.lastValue = null;
    this.lastValueAt = 0;
    this.processing = false;

    // Callbacks for Alpine store integration.
    this.onWinnerFound = null;
    this.onFamilyWinners = null;
    this.onNoWinner = null;
    this.onScanningChange = null;
    this.onStartingChange = null;   // camera/engine warm-up state
    this.onEngineSelected = null;   // reports the active tier ('native' | 'wasm' | 'js')
  }

  async init() {
    // Engine selection happens lazily in startScanning(); nothing to do here.
  }

  async startScanning(options = {}) {
    if (this.isScanning || this.processing) return;

    if (!this.videoElement) {
      this.videoElement = document.getElementById('qr-video');
    }
    if (!this.videoElement) {
      UI.showToast('Scanner video element not found', 'error');
      return;
    }

    // Reset dedupe state so re-scanning the same code after returning works instantly.
    this.lastValue = null;
    this.lastValueAt = 0;

    this.onStartingChange?.(true);
    try {
      this.engine = await createScanEngine(options);
      this.onEngineSelected?.(this.engine.name, this.engine.downgradeReason);
      await this.engine.start(
        this.videoElement,
        (value) => this.handleDecode(value),
        (error) => this.handleEngineFatal(error)
      );
      this.isScanning = true;
      this.onScanningChange?.(true);
    } catch (error) {
      console.error('Error starting scanner:', error);
      UI.showToast('Failed to start camera: ' + (error?.message || error), 'error');
    } finally {
      this.onStartingChange?.(false);
    }
  }

  // An engine reported it cannot decode on this device (e.g. native barcode service
  // unavailable). Downgrade to the next tier rather than running a blind camera.
  handleEngineFatal(error) {
    const failedEngine = this.engine?.name;
    console.warn(`Scanner engine "${failedEngine}" unavailable, downgrading:`, error);
    this.stopScanning();

    if (failedEngine === 'native') {
      this.startScanning({ skipNative: true });
    } else {
      UI.showToast('Scanner is unavailable on this device', 'error');
    }
  }

  stopScanning() {
    if (this.engine) {
      this.engine.stop();
      this.engine = null;
    }
    this.isScanning = false;
    this.onScanningChange?.(false);
  }

  handleDecode(value) {
    if (!value || this.processing) return;

    const now = Date.now();
    if (value === this.lastValue && now - this.lastValueAt < DEDUPE_WINDOW_MS) return;
    this.lastValue = value;
    this.lastValueAt = now;

    // Only act on values that look like ticket codes; ignore anything else and keep
    // scanning (no toast spam for stray QR codes).
    if (!WinnerSearch.isTicketCode(value)) {
      return;
    }

    this.processScan(value);
  }

  async processScan(ticketCode) {
    this.processing = true;

    // Stop the camera while we resolve + display the result.
    this.stopScanning();

    try {
      const winnerData = await WinnerSearch.findByTicketCode(ticketCode);

      if (winnerData) {
        // Check if this is a family winners result
        if (winnerData.type === 'familyWinners') {
          this.onFamilyWinners?.(winnerData);
        } else {
          this.onWinnerFound?.(winnerData);
        }
      } else {
        this.onNoWinner?.(ticketCode);
      }
    } catch (error) {
      console.error('Error processing scan result:', error);
      UI.showToast('Error processing scan: ' + (error?.message || error), 'error');
      // Transient lookup failure — resume scanning so the operator can retry.
      this.processing = false;
      this.startScanning();
      return;
    }

    this.processing = false;
  }
}

// Create singleton instance
export const Scanner = new ScannerModule();
