import { OAuth2Client } from 'google-auth-library';

/**
 * Authentication configuration, read from the environment and validated ONCE at startup.
 *
 * Why this is loaded explicitly rather than at import time: `server.ts` calls `dotenv.config()`
 * in its module body, but ESM evaluates every `import` before that line runs. A module that read
 * `process.env` at import time would therefore always see an unloaded `.env` and fail. So the
 * read happens in `loadAuthConfig()`, which `server.ts` calls immediately after `dotenv.config()`
 * and before `app.listen` — fail-fast at boot instead of a 500 the first time someone signs in.
 */
export interface AuthConfig {
  /** Backdoor operator account. Required — the scanner is used by people without a Workspace account. */
  adminUsername: string;
  adminPassword: string;
  /**
   * Google OAuth 2.0 Web client ID — the `aud` claim every ID token is verified against.
   * NOT a secret (the browser sends it in the clear); it lives in the environment so the value
   * can differ per deployment without a rebuild.
   */
  googleClientId: string;
  /** Google Workspace hosted domain sign-in is restricted to, e.g. `revival.com`. */
  googleHostedDomain: string;
}

let cached: AuthConfig | null = null;
let googleClient: OAuth2Client | null = null;

/**
 * Reads and validates the auth environment. Throws with EVERY missing variable listed at once, so
 * a misconfigured deploy is fixed in one pass instead of one restart per variable.
 */
export function loadAuthConfig(): AuthConfig {
  const missing: string[] = [];
  const read = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) {
      missing.push(name);
      return '';
    }
    return value;
  };

  const adminUsername = read('ADMIN_USERNAME');
  const adminPassword = read('ADMIN_PASSWORD');
  const googleClientId = read('GOOGLE_CLIENT_ID');
  // A hosted domain is a bare DNS name. Accept "@revival.com" too — writing the leading @ is the
  // obvious mistake, and silently correcting a typo is not the same as inventing a missing value.
  const googleHostedDomain = read('GOOGLE_HOSTED_DOMAIN').replace(/^@/, '').toLowerCase();

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
      `Set them in .env (see .env.example). The server cannot authenticate anyone without them.`
    );
  }

  if (!googleHostedDomain.includes('.') || /[\s@/]/.test(googleHostedDomain)) {
    throw new Error(
      `GOOGLE_HOSTED_DOMAIN must be a bare domain such as "revival.com" — got "${googleHostedDomain}".`
    );
  }

  cached = Object.freeze({ adminUsername, adminPassword, googleClientId, googleHostedDomain });
  // One client for the process: it caches Google's signing certificates between verifications,
  // so a per-request instance would refetch the JWKS on every sign-in.
  googleClient = new OAuth2Client(googleClientId);
  return cached;
}

/** The validated config. Throws if `loadAuthConfig()` has not run — a wiring bug, surfaced loudly. */
export function getAuthConfig(): AuthConfig {
  if (!cached) {
    throw new Error('getAuthConfig() called before loadAuthConfig() — check the startup order in server.ts');
  }
  return cached;
}

/** The shared, cert-caching client used to verify Google ID tokens. */
export function getGoogleClient(): OAuth2Client {
  if (!googleClient) {
    throw new Error('getGoogleClient() called before loadAuthConfig() — check the startup order in server.ts');
  }
  return googleClient;
}
