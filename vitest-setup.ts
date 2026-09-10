import '@testing-library/jest-dom/vitest';

/**
 * `Element.prototype.animate` for jsdom, which implements no part of the Web Animations API.
 *
 * Svelte 5 drives every `transition:` through `element.animate()` — including a dummy
 * zero-duration animation it creates even when the delay is 0, deliberately, so the CSS
 * keyframes are not built until the DOM has updated. So rendering *any* component with a
 * transition throws `TypeError: element.animate is not a function`. `Toasts.svelte` and its
 * `transition:fly` are what surfaced it here.
 *
 * It throws from a microtask rather than from the test body, which is why the suite failed
 * intermittently: a run that finished before the microtask ran reported all tests passing and
 * exit 0, and the next run reported the same tests passing plus one unhandled error and exit 1.
 *
 * Only the four members Svelte actually reads are honoured — see
 * `svelte/src/internal/client/dom/elements/transitions.js`:
 *
 *   `onfinish`   assigned immediately after the call, and it has to FIRE. `on_begin()` and
 *                `on_finish()` hang off it, so a stub that never finishes leaves an outro
 *                permanently mid-flight and the element never leaves the DOM.
 *   `cancel()`   called both when the dummy animation finishes and when a transition aborts.
 *   `playState`  read by the tick loop, which keeps running only while it is `'running'`.
 *                Reporting `'finished'` ends that loop instead of driving frames in a test.
 *   `effect`     set to null on abort, to release memory in Chromium.
 *
 * A real Animation is not worth emulating further: if a future Svelte reaches for `finished`,
 * `currentTime` or `pause()`, the failure will name the member and this is where to add it.
 */
// Conditional so a future jsdom that implements the API keeps its own version; not guarded on
// `Element` itself, which always exists here — this file is loaded by the jsdom project alone,
// and its jest-dom import above would not survive a node environment either.
if (typeof Element.prototype.animate !== 'function') {
  class StubAnimation {
    onfinish: (() => void) | null = null;
    effect: object | null = null;
    /** Never `'running'`: the tick loop should stop rather than animate frames under a test. */
    playState = 'finished';

    #cancelled = false;

    constructor() {
      // A microtask, not a synchronous call: `onfinish` is assigned *after* `animate()` returns,
      // so firing during construction would find nothing attached and the transition would hang.
      queueMicrotask(() => {
        if (!this.#cancelled) this.onfinish?.();
      });
    }

    cancel(): void {
      // Svelte cancels and then reassigns `onfinish` to a no-op, because a real browser can fire
      // it after `cancel()`. Suppressing it here matches what that guard is defending against.
      this.#cancelled = true;
      this.playState = 'idle';
    }
  }

  Element.prototype.animate = function animate(): Animation {
    return new StubAnimation() as unknown as Animation;
  };
}
