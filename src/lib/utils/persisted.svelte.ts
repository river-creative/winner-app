import { browser } from '$app/environment';

/**
 * A `$state` cell backed by localStorage.
 *
 * Persistence happens in the setter rather than in an `$effect`, for two reasons: an `$effect`
 * needs a component or an effect root, which a module-level store does not have; and a write
 * that lands synchronously cannot be lost by a navigation that tears the effect down first.
 *
 * The storage keys this replaces are not free to change — a rename silently resets a live
 * operator's setup mid-event — so both encodings the old app used are supported:
 *   - JSON, which is what Alpine's `$persist` wrote (`settings_*`, `setup_*`, `ui_*`)
 *   - raw strings, which the filter state and the scanner theme wrote directly
 */
export class Persisted<T> {
  #key: string;
  #raw: boolean;
  #value: T = $state()!;

  constructor(key: string, initial: T, options: { raw?: boolean } = {}) {
    this.#key = key;
    this.#raw = options.raw ?? false;
    this.#value = this.#read() ?? initial;
  }

  get current(): T {
    return this.#value;
  }

  set current(value: T) {
    this.#value = value;
    this.#write(value);
  }

  #read(): T | undefined {
    if (!browser) return undefined;
    try {
      const stored = localStorage.getItem(this.#key);
      if (stored === null) return undefined;
      return this.#raw ? (stored as T) : (JSON.parse(stored) as T);
    } catch {
      // A corrupt value or a browser with storage blocked must not stop the app booting.
      return undefined;
    }
  }

  #write(value: T): void {
    if (!browser) return;
    try {
      if (value === undefined || value === null) {
        localStorage.removeItem(this.#key);
        return;
      }
      localStorage.setItem(this.#key, this.#raw ? String(value) : JSON.stringify(value));
    } catch {
      // Private browsing and "block site data" both throw on write. Losing the preference is
      // acceptable; losing the app is not.
    }
  }
}

/** Read one JSON-encoded key without taking ownership of it. Used for one-off migrations. */
export function readPersisted<T>(key: string): T | undefined {
  if (!browser) return undefined;
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? undefined : (JSON.parse(stored) as T);
  } catch {
    return undefined;
  }
}

/** Write one JSON-encoded key without taking ownership of it. */
export function writePersisted(key: string, value: unknown): void {
  if (!browser) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* see #write */
  }
}
