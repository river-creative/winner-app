import { base } from '$app/paths';

/**
 * Sound playback for the draw.
 *
 * Two fixes over the module this replaces: one `AudioContext` for the life of the page instead
 * of a new one per beep (browsers cap how many a document may create, and the old code never
 * closed any), and a single `Audio` element that is genuinely stopped before the next sound
 * starts rather than left playing under it.
 */

export interface SoundOption {
  id: string;
  name: string;
  /** Relative to the served root, so it works under any mount. */
  url: string;
  source: 'built-in' | 'uploaded';
}

/** The six files shipped in `public/sounds`. Ids are the values stored in settings. */
export const BUILT_IN_SOUNDS: SoundOption[] = [
  { id: 'drum-roll', name: 'Drum Roll', url: 'sounds/drum-roll.mp3', source: 'built-in' },
  { id: 'applause', name: 'Applause', url: 'sounds/applause.mp3', source: 'built-in' },
  {
    id: 'applause-winner',
    name: 'Applause Winner',
    url: 'sounds/applause-winner.mp3',
    source: 'built-in'
  },
  {
    id: 'electronic-build-up',
    name: 'Electronic Build-up',
    url: 'sounds/electronic_build-up.mp3',
    source: 'built-in'
  },
  {
    id: 'sting-rimshot-drum-roll',
    name: 'Sting Rimshot',
    url: 'sounds/sting-rimshot-drum-roll.mp3',
    source: 'built-in'
  },
  { id: 'tada-fanfare', name: 'Tada Fanfare', url: 'sounds/tada-fanfare.mp3', source: 'built-in' }
];

const VOLUME = 0.7;

let currentAudio: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;

function assetUrl(url: string): string {
  return `${base}/${url}`.replace(/([^:]\/)\/+/g, '$1');
}

/** Stop whatever is playing. Safe to call when nothing is. */
export function stopSound(): void {
  if (!currentAudio) return;
  currentAudio.pause();
  currentAudio.currentTime = 0;
  currentAudio = null;
}

/**
 * Play one sound by id. Unknown ids and `'none'` are no-ops, so a setting pointing at a sound
 * file that has since been removed silently does nothing rather than throwing mid-draw.
 */
export async function playSound(soundId: string, sounds: SoundOption[]): Promise<void> {
  if (!soundId || soundId === 'none') return;

  const sound = sounds.find((candidate) => candidate.id === soundId);
  if (!sound) return;

  stopSound();

  const audio = new Audio(assetUrl(sound.url));
  audio.volume = VOLUME;
  currentAudio = audio;

  try {
    await audio.play();
  } catch {
    // Autoplay policy, or a missing file. Neither is worth interrupting a live draw for.
    if (currentAudio === audio) currentAudio = null;
  }
}

/** The short tick the countdown uses. One shared context, created on first use. */
export function playBeep(frequency = 800, durationMs = 100): void {
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume();

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + durationMs / 1000);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + durationMs / 1000);
  } catch {
    /* no audio device, or a context the browser refused to create */
  }
}

/**
 * What to call an uploaded sound in the pickers.
 *
 * The server stores uploads as `sound-<timestamp>-<original name>.mp3` so two files of the same
 * name cannot collide. That prefix is storage bookkeeping, and showing it put
 * "sound-1788707882985-walkthrough-tone" in three dropdowns where the operator had uploaded
 * "walkthrough-tone.mp3". Stripping it back to the name they chose matches what the Alpine app
 * stored, which was the filename minus its extension.
 */
export function uploadedSoundName(filename: string): string {
  return filename.replace(/^sound-\d+-/, '').replace(/\.[^.]+$/, '');
}

/**
 * Fetch the sounds an operator has uploaded, and merge them with the built-ins.
 *
 * Uploads live in `data/uploads`, which is the persisted volume, so they survive a deploy —
 * unlike `public/sounds`, which is baked into the container image.
 */
export async function loadSounds(
  fetchUploaded: () => Promise<Array<{ filename: string; url: string }>>
): Promise<SoundOption[]> {
  try {
    const uploaded = await fetchUploaded();
    return [
      ...BUILT_IN_SOUNDS,
      ...uploaded.map((file) => ({
        // The id stays the stored filename: it is what the sound settings persist, so changing
        // it would unpick every saved selection.
        id: file.filename,
        name: uploadedSoundName(file.filename),
        url: file.url,
        source: 'uploaded' as const
      }))
    ];
  } catch {
    // The built-ins are on disk next to the app; losing the uploaded list must not lose those.
    return BUILT_IN_SOUNDS;
  }
}
