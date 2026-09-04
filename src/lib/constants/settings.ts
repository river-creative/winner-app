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
export function applySettingValue(target: Settings, key: string, value: unknown): boolean {
  if (!isSettingKey(key)) return false;

  const fallback = DEFAULT_SETTINGS[key];
  const allowNull = fallback === null;
  if (value === null) {
    if (!allowNull) return false;
  } else if (typeof value !== typeof fallback) {
    return false;
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
