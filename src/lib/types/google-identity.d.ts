/**
 * The slice of Google Identity Services the login page uses.
 *
 * GIS ships no types and is loaded from Google's CDN at runtime rather than bundled, so there is
 * nothing to import. Declaring only what is called keeps the sign-in flow free of casts and
 * makes a typo in an option name a compile error instead of a silently ignored property.
 *
 * A module, not an ambient script, so the login component can `import type` these names —
 * `no-undef` is not disabled for `.svelte` files, and a global type would read as undefined
 * there.
 */

export interface GoogleCredentialResponse {
  /** The Google ID token, exchanged server-side for this app's session cookie. */
  credential: string;
  select_by?: string;
}

export interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  /** Restricts the account chooser to one Workspace domain. Enforced again on the server. */
  hosted_domain?: string;
  auto_select?: boolean;
}

export interface GoogleButtonConfiguration {
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'small' | 'medium' | 'large';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  /** GIS renders a fixed-pixel-width button; it caps the value at 400. */
  width?: number;
}

export interface GoogleAccountsId {
  initialize(config: GoogleIdConfiguration): void;
  renderButton(parent: HTMLElement, options: GoogleButtonConfiguration): void;
}

declare global {
  interface Window {
    /** Present only once the GIS client script has loaded. */
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}
