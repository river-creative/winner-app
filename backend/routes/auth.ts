import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

export const authRouter = express.Router();

interface Session {
  username: string;
  createdAt: number;
}

// Session store: in-memory Map backed by a JSON file in the data volume, so sessions
// survive server restarts / deploys (which recreate the container) instead of logging
// every operator out mid-event.
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const sessions = new Map<string, Session>();

// Session duration: 24 hours
const SESSION_DURATION = 24 * 60 * 60 * 1000;

// Load persisted sessions on startup, dropping any that have already expired.
function loadSessions(): void {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const entries: [string, Session][] = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
    const now = Date.now();
    for (const [token, session] of entries) {
      if (now - session.createdAt <= SESSION_DURATION) {
        sessions.set(token, session);
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

// Login endpoint
authRouter.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;

  if (!validUser || !validPass) {
    console.error('ADMIN_USERNAME and ADMIN_PASSWORD must be set in .env');
    return res.status(500).json({ error: 'Server authentication not configured' });
  }

  if (username === validUser && password === validPass) {
    const token = generateSessionToken();
    sessions.set(token, { username, createdAt: Date.now() });
    saveSessions();

    // Set secure cookie
    res.cookie('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_DURATION
    });

    return res.json({ success: true });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
});

// Logout endpoint
authRouter.post('/logout', (req: Request, res: Response) => {
  const token = req.cookies?.session;

  if (token) {
    sessions.delete(token);
    saveSessions();
  }

  res.clearCookie('session');
  return res.json({ success: true });
});

// Check session endpoint
authRouter.get('/session', (req: Request, res: Response) => {
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

  return res.json({ authenticated: true, username: session.username });
});

// Export sessions map for use in middleware
export { sessions, SESSION_DURATION };
