/**
 * Browser APIs the scanner depends on that TypeScript's DOM library does not declare.
 *
 * Both are shipped, widely-used APIs — they are simply not in `lib.dom` — so declaring them
 * here is what lets `scan-engines.ts` stay free of casts and keep `noImplicitAny` honest.
 *
 * This file is a global script (no import/export), so the two `interface` blocks below merge
 * with the ones `lib.dom` already declares.
 */

/** One symbol found by the Barcode Detection API. Only `rawValue` is read. */
interface DetectedBarcode {
  readonly boundingBox: DOMRectReadOnly;
  readonly cornerPoints: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly format: string;
  readonly rawValue: string;
}

/**
 * The Barcode Detection API — hardware/ML accelerated, and the best tier in low light where it
 * works (Android Chrome/Edge).
 *
 * Its mere presence proves nothing: iOS 18+ and Chrome/macOS Ventura < 113 expose it, report
 * `qr_code` support and then return empty results forever. `scan-engines.ts` decodes a known
 * code through it before committing to this tier.
 */
declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  static getSupportedFormats(): Promise<string[]>;
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface MediaTrackConstraintSet {
  /**
   * MediaStream Image Capture extension. Implemented on most phone cameras and the reason
   * low-light QR frames come back sharp, but absent from `lib.dom`; applying it is best-effort.
   */
  focusMode?: ConstrainDOMString;
}
