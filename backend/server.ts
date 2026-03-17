import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';

import { ROOT_DIR, DIST_DIR, UPLOADS_DIR, PORT } from './config.js';
import { ensureDataDir } from './services/collection.js';
import { apiRouter } from './routes/router.js';
import { startTextingScheduler } from './services/texting-scheduler.js';
import {
  corsMiddleware,
  helmetMiddleware,
  generalLimiter,
  sessionAuth,
  securityHeaders
} from './middleware.js';
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
app.use('/api', generalLimiter);
app.use('/api', sessionAuth);
app.use(securityHeaders);

// Create main router
const mainRouter = express.Router();

// Mount API router
mainRouter.use('/api', apiRouter);

// Serve uploaded images
mainRouter.use('/uploads', express.static(UPLOADS_DIR));

// Login page (public)
mainRouter.get('/login', (req: Request, res: Response) => {
  res.sendFile(path.join(ROOT_DIR, 'login.html'));
});

// Route for conditions page (public)
mainRouter.get('/conditions', (req: Request, res: Response) => {
  res.sendFile(path.join(ROOT_DIR, 'conditions.html'));
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
  await ensureDataDir();
  startTextingScheduler();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
