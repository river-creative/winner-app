# WASM Scanner Upgrade — Implementation Plan

## 1. Requirement (as understood)

The prize-pickup QR scanner uses Nimiq's `qr-scanner` library, which is **pure
JavaScript** (a JS port of ZXing) and decodes poorly in dark/low-light
environments. Replace it with a **WASM-based scanner** that decodes far better in
poor lighting, while **keeping the existing JS scanner as a fallback** and showing
a **warning banner** when the device cannot run the better scanner.

### Decisions confirmed with user
- **Target frontend:** Production **Alpine** app only — `scan.html` +
  `scan/scanner.js`. (This is what Docker builds into `dist/` and `backend/server.ts`
  serves. The Svelte route `svelte/src/routes/scan/+page.svelte` is a WIP migration
  not yet wired into deploy and is **out of scope**.)
- **WASM engine:** `zxing-wasm` (Sec-ant) — ZXing-C++ compiled to WASM. Mature:
  ~3.9M downloads/month, stable **v3.1.0**, MIT. (Chosen over the `@agicash/qr-scanner`
  drop-in fork, which is immature: v0.1.2, ~312 downloads/month.)
- **Low-light extras included:** Native `BarcodeDetector` top tier + improved camera
  constraints. **Torch toggle NOT included** (per user choice).

## 2. Engine strategy — tiered progressive enhancement

QR-only scanning (ticket codes: `[A-Za-z0-9]{8,24}` or `A-369008`). At scanner
start, pick the best engine the device supports:

| Tier | Engine | When used | Low-light quality |
|------|--------|-----------|-------------------|
| 1 | **Native `BarcodeDetector`** (`qr_code`) | Supported (Android Chrome/Edge) | Best — hardware/ML accelerated |
| 2 | **`zxing-wasm`** (`tryHarder`, `tryInvert`) | WASM works but no BarcodeDetector (iOS Safari, Firefox, etc.) | Strong — robust C++ binarizer |
| 3 | **Nimiq `qr-scanner`** (current JS) | Neither available, or WASM fails to load | Weak (current behavior) |

**Warning banner shows only when Tier 3 (JS fallback) is the active engine** — i.e.
the device genuinely cannot run an enhanced scanner. This is the honest mapping of
"the phone does not support the better scanner."

> **Concern voiced & resolved:** WebAssembly is supported on ~100% of phones in use
> (incl. iOS Safari since 2017), so Tier 2 covers virtually every device. The banner
> is therefore a true rare-edge safety net (very old / locked-down browsers, or a
> failed WASM load), **not** something most users will ever see. We deliberately do
> **not** warn iOS users (who get the good Tier-2 WASM engine) to avoid alarm fatigue.

## 3. Components to create / modify

### NEW — `scan/scan-engines.js` (framework-agnostic scanner engines)
Encapsulates camera handling + per-tier decode loops. Exposes a single factory the
app calls; the rest of the app is engine-agnostic.

- `VIDEO_CONSTRAINTS` — `facingMode: environment`, `width/height ideal 1920×1080`;
  after stream start, best-effort `applyConstraints({ advanced:[{ focusMode:'continuous' }]})`
  (wrapped in try/catch — support varies). *(the "better camera constraints" extra)*
- `CameraController` — shared `getUserMedia` + attach to `<video>` + stop, used by
  Tier 1 and Tier 2.
- Shared rAF/throttled decode loop driven by an injected async `decode()` returning
  `string | null`:
  - **Tier 1 decode:** `await detector.detect(video)` → `codes[0]?.rawValue`.
  - **Tier 2 decode:** draw current frame to an offscreen canvas (longer edge capped
    ~1000px for speed), `getImageData`, `readBarcodes(imageData, { formats:['QRCode'],
    tryHarder:true, tryInvert:true })` → `res?.text`. Throttled to ~8 fps, with an
    **adaptive "skip-if-busy" guard** (never schedule a new decode while the previous
    `readBarcodes` promise is still pending) so the main thread never backlogs/janks —
    this is the no-jank safeguard in lieu of a Web Worker (Tier-2 main-thread decode of
    a ~1000px frame is only a few ms; a worker can be added later if profiling shows need).
- `JsEngine` (Tier 3) — **lazy-imports** Nimiq `qr-scanner` only when actually needed;
  uses the library's own camera with `preferredCamera:'environment'`.
- `detectBestEngine()` — feature-detect order: `BarcodeDetector` (+ `getSupportedFormats`
  includes `qr_code`) → WASM (`typeof WebAssembly === 'object'` + module load succeeds)
  → JS.
- `createScanEngine()` — instantiate the best engine; if the WASM module fails to load
  at runtime, **gracefully downgrade** to Tier 3 and report it.
- zxing-wasm WASM binary is **self-hosted** (bundled via Vite `?url` import +
  `prepareZXingModule({ overrides:{ locateFile } })`) so the scanner works on flaky
  venue wifi / offline. No runtime CDN dependency.

> **No-assumptions gate (per /best, /adhere):** before writing the loader, inspect the
> installed `node_modules/zxing-wasm` `package.json` `exports` + `dist/` listing to
> confirm the exact v3 API (`prepareZXingModule`, `readBarcodes`, `ReadResult.text`)
> and the real wasm asset subpath / `?url` resolvability. No API detail is assumed.

### MODIFY — `scan/scanner.js`
- Remove the hard-coded CDN `import QrScanner from 'https://unpkg.com/...'`.
- `startScanning()`: `await createScanEngine()`, store active engine, start it with an
  `onResult` callback; expose selected engine via new `onEngineSelected` callback.
- Add **dedupe/debounce** of decoded values (ignore same code within ~1.5s; pause while
  a lookup is in flight) since loop engines emit continuously. Keep the existing
  `WinnerSearch.isTicketCode` validation: valid → stop + look up; invalid → keep
  scanning (no more `setTimeout` restart hack).
- `stopScanning()`: delegate to the active engine's `stop()`.

### MODIFY — `scan/scan-app.js`
- Wire `Scanner.onEngineSelected = (engine) => store.scannerEngine = engine;`.

### MODIFY — `scan.html`
- Remove the redundant/dead `<script type=module src=unpkg qr-scanner>` tag (the module
  is imported in JS, not used globally).
- Add Alpine store field `scannerEngine: ''`.
- Add a **warning banner** in the scanner view, shown via
  `x-show="$store.scan.scannerEngine === 'js'"` with `x-transition` (matching existing
  transitions). **Reuse the existing alert pattern already in `scan.html`** — Bootstrap
  `class="alert alert-warning"` + a `bi-exclamation-triangle` icon (mirrors the
  `alert alert-info` block at the family-search header). Text: *"This device doesn't
  support the enhanced scanner. Using the basic scanner — low-light scanning may be
  limited."* **Accessibility:** `role="status"` + `aria-live="polite"` so it's announced
  without hijacking focus.
- Append a subtle engine label to `scanStatus` for operator clarity (e.g.
  "Scanning… (enhanced)" / "(basic)").

### Loading / feedback states (per /design)
- On first start, fetching the ~1.3 MB `.wasm` takes a moment: set `scanStatus` to
  "Starting camera…" and keep the Start button disabled until the engine is ready, so
  there's clear loading feedback (no dead air). Success → "Scanning…"; permission
  denied / no camera → existing error toast + status (unchanged).

### MODIFY — `package.json`
- Add `zxing-wasm` (and move `qr-scanner` to a real dependency) so Vite bundles them.
  *(Deviation from the existing CDN-for-frontend pattern — justified for WASM
  self-hosting, version pinning, and offline robustness at venues.)*

### NO CHANGES NEEDED
- `backend/middleware.ts` CSP already permits WASM: `script-src … 'unsafe-eval' blob:`,
  `worker-src 'self' blob:`, `connect-src 'self' https:`. Verified.
- `backend/server.ts`, Dockerfile — `dist/` build flow already serves bundled assets +
  the emitted `.wasm`.

## 4. Impact on existing functionality
- Manual search, family lookup, winner display, pickup marking, operator/theme — all
  untouched (only the camera→decode path changes).
- Decode callback contract to `handleScanResult` is preserved (still a raw string).
- Fallback path preserves today's exact behavior for unsupported devices.

## 5. Edge cases / trade-offs
- **WASM load failure** → graceful downgrade to JS + banner.
- **Continuous decoders** (Tier 1/2 emit repeatedly) → dedupe/debounce + pause-on-lookup.
- **iOS** → no BarcodeDetector/torch; gets Tier 2 WASM (good) — no banner.
- **Decode resolution** capped (~1000px longer edge) to balance CPU vs low-light detail;
  tunable. Main-thread decode at ~8 fps (worker can be added later if jank appears).
- **Camera permission denied / no camera** → surfaced via existing toast + status.

## 6. Verification
- `npm run build` (Vite) succeeds; `.wasm` emitted to `dist/assets/` and self-host URL
  resolves.
- Manual: scanner starts, decodes a QR in normal + dim light; confirm Tier reported;
  simulate fallback; confirm banner; confirm manual search unaffected.

## 7. Originating user prompt
> "The scanner app uses a js scanner which is very weak. Update to a good wasm scanner
> that can scan in darker environments and keep the js version as fallback with a warn
> banner that the phone does not support the better scanner /implement"
