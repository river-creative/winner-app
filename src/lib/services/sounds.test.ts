import { describe, expect, it } from 'vitest';
import { loadSounds, uploadedSoundName } from './sounds';

describe('uploadedSoundName', () => {
  /** The server prefixes uploads with `sound-<timestamp>-` so same-named files cannot collide. */
  it('strips the storage prefix and the extension', () => {
    expect(uploadedSoundName('sound-1788707882985-walkthrough-tone.mp3')).toBe('walkthrough-tone');
  });

  it('keeps a name that happens to contain digits or dashes', () => {
    expect(uploadedSoundName('sound-1700000000000-drum-roll-v2.mp3')).toBe('drum-roll-v2');
  });

  it('leaves a file that carries no storage prefix alone', () => {
    expect(uploadedSoundName('applause.mp3')).toBe('applause');
  });

  // "sound-" without digits is not the server's prefix, so it is part of the operator's name.
  it('does not mistake a leading "sound-" for the prefix', () => {
    expect(uploadedSoundName('sound-effects.mp3')).toBe('sound-effects');
  });
});

describe('loadSounds', () => {
  it('offers the built-ins plus every upload, named for the operator', async () => {
    const sounds = await loadSounds(async () => [
      {
        filename: 'sound-1788707882985-walkthrough-tone.mp3',
        url: '/uploads/sound-1788707882985-walkthrough-tone.mp3'
      }
    ]);

    const uploaded = sounds.filter((s) => s.source === 'uploaded');
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.name).toBe('walkthrough-tone');
    // The id stays the stored filename — it is what the settings persist.
    expect(uploaded[0]?.id).toBe('sound-1788707882985-walkthrough-tone.mp3');
    expect(sounds.filter((s) => s.source === 'built-in').length).toBeGreaterThan(0);
  });

  /** Losing the uploads list must never cost the built-ins, which ship with the app. */
  it('falls back to the built-ins when the upload list cannot be fetched', async () => {
    const sounds = await loadSounds(async () => {
      throw new Error('offline');
    });

    expect(sounds.length).toBeGreaterThan(0);
    expect(sounds.every((s) => s.source === 'built-in')).toBe(true);
  });
});
