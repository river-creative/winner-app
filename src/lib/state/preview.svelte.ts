import { playSound } from '$lib/services/sounds';
import type { DelayVisualType } from '$lib/types';
import { boot } from './boot.svelte';
import { settings } from './settings.svelte';

/**
 * The Setup screen's Preview and Test buttons.
 *
 * They drive the same overlays a real draw does, so what an operator previews is what the room
 * will see. In the old app these were three separate ad-hoc code paths that reached into the
 * DOM by id; two of them had drifted from what the draw actually did.
 */
class PreviewStore {
  #delayVisual = $state<DelayVisualType | null>(null);
  #progress = $state(0);
  #remaining = $state(0);
  /** Bumped to ask the celebration canvas to fire. */
  #celebrationToken = $state(0);

  get delayVisual(): DelayVisualType | null {
    return this.#delayVisual;
  }
  get progress(): number {
    return this.#progress;
  }
  get remaining(): number {
    return this.#remaining;
  }
  get celebrationToken(): number {
    return this.#celebrationToken;
  }

  /** Run the configured delay visual for its configured duration, with its configured sound. */
  async runDelay(): Promise<void> {
    if (this.#delayVisual) return;

    const seconds = settings.current.preSelectionDelay > 0 ? settings.current.preSelectionDelay : 3;
    const visual =
      settings.current.delayVisualType === 'none' ? 'countdown' : settings.current.delayVisualType;

    this.#delayVisual = visual;

    const duringSound = settings.current.soundDuringDelay;
    if (duringSound && duringSound !== 'none') void playSound(duringSound, boot.sounds);

    const totalMs = seconds * 1000;
    const startedAt = performance.now();

    await new Promise<void>((resolve) => {
      const step = () => {
        const elapsed = performance.now() - startedAt;
        this.#progress = Math.min(1, elapsed / totalMs);
        this.#remaining = Math.max(0, (totalMs - elapsed) / 1000);
        if (elapsed >= totalMs) {
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    this.#delayVisual = null;
    this.#progress = 0;
    this.#remaining = 0;
  }

  celebrate(): void {
    this.#celebrationToken += 1;
  }

  async testSound(soundId: string): Promise<void> {
    await playSound(soundId, boot.sounds);
  }
}

export const preview = new PreviewStore();
