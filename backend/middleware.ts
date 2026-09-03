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

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, curl, mobile apps)
    if (!origin) return callback(null, true);

    const isAllowed = allowedOrigins.some(allowed =>
      allowed instanceof RegExp ? allowed.test(origin) : allowed === origin
    );

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true
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

// Clean 401 error page HTML
const authErrorPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Required</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0A4f7B 0%, #5FA1F7 100%);
      padding: 1rem;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 2.5rem;
      max-width: 400px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
    }
    .icon {
      width: 72px;
      height: 72px;
      background: linear-gradient(135deg, #ef4444, #dc2626);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
    }
    .icon svg {
      width: 36px;
      height: 36px;
      fill: white;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 0.75rem;
    }
    p {
      color: #6b7280;
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #0A4f7B, #5FA1F7);
      color: white;
      text-decoration: none;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-weight: 500;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(10, 79, 123, 0.4);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg viewBox="0 0 24 24"><path d="M12 1C8.676 1 6 3.676 6 7v2H4v14h16V9h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v2H8V7c0-2.276 1.724-4 4-4zm0 10c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z"/></svg>
    </div>
    <h1>Authentication Required</h1>
    <p>Please sign in with your credentials to access this page.</p>
    <a href="javascript:location.reload()" class="btn">Try Again</a>
  </div>
</body>
</html>`;

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
