// ================================
// AUTHENTICATION (session identity + sign-out)
// ================================
//
// The pages themselves are gated server-side (`pageAuth` in backend/server.ts), so this module
// is not a gate — it exists so the UI can say WHO is signed in and offer a way out. Until now
// the app had no sign-out at all: the only way to switch operator was to clear the cookie by
// hand.

// Relative base, matching database.js — resolves correctly whether the app is served at / or /win.
const API_BASE = './api';

/**
 * The current session, or null when there is none.
 * Never throws: the sign-in state is decoration on every screen that uses it, and a failed probe
 * must not take down the page it is decorating.
 *
 * @returns {Promise<{username: string, email?: string, name?: string, provider: 'google'|'admin'}|null>}
 */
export async function getSession() {
  try {
    const response = await fetch(`${API_BASE}/auth/session`);
    if (!response.ok) return null;

    const data = await response.json();
    return data?.authenticated ? data : null;
  } catch (error) {
    console.warn('[auth] Could not read the current session:', error);
    return null;
  }
}

/**
 * How to label the signed-in user: their Google display name, falling back to the email address,
 * falling back to the account name. The admin backdoor has only the last of those.
 */
export function sessionLabel(session) {
  if (!session) return '';
  return session.name || session.email || session.username;
}

/**
 * Clears the session and returns to the login page.
 *
 * The redirect happens whether or not the request succeeded: if the server dropped the session
 * we are done, and if it did not, `pageAuth` bounces the user straight back to login anyway.
 * Leaving them on an authenticated-looking page after they asked to leave is the one outcome
 * worth ruling out.
 */
export async function signOut() {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  } catch (error) {
    console.warn('[auth] Sign-out request failed; returning to login anyway:', error);
  }
  window.location.href = './login';
}
