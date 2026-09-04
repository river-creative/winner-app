// Must be the first import: ES module imports are evaluated in the order they are written, and
// `./config.js` reads `process.env.PORT` at module scope. Calling `dotenv.config()` further down
// the file ran *after* that read, so `PORT` in .env was silently ignored and the server always
// listened on the 3001 default.
import 'dotenv/config';

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';

import { DIST_DIR, UPLOADS_DIR, PORT } from './config.js';
import { ensureDataDir } from './services/collection.js';
import { apiRouter } from './routes/router.js';
import { startTextingScheduler } from './services/texting-scheduler.js';
import {
  corsMiddleware,
  helmetMiddleware,
  sessionAuth,
  securityHeaders
} from './middleware.js';
import { generalLimiter } from './rate-limits.js';
import { loadAuthConfig } from './auth-config.js';
import { sessions, SESSION_DURATION } from './routes/auth.js';

const app = express();

// Trust proxy for proper IP detection behind nginx
app.set('trust proxy', 1);

// Apply middleware
app.use(corsMiddleware);
app.use(helmetMiddleware);
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(securityHeaders);

// Create main router
const mainRouter = express.Router();

// Mount API router WITH its guards attached.
// These were previously registered as `app.use('/api', …)`, which only matches paths beginning
// `/api` — but mainRouter is also mounted at `/win`, so `/win/api/*` entered every API route with
// no authentication and no rate limit. Attaching them here makes the guards travel with the
// router to every mount point, so a future mount cannot reopen the hole.
mainRouter.use('/api', generalLimiter, sessionAuth, apiRouter);

// Serve uploaded images
mainRouter.use('/uploads', express.static(UPLOADS_DIR));

// The frontend is a single-page app: one shell, dist/index.html, for every page route. The
// four separate HTML entry points the Vite build used to emit are gone — SvelteKit's router
// resolves /login, /conditions, /scan and the console from the same document.
const SPA_SHELL = path.join(DIST_DIR, 'index.html');

// Public pages. They must not require a session: /login is where an expired one is renewed.
mainRouter.get('/login', (req: Request, res: Response) => {
  res.sendFile(SPA_SHELL);
});

mainRouter.get('/conditions', (req: Request, res: Response) => {
  res.sendFile(SPA_SHELL);
});

// Page auth middleware - redirects to login if not authenticated
function pageAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.session;

  if (!token) {
    return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
  }

  const session = sessions.get(token);
  if (!session || Date.now() - session.createdAt > SESSION_DURATION) {
    sessions.delete(token);
    res.clearCookie('session');
    return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
  }

  next();
}

// The app itself (requires authentication) - must be before the static middleware
mainRouter.get('/', pageAuth, (req: Request, res: Response) => {
  res.sendFile(SPA_SHELL);
});

// Serve the built assets (after the explicit page routes)
mainRouter.use(express.static(DIST_DIR));

// Every other page route is the app too: /scan, /lists, /winners, /present and the rest are
// client-side routes, so they all resolve to the same shell behind the same session check.
mainRouter.get('*', pageAuth, (req: Request, res: Response) => {
  res.sendFile(SPA_SHELL);
});

/**
 * The legacy `/win` prefix.
 *
 * The API keeps working there, unchanged, for anything still calling it. **Pages** now redirect
 * to the canonical path instead of being served a second time.
 *
 * A client-side router is compiled for exactly one base path. Served under a second prefix it
 * resolves `/win/lists` against a base of `''`, finds no such route, and 404s — so the old
 * double mount would have turned every internal link under `/win` into a dead end. Redirecting
 * also removes the whole class of prefix bugs the audit found: `pageAuth` redirecting to an
 * absolute `/login` that drops the prefix, and upload responses returning absolute
 * `/uploads/...` paths.
 *
 * `tickets.revival.com/win` moved to `win.revival.com` some time ago, so this only serves old
 * bookmarks.
 */
const winRouter = express.Router();
winRouter.use('/api', generalLimiter, sessionAuth, apiRouter);
winRouter.use('/uploads', express.static(UPLOADS_DIR));
winRouter.get('*', (req: Request, res: Response) => {
  const target = req.originalUrl.replace(/^\/win(?=\/|$)/, '') || '/';
  res.redirect(301, target);
});

// Mounted before the root router: `mainRouter`'s own `*` route matches `/win/...` too, so
// registering it first would swallow every legacy URL before the redirect could run.
app.use('/win', winRouter);
app.use('/', mainRouter);

/**
 * The one error handler.
 *
 * Until now there was none, so anything that threw or called `next(err)` — a multer rejection
 * for a file that is too large or the wrong type, a blocked CORS origin — fell through to
 * Express's default handler and came back as an HTML 500. Every client here parses JSON, so an
 * HTML body turns a clear "Only MP3 audio files are allowed" into an unexplained parse failure.
 *
 * Four parameters is what makes Express treat this as an error handler; `next` is unused.
 */
app.use((error: any, req: Request, res: Response, _next: NextFunction) => {
  const status = typeof error?.status === 'number' ? error.status : 500;
  // Multer reports its own limits through `code`; those are the caller's fault, not the server's.
  const isClientFault = status < 500 || error?.code === 'LIMIT_FILE_SIZE';

  if (!isClientFault) {
    console.error('Unhandled error:', error);
  }

  res.status(isClientFault ? (status === 500 ? 400 : status) : 500).json({
    error: error?.message || 'Something went wrong.'
  });
});

async function startServer(): Promise<void> {
  // Validate the auth environment before binding the port. A missing ADMIN_PASSWORD or
  // GOOGLE_CLIENT_ID used to surface as a 500 the first time somebody tried to sign in — which
  // is to say, at the worst possible moment. Now the container refuses to start and says why.
  loadAuthConfig();

  await ensureDataDir();
  startTextingScheduler();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Server failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
