import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import * as api from '$lib/api/client';
import type { Session } from '$lib/types';

/**
 * Who is signed in, and what to do when they stop being.
 *
 * Page-level auth is enforced by Express (`pageAuth` redirects to /login), so this is not the
 * gate — it is the label in the header and the recovery path when a cookie expires while the
 * console is open, which happens: sessions are absolute, three days from issue, with no refresh.
 */
class SessionStore {
  #user = $state<Session | null>(null);
  #expired = $state(false);
  #checked = $state(false);

  get user(): Session | null {
    return this.#user;
  }

  get checked(): boolean {
    return this.#checked;
  }

  /** True once any request has come back 401. The shell blocks the UI and offers a sign-in link. */
  get expired(): boolean {
    return this.#expired;
  }

  /** The name to show in the header. The admin backdoor has only a username. */
  readonly label = $derived(this.#user ? (this.#user.name ?? this.#user.email ?? this.#user.username) : '');

  async load(): Promise<void> {
    try {
      this.#user = await api.getSession();
    } catch {
      // A failed probe must not break the page it only decorates.
      this.#user = null;
    } finally {
      this.#checked = true;
    }
  }

  markExpired(): void {
    this.#expired = true;
    this.#user = null;
  }

  /** Where to send the operator so they come back to the page they were on. */
  get loginHref(): string {
    const login = resolve('/login');
    if (!browser) return login;
    const redirect = encodeURIComponent(location.pathname + location.search);
    return `${login}?redirect=${redirect}`;
  }

  /**
   * A hard navigation, not a client-side one: signing out has to drop every piece of state this
   * tab is holding, and a router navigation would keep the stores alive behind the login page.
   */
  async signOut(): Promise<void> {
    await api.signOut();
    if (browser) location.href = resolve('/login');
  }
}

export const session = new SessionStore();

// One registration, at module load, so no screen has to remember to handle a 401 itself.
api.onSessionExpired(() => session.markExpired());
