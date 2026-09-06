import type { Settings } from '$lib/types';

/**
 * Every setting, with the defaults the app has always shipped.
 *
 * This is one object on purpose. The Alpine app kept two: an `Alpine.store('settings')` that had
 * `stableGrid` but not `skipExistingWinners`, and a plain object in settings.js with the reverse.
 * `loadSettings()` only adopted server keys already present in the plain object, so `stableGrid`
 * could never round-trip to the server, and the backup writer read a property that did not exist
 * and silently backed up nothing. One object removes all three bugs.
 */
export const DEFAULT_SETTINGS: Settings = {
  preventDuplicates: false,
  preventSamePrize: false,
  hideEntryCounts: false,
  enableDebugLogs: false,
  skipExistingWinners: false,

  enableWebhook: false,
  webhookUrl: '',

  fontFamily: 'Open Sans',
  primaryColor: '#6366f1',
  secondaryColor: '#8b5cf6',
  selectionColor: '#10b981',
  backgroundType: 'gradient',
  customBackgroundImage: null,

  displayRatio: 'fit',
  displayFontSize: 'default',

  selectionMode: 'all-at-once',
  displayEffect: 'fade-in',
  displayDuration: 0.5,
  stableGrid: false,

  preSelectionDelay: 0,
  delayVisualType: 'none',

  soundDuringDelay: 'none',
  soundEndOfDelay: 'none',
  soundDuringReveal: 'none',

  celebrationEffect: 'confetti',
  celebrationDuration: 4,
  celebrationAutoTrigger: true
};

/**
 * Adopt one stored value, but only when it is the shape the key expects.
 *
 * Settings arrive from three places that can all be stale or hand-edited: a per-key localStorage
 * entry, a whole-object cache, and the server's `{key, value}` rows. A string where a number
 * belongs would otherwise poison every comparison the draw makes against it, so a mismatch is
 * ignored and the default stands.
 */
/**
 * Keys that store a string but default to `null`.
 *
 * `typeof null` is `'object'`, so checking a value against the type of its own default rejected
 * every string these keys exist to hold. All three load paths run through this guard, so a
 * custom background applied the moment it was chosen and then vanished on the next load — the
 * saved value was thrown away on the way back in, from localStorage, cache and server alike.
 *
 * A future nullable key that is not a string needs its own entry here rather than this list.
 */
const NULLABLE_STRING_KEYS: ReadonlySet<string> = new Set(['customBackgroundImage']);

export function applySettingValue(target: Settings, key: string, value: unknown): boolean {
  if (!isSettingKey(key)) return false;

  const fallback = DEFAULT_SETTINGS[key];
  if (value === null) {
    if (fallback !== null) return false;
  } else {
    const expected = NULLABLE_STRING_KEYS.has(key) ? 'string' : typeof fallback;
    if (typeof value !== expected) return false;
  }

  // The one unavoidable cast in the settings pipeline, kept here so no caller repeats it.
  (target as unknown as Record<string, unknown>)[key] = value;
  return true;
}

export function isSettingKey(key: string): key is keyof Settings {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}

/** Build a complete `Settings` from the defaults plus whatever `entries` legitimately carries. */
export function mergeSettings(entries: Iterable<[string, unknown]>): Settings {
  const merged: Settings = { ...DEFAULT_SETTINGS };
  for (const [key, value] of entries) applySettingValue(merged, key, value);
  return merged;
}
