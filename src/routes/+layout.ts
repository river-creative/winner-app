/**
 * The whole app is a single-page app served by Express out of `dist/`.
 *
 * `ssr = false` is set once, here, and inherited by every route. Almost every screen depends on
 * a browser-only API — BarcodeDetector, getUserMedia, AudioContext, Fullscreen, canvas,
 * localStorage — so server rendering would buy nothing and cost a class of hydration bugs.
 *
 * `prerender = false` plus the adapter's `fallback` makes `dist/index.html` the shell for every
 * route, which is exactly what backend/server.ts already serves.
 */
export const ssr = false;
export const prerender = false;
