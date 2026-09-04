import * as api from '$lib/api/client';
import { loadSounds } from '$lib/services/sounds';
import type { SoundOption } from '$lib/services/sounds';
import { defaultTemplateSeed } from '$lib/services/templates';
import { data } from './data.svelte';
import { draw } from './draw.svelte';
import { session } from './session.svelte';
import { settings } from './settings.svelte';

/**
 * Everything the app needs before a screen can be trusted, run exactly once per page load.
 *
 * Memoised on the promise rather than a boolean, so two layouts mounting at the same time share
 * one boot instead of racing two. The old app polled every 50 ms for its framework to appear and
 * then fired the same loads from three places.
 */
let booting: Promise<void> | null = null;

class BootState {
  #ready = $state(false);
  #sounds = $state<SoundOption[]>([]);

  get ready(): boolean {
    return this.#ready;
  }

  get sounds(): SoundOption[] {
    return this.#sounds;
  }

  markReady(sounds: SoundOption[]): void {
    this.#sounds = sounds;
    this.#ready = true;
  }

  setSounds(sounds: SoundOption[]): void {
    this.#sounds = sounds;
  }
}

export const boot = new BootState();

export function ensureBooted(): Promise<void> {
  booting ??= run();
  return booting;
}

async function run(): Promise<void> {
  // Settings first: the theme, the display ratio and the duplicate rules all gate what the rest
  // renders, and reading them from cache is instant.
  await settings.load();

  const sounds = await loadSounds(fetchUploadedSounds);
  draw.setSounds(sounds);

  await Promise.all([
    session.load(),
    // `data` records its own error and every screen renders it; boot must still finish so the
    // shell, the nav and the retry button are reachable.
    data.loadAll().catch(() => undefined)
  ]);

  await seedDefaultTemplate();

  boot.markReady(sounds);
}

/**
 * Make sure there is a default SMS template.
 *
 * The legacy app did this when the Templates tab first opened, so an operator who never visited
 * that tab had no default — and the SMS sender falls back to exactly that, refusing to send with
 * "No SMS templates found" on a fresh install. Doing it at boot removes the ordering dependency.
 *
 * The seed id is stable, so this cannot duplicate itself; a failure is left silent because a
 * missing template is reported clearly at the point of sending, and boot must not be blocked.
 */
async function seedDefaultTemplate(): Promise<void> {
  if (data.error || data.templates.length > 0) return;

  const seed = defaultTemplateSeed();
  try {
    await api.save('templates', seed);
    data.upsertTemplate(seed);
  } catch {
    /* the Templates screen and the SMS sender both surface the absence themselves */
  }
}

/**
 * Re-read the sound list after an upload or a delete.
 *
 * Both the pickers on Setup and the draw itself read their sounds from here, so refreshing one
 * place is what keeps a freshly uploaded file selectable and a deleted one unreachable.
 */
export async function refreshSounds(): Promise<void> {
  const sounds = await loadSounds(fetchUploadedSounds);
  boot.setSounds(sounds);
  draw.setSounds(sounds);
}

/**
 * Sound files an operator uploaded, from the persisted volume.
 *
 * Kept out of `sounds.ts` so that module stays free of the API client and can be unit-tested
 * without one.
 */
async function fetchUploadedSounds(): Promise<Array<{ filename: string; url: string }>> {
  const files = await api.getUploadedSounds();
  return files.map((file) => ({ filename: file.filename, url: api.uploadUrl(file.filename) }));
}
