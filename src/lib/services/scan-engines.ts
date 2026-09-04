/**
 * Framework-agnostic QR scanning with tiered progressive enhancement.
 *
 * Tier 1: native BarcodeDetector — hardware/ML accelerated, best in low light
 *         (Android Chrome/Edge).
 * Tier 2: zxing-wasm — ZXing-C++ compiled to WebAssembly, a far more robust binarizer
 *         than the pure-JS decoder in poor lighting. Used on iOS Safari, Firefox and
 *         anywhere WebAssembly runs but BarcodeDetector is missing (i.e. most phones).
 * Tier 3: Nimiq qr-scanner — the original pure-JS decoder, kept as a last-resort
 *         fallback (lazy-loaded) for the rare device that supports neither of the above.
 *
 * `createScanEngine()` picks the best available tier at runtime and gracefully downgrades if a
 * higher tier turns out to be unavailable (e.g. the wasm module fails to load).
 *
 * Nothing in here touches Svelte: it owns a camera and a decode loop, and reports values through
 * callbacks. The reactive half lives in `$lib/state/scanner.svelte.ts`.
 */

import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
// Self-hosted wasm asset emitted by the bundler — no runtime CDN dependency, so the
// scanner keeps working on flaky venue wifi / offline.
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
// Type only — the module itself is imported dynamically inside JsEngine so the ~30 kB decoder
// never reaches a device that has a better tier available.
import type QrScannerInstance from 'qr-scanner';

/** Which tier is actually running. Surfaced so the UI can warn about the weak one. */
export type ScanEngineName = 'native' | 'wasm' | 'js';

export interface ScanEngine {
  readonly name: ScanEngineName;
  /** Why a weaker tier was chosen. Empty on the two enhanced tiers. */
  readonly downgradeReason: string;
  start(
    videoElement: HTMLVideoElement,
    onResult: (value: string) => void,
    onFatal: (error: unknown) => void
  ): Promise<void>;
  stop(): void;
}

export interface CreateScanEngineOptions {
  /** Excludes the native tier, used to downgrade after BarcodeDetector fails at runtime. */
  skipNative?: boolean;
}

// Resolve the wasm to an absolute URL. Emscripten's loader fetches relative to the
// document, not this module, so resolving against import.meta.url keeps it correct under
// relative ('./') base paths and sub-path deployments (e.g. /win/).
const ZXING_WASM_URL = new URL(zxingReaderWasmUrl, import.meta.url).href;
const ZXING_OVERRIDES = {
  locateFile: (path: string, prefix: string): string =>
    path.endsWith('.wasm') ? ZXING_WASM_URL : prefix + path
};

// --- Tuning constants -------------------------------------------------------

// Camera constraints tuned for low-light QR capture: rear camera and high resolution
// (the browser downscales if unavailable). Continuous focus is applied post-start.
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1920 },
  height: { ideal: 1080 }
};

// zxing-wasm reader options. In v3 tryHarder/tryInvert/tryRotate/tryDownscale all default
// to true (exactly what we want for poor lighting); we only narrow the search to QR codes
// and a single symbol for speed.
const READER_OPTIONS: ReaderOptions = {
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
  #stream: MediaStream | null = null;

  async open(videoElement: HTMLVideoElement): Promise<void> {
    this.#stream = await navigator.mediaDevices.getUserMedia({
      video: VIDEO_CONSTRAINTS,
      audio: false
    });
    videoElement.srcObject = this.#stream;
    videoElement.setAttribute('playsinline', 'true'); // required for inline playback on iOS

    // The scanner starts as soon as the page mounts, so on a direct hit to /scan there is no
    // user gesture. Chrome's autoplay policy rejects play() on an unmuted element without one —
    // even for a stream that carries no audio track at all. We request audio: false, so muting
    // changes nothing except removing that dependency.
    videoElement.muted = true;

    await videoElement.play();

    // Best-effort continuous autofocus for sharper frames in poor light. Support varies
    // across devices, so failure here is non-fatal.
    const [track] = this.#stream.getVideoTracks();
    try {
      await track?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch {
      /* focusMode unsupported on this device — ignore */
    }
  }

  close(videoElement: HTMLVideoElement | null): void {
    if (this.#stream) {
      for (const track of this.#stream.getTracks()) track.stop();
      this.#stream = null;
    }
    if (videoElement) videoElement.srcObject = null;
  }
}

// --- Frame-loop engines (Tier 1 & 2) ----------------------------------------

/**
 * Owns the camera and a self-throttling decode loop.
 *
 * Each tick awaits the previous decode before scheduling the next, so decodes never overlap —
 * no main-thread backlog and no jank.
 */
abstract class FrameLoopEngine implements ScanEngine {
  abstract readonly name: ScanEngineName;
  readonly downgradeReason = '';

  readonly #intervalMs: number;
  readonly #camera = new CameraController();
  protected videoElement: HTMLVideoElement | null = null;
  #onResult: ((value: string) => void) | null = null;
  #onFatal: ((error: unknown) => void) | null = null;
  #running = false;
  #timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(intervalMs: number) {
    this.#intervalMs = intervalMs;
  }

  async start(
    videoElement: HTMLVideoElement,
    onResult: (value: string) => void,
    onFatal: (error: unknown) => void
  ): Promise<void> {
    this.videoElement = videoElement;
    this.#onResult = onResult;
    this.#onFatal = onFatal;
    this.#running = true;
    await this.#camera.open(videoElement);

    // stop() may have run while getUserMedia was in flight. It could not release a stream
    // that did not exist yet, so release it here — otherwise the camera stays live with
    // nothing referencing it, and the indicator light never goes out.
    if (!this.#running) {
      this.#camera.close(videoElement);
      return;
    }

    this.#scheduleNext(0);
  }

  stop(): void {
    this.#running = false;
    if (this.#timerId) {
      clearTimeout(this.#timerId);
      this.#timerId = null;
    }
    this.#camera.close(this.videoElement);
  }

  #scheduleNext(delay: number): void {
    if (!this.#running) return;
    this.#timerId = setTimeout(() => void this.#tick(), delay);
  }

  async #tick(): Promise<void> {
    if (!this.#running) return;
    try {
      const value = await this.decodeFrame();
      if (!this.#running) return;
      if (value) this.#onResult?.(value);
    } catch (error) {
      if (!this.#running) return;
      // A fatal error means this engine can't decode on this device (e.g. the native
      // barcode service is unavailable) — stop and let the caller downgrade a tier.
      if (this.isFatalError(error)) {
        this.#running = false;
        this.#camera.close(this.videoElement);
        this.#onFatal?.(error);
        return;
      }
      // Otherwise transient (e.g. video not yet ready) — keep scanning.
    }
    this.#scheduleNext(this.#intervalMs);
  }

  protected abstract decodeFrame(): Promise<string | null>;

  /** Subclasses override to flag errors that should trigger a downgrade rather than a retry. */
  protected isFatalError(_error: unknown): boolean {
    return false;
  }
}

class NativeEngine extends FrameLoopEngine {
  override readonly name = 'native';
  readonly #detector: BarcodeDetector;

  constructor(detector: BarcodeDetector) {
    super(NATIVE_DECODE_INTERVAL_MS);
    this.#detector = detector;
  }

  protected override async decodeFrame(): Promise<string | null> {
    if (!this.videoElement) return null;
    const codes = await this.#detector.detect(this.videoElement);
    return codes[0]?.rawValue ?? null;
  }

  // Some Android devices advertise qr_code support yet throw on every detect() call
  // because the underlying ML/barcode service isn't available. Treat that as fatal so
  // the scanner downgrades to the WebAssembly tier instead of running blind.
  protected override isFatalError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return /not implemented|service unavailable|unsupported|not supported/.test(message);
  }
}

class WasmEngine extends FrameLoopEngine {
  override readonly name = 'wasm';
  readonly #canvas = document.createElement('canvas');
  readonly #ctx: CanvasRenderingContext2D;

  constructor() {
    super(WASM_DECODE_INTERVAL_MS);
    const ctx = this.#canvas.getContext('2d', { willReadFrequently: true });
    // Fail fast: a null 2D context means every decode would silently return nothing, which is
    // exactly the blind-scanner failure the tier selection below goes to such lengths to avoid.
    if (!ctx) throw new Error('Could not create a 2D canvas context for the WebAssembly scanner');
    this.#ctx = ctx;
  }

  protected override async decodeFrame(): Promise<string | null> {
    const video = this.videoElement;
    if (!video) return null;

    const { videoWidth: vw, videoHeight: vh } = video;
    if (!vw || !vh) return null;

    // Downscale large frames to keep decoding fast while preserving enough detail.
    const scale = Math.min(1, WASM_MAX_DECODE_EDGE / Math.max(vw, vh));
    const width = Math.round(vw * scale);
    const height = Math.round(vh * scale);
    if (this.#canvas.width !== width) this.#canvas.width = width;
    if (this.#canvas.height !== height) this.#canvas.height = height;

    this.#ctx.drawImage(video, 0, 0, width, height);
    const imageData = this.#ctx.getImageData(0, 0, width, height);
    const results = await readBarcodes(imageData, READER_OPTIONS);
    const hit = results.find((result) => result.isValid && result.text);
    return hit ? hit.text : null;
  }
}

// --- JS fallback engine (Tier 3) --------------------------------------------

class JsEngine implements ScanEngine {
  readonly name = 'js';
  readonly downgradeReason: string;
  #scanner: QrScannerInstance | null = null;

  /** @param downgradeReason why we fell back to this weak engine (banner text / logged). */
  constructor(downgradeReason = '') {
    this.downgradeReason = downgradeReason;
  }

  async start(videoElement: HTMLVideoElement, onResult: (value: string) => void): Promise<void> {
    // Lazy-load the pure-JS decoder only when it's actually needed.
    const { default: QrScanner } = await import('qr-scanner');
    this.#scanner = new QrScanner(videoElement, (result) => onResult(result.data), {
      preferredCamera: 'environment',
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true
    });
    await this.#scanner.start();
  }

  stop(): void {
    if (this.#scanner) {
      this.#scanner.stop();
      this.#scanner.destroy();
      this.#scanner = null;
    }
  }
}

// --- Capability detection + factory -----------------------------------------

// A 116x116 PNG of a QR encoding SELF_TEST_VALUE, decode-verified against two independent
// decoders (jsQR and this very zxing-wasm build) before being inlined here.
//
// Why it exists: on iOS 18+ (WebKit bug 281848, still open) and on Chrome/macOS Ventura
// before 113, BarcodeDetector exists, reports qr_code support, and then *silently returns
// empty results forever* rather than throwing. isFatalError() above only catches detectors
// that throw, so such a device would select the native tier, bring the camera up, look
// perfectly healthy — and never scan anything. Decoding a code we know is there is the only
// way to tell a working detector from a blind one.
const SELF_TEST_VALUE = 'RMI-SCAN-OK';
const SELF_TEST_QR_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHQAAAB0CAYAAABUmhYnAAAAAklEQVR4AewaftIAAAKrSURBVO3BQW7gSAwEwSxC//9yro88NSBI8o4JRsQfrDGKNUqxRinWKMUapVijFGuUYo1SrFGKNUqxRinWKMUapVijFGuUYo1y8VASfpNKl4QnVE6S8JtUnijWKMUapVijXLxM5U1J+FISOpUTlTcl4U3FGqVYoxRrlIuPJeEOlTepfCkJd6h8qVijFGuUYo1y8cepdEnoktCpTFasUYo1SrFGufjjkvBEEjqVv6xYoxRrlGKNcvExlS+p3JGEN6n8S4o1SrFGKdYoFy9Lwm9KQqfSJaFT6ZJwRxL+ZcUapVijFGuU+INBktCpdEk4UfnLijVKsUYp1igXDyWhUzlJwpdUuiR0Kl0SuiR0KidJ6FS6JNyh8kSxRinWKMUa5eJlSehUOpUuCScqdyThCZUuCXck4f9UrFGKNUqxRrn4WBI6lU7lJAlPqJyo3KFykoROpUvCl4o1SrFGKdYoFw+p3JGETqVLQqfSJaFT6ZJwkoRO5USlS8KbVN5UrFGKNUqxRrl4KAmdyh1J6FS6JDyRhE7lJAknKidJOFH5UrFGKdYoxRol/uAPS8KbVJ5IwhMqTxRrlGKNUqxRLh5Kwm9SOVHpktCpdEnoknCi0iXhROUkCW8q1ijFGqVYo1y8TOVNSbgjCSdJuEOlS0KncpKE31SsUYo1SrFGufhYEu5QeULlJAknKl0SOpUuCZ1Kp9Il4UvFGqVYoxRrlIvhkvCEyptUvlSsUYo1SrFGufjjVE5UnkhCp9KpdEnoVLoknKg8UaxRijVKsUa5+JjKb0rCicpJEu5IQqfSJeFE5U3FGqVYoxRrlIuXJeE3JeGOJHQqncodKv+SYo1SrFGKNUr8wRqjWKMUa5RijVKsUYo1SrFGKdYoxRqlWKMUa5RijVKsUYo1SrFGKdYo/wEcAvr4sBmb6wAAAABJRU5ErkJggg==';
const SELF_TEST_TIMEOUT_MS = 1500;

let selfTestImagePromise: Promise<HTMLImageElement> | null = null;

function loadSelfTestImage(): Promise<HTMLImageElement> {
  selfTestImagePromise ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      selfTestImagePromise = null;
      reject(new Error('self-test QR image failed to decode'));
    };
    image.src = SELF_TEST_QR_PNG;
  });
  return selfTestImagePromise;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/**
 * Prove the detector can decode a code we know is in the image.
 *
 * A detector that hangs must not hang the camera start, hence the timeout.
 */
async function detectorDecodesKnownCode(detector: BarcodeDetector): Promise<boolean> {
  const attempt = loadSelfTestImage()
    .then((image) => detector.detect(image))
    .then((codes) => codes.some((code) => code.rawValue === SELF_TEST_VALUE));

  return withTimeout(attempt, SELF_TEST_TIMEOUT_MS).catch(() => false);
}

async function isNativeQrSupported(): Promise<boolean> {
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

function isWasmSupported(): boolean {
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

/**
 * zxing-wasm v3 ships a SIMD-only build.
 *
 * WebKit only shipped WASM SIMD in Safari/iOS 16.4, and early 16.4.x builds had buggy SIMD — on
 * those, instantiation throws. Detect it up front (a 47-byte module that uses a v128
 * instruction) so we can give a clear reason instead of a cryptic CompileError.
 */
function isWasmSimdSupported(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253,
        98, 11
      ])
    );
  } catch {
    return false;
  }
}

function describeError(error: unknown): string {
  if (!error) return 'unknown';
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 160);
  return String(error).slice(0, 160);
}

/**
 * Pick and instantiate the best scanning engine the device supports, downgrading gracefully if a
 * higher tier turns out to be unavailable at runtime.
 */
export async function createScanEngine({
  skipNative = false
}: CreateScanEngineOptions = {}): Promise<ScanEngine> {
  // Tier 1 — native BarcodeDetector. Advertised support is not enough: it must actually
  // decode (see SELF_TEST_QR_PNG), or a silently-blind detector would be selected and the
  // scanner would never scan.
  if (!skipNative && (await isNativeQrSupported())) {
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });

      if (await detectorDecodesKnownCode(detector)) {
        return new NativeEngine(detector);
      }

      console.warn(
        'BarcodeDetector reports qr_code support but cannot decode a known code (a silent failure seen on iOS 18+ and Chrome/macOS Ventura < 113). Skipping the native scanner.'
      );
    } catch (error) {
      console.warn('BarcodeDetector unavailable, trying WebAssembly scanner:', error);
    }
  }

  // Tier 2 — zxing-wasm. Requires WASM + SIMD; instantiate up front so we only commit to
  // this tier if the module actually loads (SIMD/CSP/network can all fail here).
  // Assigned on every path that reaches the fallback below; the tier-2 success path returns.
  let wasmReason: string;
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
