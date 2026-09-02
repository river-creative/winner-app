import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
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

// Load environment variables
dotenv.config();

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

// Login page (public)
mainRouter.get('/login', (req: Request, res: Response) => {
  res.sendFile(path.join(DIST_DIR, 'login.html'));
});

// Route for conditions page (public)
mainRouter.get('/conditions', (req: Request, res: Response) => {
  res.sendFile(path.join(DIST_DIR, 'conditions.html'));
});

// Page auth middleware - redirects to login if not authenticated
function pageAuth(req: Request, res: Response, next: Function) {
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

// Route for main app (requires authentication) - must be before static middleware
mainRouter.get('/', pageAuth, (req: Request, res: Response) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// Route for scanner page (requires authentication)
mainRouter.get('/scan', pageAuth, (req: Request, res: Response) => {
  res.sendFile(path.join(DIST_DIR, 'scan.html'));
});

// Serve static files from dist (after explicit routes)
mainRouter.use(express.static(DIST_DIR));

// Catch-all route for SPA (requires authentication)
mainRouter.get('*', pageAuth, (req: Request, res: Response) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// Mount the main router at both root and /win paths
app.use('/', mainRouter);
app.use('/win', mainRouter);

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
