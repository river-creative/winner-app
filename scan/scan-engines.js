// Scan Engines - framework-agnostic QR scanning with tiered progressive enhancement
//
// Tier 1: native BarcodeDetector — hardware/ML accelerated, best in low light
//         (Android Chrome/Edge).
// Tier 2: zxing-wasm — ZXing-C++ compiled to WebAssembly, a far more robust binarizer
//         than the pure-JS decoder in poor lighting. Used on iOS Safari, Firefox and
//         anywhere WebAssembly runs but BarcodeDetector is missing (i.e. most phones).
// Tier 3: Nimiq qr-scanner — the original pure-JS decoder, kept as a last-resort
//         fallback (lazy-loaded) for the rare device that supports neither of the above.
//
// createScanEngine() picks the best available tier at runtime and gracefully downgrades
// if a higher tier turns out to be unavailable (e.g. the wasm module fails to load).

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
// Self-hosted wasm asset emitted by the bundler — no runtime CDN dependency, so the
// scanner keeps working on flaky venue wifi / offline.
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// Resolve the wasm to an absolute URL. Emscripten's loader fetches relative to the
// document, not this module, so resolving against import.meta.url keeps it correct under
// relative ('./') base paths and sub-path deployments (e.g. /win/).
const ZXING_WASM_URL = new URL(zxingReaderWasmUrl, import.meta.url).href;
const ZXING_OVERRIDES = {
  locateFile: (path, prefix) => (path.endsWith('.wasm') ? ZXING_WASM_URL : prefix + path)
};

// --- Tuning constants -------------------------------------------------------

// Camera constraints tuned for low-light QR capture: rear camera and high resolution
// (the browser downscales if unavailable). Continuous focus is applied post-start.
const VIDEO_CONSTRAINTS = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1920 },
  height: { ideal: 1080 }
};

// zxing-wasm reader options. In v3 tryHarder/tryInvert/tryRotate/tryDownscale all default
// to true (exactly what we want for poor lighting); we only narrow the search to QR codes
// and a single symbol for speed.
const READER_OPTIONS = {
  formats: ['QRCode'],
  maxNumberOfSymbols: 1
};

// WASM tier: throttle decode rate (~8 fps) and cap frame resolution to bound CPU usage.
const WASM_DECODE_INTERVAL_MS = 120;
const WASM_MAX_DECODE_EDGE = 1000;
// Native tier is cheap; poll close to frame rate.
const NATIVE_DECODE_INTERVAL_MS = 60;

// --- Shared camera handling -------------------------------------------------

class CameraController {
  constructor() {
    this.stream = null;
  }

  async open(videoElement) {
    this.stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false });
    videoElement.srcObject = this.stream;
    videoElement.setAttribute('playsinline', 'true'); // required for inline playback on iOS
    await videoElement.play();

    // Best-effort continuous autofocus for sharper frames in poor light. Support varies
    // across devices, so failure here is non-fatal.
    const [track] = this.stream.getVideoTracks();
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch {
      /* focusMode unsupported on this device — ignore */
    }
  }

  close(videoElement) {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (videoElement) videoElement.srcObject = null;
  }
}

// --- Frame-loop engines (Tier 1 & 2) ----------------------------------------

// Base class: owns the camera and a self-throttling decode loop. Subclasses implement
// decodeFrame() -> Promise<string|null>. Each tick awaits the previous decode before
// scheduling the next, so decodes never overlap — no main-thread backlog/jank.
class FrameLoopEngine {
  constructor(name, intervalMs) {
    this.name = name;
    this.intervalMs = intervalMs;
    this.camera = new CameraController();
    this.videoElement = null;
    this.onResult = null;
    this.onFatal = null;
    this.running = false;
    this.timerId = null;
  }

  async start(videoElement, onResult, onFatal) {
    this.videoElement = videoElement;
    this.onResult = onResult;
    this.onFatal = onFatal;
    this.running = true;
    await this.camera.open(videoElement);
    this.scheduleNext(0);
  }

  stop() {
    this.running = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.camera.close(this.videoElement);
  }

  scheduleNext(delay) {
    if (!this.running) return;
    this.timerId = setTimeout(() => this.tick(), delay);
  }

  async tick() {
    if (!this.running) return;
    try {
      const value = await this.decodeFrame();
      if (!this.running) return;
      if (value) this.onResult?.(value);
    } catch (error) {
      if (!this.running) return;
      // A fatal error means this engine can't decode on this device (e.g. the native
      // barcode service is unavailable) — stop and let the caller downgrade a tier.
      if (this.isFatalError(error)) {
        this.running = false;
        this.camera.close(this.videoElement);
        this.onFatal?.(error);
        return;
      }
      // Otherwise transient (e.g. video not yet ready) — keep scanning.
    }
    this.scheduleNext(this.intervalMs);
  }

  async decodeFrame() {
    throw new Error('decodeFrame() must be implemented by subclass');
  }

  // Subclasses override to flag errors that should trigger a downgrade rather than retry.
  isFatalError() {
    return false;
  }
}

class NativeEngine extends FrameLoopEngine {
  constructor(detector) {
    super('native', NATIVE_DECODE_INTERVAL_MS);
    this.detector = detector;
  }

  async decodeFrame() {
    const codes = await this.detector.detect(this.videoElement);
    return codes.length ? codes[0].rawValue : null;
  }

  // Some Android devices advertise qr_code support yet throw on every detect() call
  // because the underlying ML/barcode service isn't available. Treat that as fatal so
  // the scanner downgrades to the WebAssembly tier instead of running blind.
  isFatalError(error) {
    const message = (error?.message || String(error)).toLowerCase();
    return /not implemented|service unavailable|unsupported|not supported/.test(message);
  }
}

class WasmEngine extends FrameLoopEngine {
  constructor() {
    super('wasm', WASM_DECODE_INTERVAL_MS);
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  async decodeFrame() {
    const video = this.videoElement;
    const { videoWidth: vw, videoHeight: vh } = video;
    if (!vw || !vh) return null;

    // Downscale large frames to keep decoding fast while preserving enough detail.
    const scale = Math.min(1, WASM_MAX_DECODE_EDGE / Math.max(vw, vh));
    const width = Math.round(vw * scale);
    const height = Math.round(vh * scale);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;

    this.ctx.drawImage(video, 0, 0, width, height);
    const imageData = this.ctx.getImageData(0, 0, width, height);
    const results = await readBarcodes(imageData, READER_OPTIONS);
    const hit = results.find((result) => result.isValid && result.text);
    return hit ? hit.text : null;
  }
}

// --- JS fallback engine (Tier 3) --------------------------------------------

class JsEngine {
  constructor(downgradeReason = '') {
    this.name = 'js';
    this.scanner = null;
    // Why we fell back to this weak engine (shown in the warning banner / logged).
    this.downgradeReason = downgradeReason;
  }

  async start(videoElement, onResult) {
    // Lazy-load the pure-JS decoder only when it's actually needed.
    const { default: QrScanner } = await import('qr-scanner');
    this.scanner = new QrScanner(videoElement, (result) => onResult(result.data), {
      preferredCamera: 'environment',
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true
    });
    await this.scanner.start();
  }

  stop() {
    if (this.scanner) {
      this.scanner.stop();
      this.scanner.destroy();
      this.scanner = null;
    }
  }
}

// --- Capability detection + factory -----------------------------------------

async function isNativeQrSupported() {
  if (!('BarcodeDetector' in window) || typeof BarcodeDetector.getSupportedFormats !== 'function') {
    return false;
  }
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code');
  } catch {
    return false;
  }
}

function isWasmSupported() {
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

// zxing-wasm v3 ships a SIMD-only build. WebKit only shipped WASM SIMD in Safari/iOS
// 16.4, and early 16.4.x builds had buggy SIMD — on those, instantiation throws. Detect
// it up front (a 47-byte module that uses a v128 instruction) so we can give a clear
// reason instead of a cryptic CompileError.
function isWasmSimdSupported() {
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
      10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
    ]));
  } catch {
    return false;
  }
}

function describeError(error) {
  if (!error) return 'unknown';
  const name = error.name || 'Error';
  const message = error.message || String(error);
  return `${name}: ${message}`.slice(0, 160);
}

/**
 * Pick and instantiate the best scanning engine the device supports, downgrading
 * gracefully if a higher tier turns out to be unavailable at runtime.
 *
 * @param {{ skipNative?: boolean }} [options] - skipNative excludes the native tier,
 *        used to downgrade after BarcodeDetector fails at runtime.
 * @returns {Promise<{ name: 'native'|'wasm'|'js', start: Function, stop: Function }>}
 */
export async function createScanEngine({ skipNative = false } = {}) {
  // Tier 1 — native BarcodeDetector.
  if (!skipNative && await isNativeQrSupported()) {
    try {
      return new NativeEngine(new BarcodeDetector({ formats: ['qr_code'] }));
    } catch (error) {
      console.warn('BarcodeDetector unavailable, trying WebAssembly scanner:', error);
    }
  }

  // Tier 2 — zxing-wasm. Requires WASM + SIMD; instantiate up front so we only commit to
  // this tier if the module actually loads (SIMD/CSP/network can all fail here).
  let wasmReason = '';
  if (!isWasmSupported()) {
    wasmReason = 'WebAssembly unsupported';
  } else if (!isWasmSimdSupported()) {
    wasmReason = 'WASM SIMD unsupported (needs iOS/Safari 16.4+)';
  } else {
    try {
      await prepareZXingModule({ overrides: ZXING_OVERRIDES, fireImmediately: true });
      return new WasmEngine();
    } catch (error) {
      wasmReason = describeError(error);
    }
  }

  // Tier 3 — pure-JS fallback.
  console.warn('Enhanced (WASM) scanner unavailable, using JS fallback:', wasmReason);
  return new JsEngine(wasmReason);
}
