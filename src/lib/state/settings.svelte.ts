import { browser } from '$app/environment';
import * as api from '$lib/api/client';
import { applySettingValue, DEFAULT_SETTINGS, isSettingKey } from '$lib/constants/settings';
import type { DisplayRatio, FontFamily, Settings, Theme } from '$lib/types';
import { toasts } from './toasts.svelte';

export { DEFAULT_SETTINGS };

/** Aspect ratios as decimals. Anything below 1 is portrait and reflows the winners grid. */
export const DISPLAY_RATIOS: Record<DisplayRatio, number | null> = {
  fit: null,
  '16:9': 16 / 9,
  '16:10': 16 / 10,
  '4:3': 4 / 3,
  '21:9': 21 / 9,
  '9:16': 9 / 16,
  '3:4': 3 / 4,
  '10:12': 10 / 12
};

export interface ThemePreset {
  id: string;
  label: string;
  icon: string;
  buttonClass: string;
  primaryColor: string;
  secondaryColor: string;
  selectionColor: string;
  fontFamily: FontFamily;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'default',
    label: 'Default',
    icon: 'bi-palette',
    buttonClass: 'btn-outline-primary',
    primaryColor: '#6366f1',
    secondaryColor: '#8b5cf6',
    selectionColor: '#10b981',
    fontFamily: 'Inter'
  },
  {
    id: 'emerald',
    label: 'Emerald',
    icon: 'bi-gem',
    buttonClass: 'btn-outline-success',
    primaryColor: '#10b981',
    secondaryColor: '#06d6a0',
    selectionColor: '#14b8a6',
    fontFamily: 'Inter'
  },
  {
    id: 'ruby',
    label: 'Ruby',
    icon: 'bi-diamond',
    buttonClass: 'btn-outline-danger',
    primaryColor: '#ef4444',
    secondaryColor: '#f87171',
    selectionColor: '#f43f5e',
    fontFamily: 'Poppins'
  },
  {
    id: 'gold',
    label: 'Gold',
    icon: 'bi-star',
    buttonClass: 'btn-outline-warning',
    primaryColor: '#f59e0b',
    secondaryColor: '#fbbf24',
    selectionColor: '#f97316',
    fontFamily: 'Poppins'
  },
  {
    id: 'ocean',
    label: 'Ocean',
    icon: 'bi-water',
    buttonClass: 'btn-outline-info',
    primaryColor: '#0ea5e9',
    secondaryColor: '#06b6d4',
    selectionColor: '#0891b2',
    fontFamily: 'Open Sans'
  },
  {
    id: 'corporate',
    label: 'Corporate',
    icon: 'bi-building',
    buttonClass: 'btn-outline-secondary',
    primaryColor: '#374151',
    secondaryColor: '#6b7280',
    selectionColor: '#475569',
    fontFamily: 'Roboto'
  }
];

const WHOLE_OBJECT_CACHE_KEY = 'settings';
const PER_KEY_PREFIX = 'settings_';
const THEME_KEY = 'theme';

/** How long to wait after the last change before writing to the server. */
const SERVER_WRITE_DEBOUNCE_MS = 400;

const FONT_STACK_SUFFIX = `, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

function hexToRgba(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return `rgba(99, 102, 241, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

class SettingsStore {
  #values = $state<Settings>({ ...DEFAULT_SETTINGS });
  #theme = $state<Theme>('light');
  #loaded = $state(false);
  #saving = $state(false);

  /** Keys changed since the last server write, coalesced so one request carries all of them. */
  #pending = new Set<keyof Settings>();
  #timer: ReturnType<typeof setTimeout> | null = null;

  get current(): Settings {
    return this.#values;
  }

  get theme(): Theme {
    return this.#theme;
  }

  get loaded(): boolean {
    return this.#loaded;
  }

  /** True while a debounced write is in flight — the Settings screen shows this. */
  get saving(): boolean {
    return this.#saving;
  }

  // -------------------------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------------------------

  /**
   * Hydrate from every place a setting can live, weakest source first:
   * defaults → per-key `settings_*` → the whole-object cache → the server.
   *
   * The per-key layer exists because keys the old vanilla object did not know about —
   * `stableGrid` above all — were only ever written there by Alpine's `$persist`. Reading it
   * first is what stops an operator's reveal and delay configuration resetting on upgrade.
   * After a successful server read every key is written back, so the split heals itself.
   */
  async load(): Promise<void> {
    if (!browser) return;

    const merged: Settings = { ...DEFAULT_SETTINGS };

    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
      const stored = this.#readLocal(`${PER_KEY_PREFIX}${key}`);
      if (stored !== undefined) applySettingValue(merged, key, stored);
    }

    const cached = this.#readLocal(WHOLE_OBJECT_CACHE_KEY);
    if (cached && typeof cached === 'object') {
      for (const [key, value] of Object.entries(cached)) applySettingValue(merged, key, value);
    }

    this.#values = merged;
    this.#theme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
    this.applyTheme();

    // The screen is usable from cache at this point; the server is the slow, authoritative pass.
    try {
      const records = await api.getAll('settings');
      let changed = false;
      for (const record of records) {
        if (applySettingValue(this.#values, record.key, record.value)) changed = true;
      }
      if (changed) this.applyTheme();
      this.#writeWholeCache();

      // Heal the old split: push back anything the server has never seen.
      const known = new Set(records.map((record) => record.key));
      const missing = (Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>).filter(
        (key) => !known.has(key)
      );
      if (missing.length > 0) await this.#writeToServer(missing);
    } catch (error) {
      // Running from cache is a degraded but working state; the operator needs to know which.
      toasts.fromError(error, 'Could not load settings from the server — using this device’s copy.');
    } finally {
      this.#loaded = true;
    }
  }

  #readLocal(key: string): unknown {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? undefined : (JSON.parse(stored) as unknown);
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------------------------

  /** The only way a setting changes. Updates state, both caches, and schedules a server write. */
  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.#values[key] === value) return;
    this.#values[key] = value;

    this.#writeLocal(`${PER_KEY_PREFIX}${key}`, value);
    this.#writeWholeCache();

    this.#pending.add(key);
    this.#scheduleServerWrite();

    if (THEME_AFFECTING.has(key)) this.applyTheme();
  }

  /** Apply several settings at once — a theme preset, or a restore. */
  setMany(patch: Partial<Settings>): void {
    for (const [key, value] of Object.entries(patch)) {
      if (isSettingKey(key)) this.set(key, value as Settings[typeof key]);
    }
  }

  applyPreset(preset: ThemePreset): void {
    this.setMany({
      primaryColor: preset.primaryColor,
      secondaryColor: preset.secondaryColor,
      selectionColor: preset.selectionColor,
      fontFamily: preset.fontFamily
    });
  }

  reset(): void {
    this.setMany(DEFAULT_SETTINGS);
  }

  #writeLocal(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private browsing; losing the cache is survivable, losing the app is not */
    }
  }

  #writeWholeCache(): void {
    this.#writeLocal(WHOLE_OBJECT_CACHE_KEY, this.#values);
  }

  #scheduleServerWrite(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.flush();
    }, SERVER_WRITE_DEBOUNCE_MS);
  }

  /** Write every pending key now. Called on navigation away and before a backup. */
  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#pending.size === 0) return;

    const keys = [...this.#pending];
    this.#pending.clear();
    await this.#writeToServer(keys);
  }

  /**
   * One batched request, never one request per key.
   *
   * `settings.json` has no locking: each `POST /api/settings` reads the whole array and writes it
   * back, so two in flight at once silently lose one. Batching means one read-modify-write.
   */
  async #writeToServer(keys: Array<keyof Settings>): Promise<void> {
    if (keys.length === 0) return;
    this.#saving = true;
    try {
      await api.batchSave(
        keys.map((key) => ({
          collection: 'settings' as const,
          data: { key, value: this.#values[key] }
        }))
      );
    } catch (error) {
      // Put them back so the next change retries them rather than dropping them.
      for (const key of keys) this.#pending.add(key);
      toasts.fromError(error, 'Could not save settings to the server.');
    } finally {
      this.#saving = false;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Theme
  // -------------------------------------------------------------------------------------------

  setTheme(theme: Theme): void {
    this.#theme = theme;
    if (!browser) return;
    document.documentElement.setAttribute('data-theme', theme);
    /**
     * Bootstrap themes itself from its own attribute, so it needs telling too.
     *
     * Without it Bootstrap stayed in light mode under a dark app, and every token the app had
     * not hand-written a `[data-theme="dark"]` override for kept its light value: `.text-muted`
     * resolved to near-black and sat at 1.05:1 against the cards, `--bs-emphasis-color` was
     * `#000`, and the close button in every dialog was a dark glyph on a dark header. Re-skinning
     * Bootstrap a component at a time is only ever correct while someone remembers to add the
     * next rule; this makes the framework's own dark palette the baseline, over which the app's
     * `[data-theme="dark"]` rules still win — they are equally specific and load afterwards.
     */
    document.documentElement.setAttribute('data-bs-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* see #writeLocal */
    }
  }

  toggleTheme(): void {
    this.setTheme(this.#theme === 'dark' ? 'light' : 'dark');
  }

  /**
   * Push the colour and font settings into CSS custom properties on `:root`.
   *
   * The variable names are the ones styles.css actually reads — `--primary-color`, not
   * `--color-primary`. Getting that wrong is invisible in review and repaints nothing.
   */
  applyTheme(): void {
    if (!browser) return;
    const { style } = document.documentElement;
    const settings = this.#values;

    style.setProperty('--primary-color', settings.primaryColor);
    style.setProperty('--secondary-color', settings.secondaryColor);
    style.setProperty('--selection-color', settings.selectionColor || '#10b981');
    style.setProperty('--font-family', `'${settings.fontFamily}'${FONT_STACK_SUFFIX}`);
    style.setProperty('--primary-color-shadow', hexToRgba(settings.primaryColor, 0.25));
    style.setProperty('--gradient-bg', this.gradient);

    document.documentElement.setAttribute('data-display-font-size', settings.displayFontSize);
    this.#applyDisplayRatio();
  }

  get gradient(): string {
    return `linear-gradient(135deg, ${this.#values.primaryColor} 0%, ${this.#values.secondaryColor} 100%)`;
  }

  /**
   * The background of the letterboxed display stage. The surrounding backdrop stays dark, which
   * is why this is the stage's background and not the body's.
   */
  get displayStageStyle(): string {
    const settings = this.#values;
    if (settings.backgroundType === 'solid') return `background: ${settings.primaryColor}`;
    if (settings.backgroundType === 'image' && settings.customBackgroundImage) {
      const url = settings.customBackgroundImage;
      return `background-image: url('${url}'); background-size: cover; background-position: center; background-attachment: fixed`;
    }
    return `background: ${this.gradient}`;
  }

  /**
   * Letterboxing is done in CSS; this only sets the attributes it keys off.
   *
   * Fail-soft on an unknown value: a cosmetic setting must never break a live presentation, but
   * the warning makes the bad value findable.
   */
  #applyDisplayRatio(): void {
    const root = document.documentElement;
    const ratio = this.#values.displayRatio;
    const decimal = DISPLAY_RATIOS[ratio];

    if (decimal === undefined) {
      console.warn(`Unknown display ratio "${ratio}" — falling back to fit-to-screen.`);
    }

    if (!decimal) {
      root.setAttribute('data-display-ratio', 'fit');
      root.style.removeProperty('--display-ar');
      root.removeAttribute('data-display-orientation');
      return;
    }

    root.setAttribute('data-display-ratio', 'fixed');
    root.style.setProperty('--display-ar', String(decimal));
    root.setAttribute('data-display-orientation', decimal < 1 ? 'portrait' : 'landscape');
  }

  /** Gated console logging, same as the old `debugLog`. */
  debug(message: string, ...args: unknown[]): void {
    if (this.#values.enableDebugLogs) console.info(`[winner-app] ${message}`, ...args);
  }
}

/** Changing any of these has to repaint the CSS custom properties. */
const THEME_AFFECTING = new Set<keyof Settings>([
  'primaryColor',
  'secondaryColor',
  'selectionColor',
  'fontFamily',
  'backgroundType',
  'customBackgroundImage',
  'displayRatio',
  'displayFontSize'
]);

export const settings = new SettingsStore();
