import { browser } from '$app/environment';

/**
 * `prefers-reduced-motion`, as reactive state.
 *
 * The public display is the one screen where this genuinely matters: the reveal effects, the
 * pulsing countdown and the confetti are all motion the viewer never asked for. Three components
 * need the answer and all three need it to be *reactive* — a value read once at mount goes stale
 * the moment the operating system setting is changed on the machine driving the projector.
 *
 * The listener is attached once, at module load, and never removed. That is deliberate: this is
 * a page-lifetime singleton with no effect root to tear it down from, and the alternative — an
 * `$effect` in whichever component happened to mount first — would silently stop updating the
 * others when that component unmounted.
 */
class ReducedMotionStore {
  #matches = $state(false);

  constructor() {
    if (!browser || typeof matchMedia !== 'function') return;

    const query = matchMedia('(prefers-reduced-motion: reduce)');
    this.#matches = query.matches;
    query.addEventListener('change', (event) => {
      this.#matches = event.matches;
    });
  }

  get matches(): boolean {
    return this.#matches;
  }
}

export const reducedMotion = new ReducedMotionStore();
