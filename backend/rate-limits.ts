import rateLimit from 'express-rate-limit';

/**
 * Shared rate limiters.
 *
 * These live outside `middleware.ts` on purpose. `middleware.ts` imports the session store from
 * `routes/auth.ts`, and `routes/auth.ts` needs `strictLimiter` for the two unauthenticated
 * sign-in endpoints — importing it from `middleware.ts` would form a cycle that only happens to
 * work because of module evaluation order. A separate module has no such dependency, so the
 * arrangement is correct by construction rather than correct until someone reorders an import.
 */

// Rate limiting is disabled in dev mode.
// Default to dev mode unless NODE_ENV is explicitly 'production'
const isDev = process.env.NODE_ENV !== 'production';

// General: 100 requests per minute (disabled in dev mode)
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 0 : 100, // 0 = unlimited in dev mode
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev // Skip rate limiting entirely in dev mode
});

// Strict: 10 requests per minute for sensitive endpoints (disabled in dev mode).
// Guards the MinistryPlatform/texting endpoints and both sign-in paths — the latter are
// unauthenticated by definition, so this is what stands between a shared password and a
// brute-force run.
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 0 : 10, // 0 = unlimited in dev mode
  message: { error: 'Too many requests to sensitive endpoint' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev // Skip rate limiting entirely in dev mode
});
