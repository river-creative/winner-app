import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { getAuthConfig, getGoogleClient } from '../auth-config.js';
import { strictLimiter } from '../rate-limits.js';

export const authRouter = express.Router();

/** How the session was established. Drives what the UI shows and what the logs attribute. */
export type SessionProvider = 'google' | 'admin';

interface Session {
  /** Display handle: the Google email, or the admin account name. */
  username: string;
  provider: SessionProvider;
  /** Google sign-ins only — the admin backdoor has no email or profile name. */
  email?: string;
  name?: string;
  createdAt: number;
}

// Session store: in-memory Map backed by a JSON file in the data volume, so sessions
// survive server restarts / deploys (which recreate the container) instead of logging
// every operator out mid-event.
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const sessions = new Map<string, Session>();

// Session duration: 3 days
const SESSION_DURATION = 3 * 24 * 60 * 60 * 1000;

// Load persisted sessions on startup, dropping any that have already expired.
function loadSessions(): void {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const entries: [string, Session][] = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
    const now = Date.now();
    for (const [token, session] of entries) {
      if (now - session.createdAt <= SESSION_DURATION) {
        // Records written before Google sign-in existed carry no `provider`. Admin credentials
        // were the only way to obtain one, so that is what they are — this reads the old shape
        // rather than defaulting past a missing value, and it keeps operators signed in across
        // the deploy that introduces Google sign-in.
        sessions.set(token, { ...session, provider: session.provider ?? 'admin' });
      }
    }
  } catch (error) {
    console.error('Failed to load persisted sessions:', error);
  }
}

// Persist sessions atomically (temp file + rename) so a crash mid-write can't corrupt the store.
function saveSessions(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${SESSIONS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...sessions.entries()]));
    fs.renameSync(tmp, SESSIONS_FILE);
  } catch (error) {
    console.error('Failed to persist sessions:', error);
  }
}

loadSessions();

// Generate secure session token
function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Constant-time string comparison. `crypto.timingSafeEqual` requires equal-length buffers and
 * throws otherwise — which would itself leak the length — so both sides are hashed to a fixed
 * 32 bytes first and the digests are compared.
 */
function safeEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/** Issues the session cookie for an authenticated principal. Shared by both sign-in paths. */
function establishSession(res: Response, session: Omit<Session, 'createdAt'>): void {
  const token = generateSessionToken();
  sessions.set(token, { ...session, createdAt: Date.now() });
  saveSessions();

  res.cookie('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION
  });
}

// Clean expired sessions periodically
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [token, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_DURATION) {
      sessions.delete(token);
      changed = true;
    }
  }
  if (changed) saveSessions();
}, 60 * 60 * 1000); // Clean every hour

/**
 * Public sign-in bootstrap: the values the browser needs to initialise Google Identity Services.
 * Both are public — the client ID is the OAuth audience, not a secret.
 */
authRouter.get('/auth/config', (req: Request, res: Response) => {
  const { googleClientId, googleHostedDomain } = getAuthConfig();
  return res.json({ clientId: googleClientId, hostedDomain: googleHostedDomain });
});

/**
 * Google sign-in. The browser obtains an ID token from GIS and POSTs it here; we verify it
 * against Google's signing keys and the configured audience, confirm it belongs to the hosted
 * domain, and establish the session. No password, no code exchange, no client secret.
 *
 * Rate-limited alongside the admin form: this endpoint is unauthenticated by definition.
 */
authRouter.post('/auth/google', strictLimiter, async (req: Request, res: Response) => {
  const { credential } = req.body ?? {};

  if (typeof credential !== 'string' || credential.length === 0) {
    return res.status(400).json({ error: 'Google credential required' });
  }

  const { googleClientId, googleHostedDomain } = getAuthConfig();

  let payload;
  try {
    const ticket = await getGoogleClient().verifyIdToken({
      idToken: credential,
      audience: googleClientId
    });
    payload = ticket.getPayload();
  } catch (error) {
    // Bad signature, wrong audience, expired — all indistinguishable to the caller on purpose.
    console.warn('Rejected Google credential:', error instanceof Error ? error.message : error);
    return res.status(401).json({ error: 'Sign-in rejected. Please try again.' });
  }

  if (!payload) {
    console.warn('Rejected Google credential: token verified but carried no payload');
    return res.status(401).json({ error: 'Sign-in rejected. Please try again.' });
  }

  // Hosted-domain and verified-email checks are defense in depth: `hd` is only present on Google
  // Workspace accounts, so a personal Gmail address can never satisfy this even if its local part
  // matches a real staff member.
  if (payload.hd?.toLowerCase() !== googleHostedDomain) {
    console.warn(`Rejected Google credential: hd '${payload.hd}' is not '${googleHostedDomain}'`);
    return res.status(403).json({ error: `Only @${googleHostedDomain} accounts can sign in.` });
  }

  if (!payload.email_verified) {
    console.warn(`Rejected Google credential: email ${payload.email} is not verified`);
    return res.status(403).json({ error: 'Your Google email address is not verified.' });
  }

  // Second gate on the address itself, so a future Workspace configuration that issues `hd` for
  // a secondary domain cannot quietly widen who gets in.
  const email = payload.email?.toLowerCase() ?? '';
  if (!email.endsWith(`@${googleHostedDomain}`)) {
    console.warn(`Rejected Google credential: email '${email}' is outside '${googleHostedDomain}'`);
    return res.status(403).json({ error: `Only @${googleHostedDomain} accounts can sign in.` });
  }

  establishSession(res, {
    username: email,
    provider: 'google',
    email,
    name: payload.name
  });

  return res.json({ success: true, user: { email, name: payload.name, provider: 'google' } });
});

/**
 * Admin backdoor: the shared operator credentials from `.env`. Deliberately retained — the prize
 * scanner is run by volunteers who have no Workspace account, and it is the way back in if Google
 * is unreachable.
 */
authRouter.post('/auth/login', strictLimiter, (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const { adminUsername, adminPassword } = getAuthConfig();

  // Both comparisons run unconditionally: `&&` would short-circuit on a wrong username and leak,
  // through response timing, whether the username alone was correct.
  const usernameMatches = safeEqual(String(username), adminUsername);
  const passwordMatches = safeEqual(String(password), adminPassword);

  if (usernameMatches && passwordMatches) {
    establishSession(res, { username: adminUsername, provider: 'admin' });
    return res.json({ success: true, user: { name: adminUsername, provider: 'admin' } });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
});

// Logout endpoint
authRouter.post('/auth/logout', (req: Request, res: Response) => {
  const token = req.cookies?.session;

  if (token) {
    sessions.delete(token);
    saveSessions();
  }

  res.clearCookie('session');
  return res.json({ success: true });
});

// Check session endpoint
authRouter.get('/auth/session', (req: Request, res: Response) => {
  const token = req.cookies?.session;

  if (!token) {
    return res.status(401).json({ authenticated: false });
  }

  const session = sessions.get(token);

  if (!session || Date.now() - session.createdAt > SESSION_DURATION) {
    sessions.delete(token);
    res.clearCookie('session');
    return res.status(401).json({ authenticated: false });
  }

  return res.json({
    authenticated: true,
    username: session.username,
    email: session.email,
    name: session.name,
    provider: session.provider
  });
});

// Export sessions map for use in middleware
export { sessions, SESSION_DURATION };
