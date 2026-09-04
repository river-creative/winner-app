import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { sessions, SESSION_DURATION } from './routes/auth.js';

// CORS configuration - whitelist allowed origins
const allowedOrigins = [
  'https://win.revival.com',
  'https://revival.com',
  /\.revival\.com$/,  // all revival.com subdomains
  'http://localhost:5173',
  'http://localhost:6001',  // Svelte dev server
  'http://localhost:3000',
  'http://localhost:3001'
];

/**
 * CORS, with two rules that the allowlist alone did not cover.
 *
 * **Same-origin always passes.** A request whose `Origin` is the host it was sent to is by
 * definition not cross-origin, and no allowlist should have a say in it. This matters now in a
 * way it did not before: the frontend is an ES-module bundle, and the browser fetches module
 * scripts in CORS mode — so every one of the app's own JavaScript chunks arrives carrying an
 * `Origin` header. Serving the app from any host not spelled out below (a second dev port, a
 * staging box, an IP address) made every chunk fail and the page render blank, with the only
 * clue a 500 on an asset that `curl` fetched perfectly.
 *
 * **A disallowed origin is refused, not errored.** `callback(null, false)` omits the CORS
 * headers and lets the browser do the blocking, which is what CORS is. Passing an `Error`
 * instead turned a probe from an unknown origin into a 500 from the app itself — noise in the
 * logs, and a misleading status for anything watching them.
 */
export const corsMiddleware = cors((req, callback) => {
  const origin = req.headers.origin;

  // No origin at all: curl, a server-to-server call, or a plain same-origin navigation.
  if (!origin) return callback(null, { origin: true, credentials: true });

  const host = req.headers.host;
  const isSameOrigin =
    !!host && (origin === `http://${host}` || origin === `https://${host}`);

  const isAllowed =
    isSameOrigin ||
    allowedOrigins.some(allowed =>
      allowed instanceof RegExp ? allowed.test(origin) : allowed === origin
    );

  if (!isAllowed) {
    console.warn(`CORS blocked request from origin: ${origin}`);
  }

  callback(null, { origin: isAllowed, credentials: true });
});

// Security headers (skip CSP since we have custom one below).
//
// Two of helmet's defaults break Sign in with Google outright, so both are overridden here
// rather than left implicit:
//
//   * Referrer-Policy defaults to `no-referrer`. GIS identifies the embedding origin from the
//     Referer header on its /gsi/button iframe request; with no Referer it cannot, and rejects
//     the page with "The given origin is not allowed for the given client ID" — regardless of
//     what is actually registered in Google Cloud Console, which makes it look like a console
//     misconfiguration. Verified by rewriting only this header against the live site: the same
//     page and client went from 400 to 200. `strict-origin-when-cross-origin` sends the origin
//     only — never the path, and nothing on an HTTPS->HTTP downgrade — and is both what GIS
//     needs and the modern browser default.
//   * Cross-Origin-Opener-Policy defaults to `same-origin`, which severs `window.opener` when
//     the sign-in popup navigates to accounts.google.com, leaving the credential with no way
//     back to the page. `same-origin-allow-popups` is Google's documented requirement and still
//     isolates this page from everything except the popups it opens itself.
export const helmetMiddleware = helmet({
  contentSecurityPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
});

// Rate limiters live in ./rate-limits.js — see the note there on why they are not in this file.

// A styled 401 page used to live here. It was never referenced by any route — page auth
// redirects to /login and API auth answers JSON — so it was removed rather than left to
// look like a fallback that exists.


// Session-based authentication middleware for API endpoints
export function sessionAuth(req: Request, res: Response, next: NextFunction) {
  // Skip auth for public endpoints (paths are relative to /api mount point).
  // Every /auth/* route is public by nature: the two sign-in endpoints ARE the login, /session
  // reports its own 401, and /logout must stay reachable so an expired session can still be
  // cleared. They are rate-limited instead — see ./rate-limits.js.
  const publicPaths = [
    '/health',
    '/auth/config',
    '/auth/google',
    '/auth/login',
    '/auth/logout',
    '/auth/session'
  ];
  if (publicPaths.includes(req.path)) {
    return next();
  }

  const token = req.cookies?.session;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const session = sessions.get(token);

  if (!session || Date.now() - session.createdAt > SESSION_DURATION) {
    sessions.delete(token);
    res.clearCookie('session');
    return res.status(401).json({ error: 'Session expired' });
  }

  // Attach user info to request
  (req as any).user = { username: session.username };
  next();
}

// Content Security Policy and cache headers middleware
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Only set CSP for HTML pages, not API calls
  if (!req.path.includes('/api/')) {
    res.setHeader(
      'Content-Security-Policy',
      // Google Identity Services needs four of these directives. Google's guidance is to allow
      // the parent URL https://accounts.google.com/gsi/ rather than enumerate endpoints, except
      // for the library itself which is the exact file .../gsi/client. Without them the sign-in
      // button fails silently: the script is blocked, and the button renders in an iframe that
      // `frame-src 'none'` would refuse.
      "default-src 'self' https:; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net https://*.gstatic.com https://unpkg.com https://accounts.google.com/gsi/client; " +
      "worker-src 'self' blob:; " +
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://accounts.google.com/gsi/; " +
      "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' https: https://accounts.google.com/gsi/; " +
      "frame-src https://accounts.google.com/gsi/; " +
      "object-src 'none'; " +
      "base-uri 'self';"
    );

    // Force cache refresh for HTML files to break PWA cache
    if (req.path.endsWith('.html') || req.path === '/' || req.path === '/win' || req.path === '/win/') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      // Note: Removed Clear-Site-Data header - it was wiping localStorage on every page load
    }
  }
  next();
}
