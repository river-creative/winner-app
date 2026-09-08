import { sveltekit } from '@sveltejs/kit/vite';
import type { PluginOption } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Where the Express API lives in development.
 *
 * Read from the environment so a second checkout can run alongside the first — the backend's own
 * port comes from `PORT` in `.env`, and this has to follow it. Defaults to the committed 3001.
 */
const BACKEND_ORIGIN = `http://localhost:${process.env.BACKEND_PORT ?? process.env.PORT ?? 3001}`;

/**
 * Fail loudly, at the moment the dev server starts, when the Express backend is not running.
 *
 * Without this the app boots into a shell whose every request dies with ECONNREFUSED and whose
 * only symptom is an empty screen. The old Vite config caught this by intercepting requests
 * (vite.config.js in the Alpine app); a SPA cannot do that without breaking client-side
 * routing, so the check moved to a one-shot probe with an actionable message.
 */
function backendReachabilityWarning(): PluginOption {
  return {
    name: 'backend-reachability-warning',
    apply: 'serve',
    async configureServer(server) {
      server.httpServer?.once('listening', async () => {
        try {
          const response = await fetch(`${BACKEND_ORIGIN}/api/health`);
          if (response.ok) return;
          server.config.logger.warn(
            `\n[dev] ${BACKEND_ORIGIN}/api/health answered ${response.status}. The API will not work.\n`
          );
        } catch (error) {
          server.config.logger.warn(
            `\n[dev] Backend unreachable at ${BACKEND_ORIGIN} — is it running? (${
              error instanceof Error ? error.message : String(error)
            })` + `\n      Start it with:  pnpm dev:server   (or run both with:  pnpm dev:all)\n`
          );
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [sveltekit(), backendReachabilityWarning()],

  server: {
    port: 3000,
    // Same-origin in dev, so the session cookie is sent without CORS or `credentials: 'include'`
    // — matching production, where Express serves the bundle itself.
    proxy: {
      '/api': { target: BACKEND_ORIGIN, changeOrigin: true },
      '/uploads': { target: BACKEND_ORIGIN, changeOrigin: true }
    }
  },

  preview: {
    port: 4173,
    proxy: {
      '/api': { target: BACKEND_ORIGIN, changeOrigin: true },
      '/uploads': { target: BACKEND_ORIGIN, changeOrigin: true }
    }
  },

  build: {
    sourcemap: true
  },

  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.svelte.test.ts']
        }
      },
      {
        extends: true,
        // Components must resolve Svelte's browser build, not its server build, or every
        // render() returns markup with no reactivity attached.
        resolve: { conditions: ['browser'] },
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['src/**/*.svelte.test.ts'],
          setupFiles: ['./vitest-setup.ts']
        }
      },
      {
        extends: true,
        // The Express side. It is compiled by tsconfig.backend.json rather than by SvelteKit, so
        // `$lib` does not resolve here and these files import each other by relative path.
        //
        // Anything added under backend/ must also be excluded from tsconfig.backend.json, whose
        // outDir is backend/ itself — otherwise `npm run build:backend` emits the tests next to
        // the server and deploys them.
        resolve: {
          // Backend modules import each other as `./thing.js`, the ESM specifier TypeScript emits.
          // `outDir` is `backend/` itself, so after any `npm run build:backend` those `.js` files
          // exist on disk right next to their sources — and vitest resolves the specifier
          // literally, silently testing the last build instead of the code. That is not
          // hypothetical: this project's first backend test passed against stale output and only
          // failed once the source gained a check the build did not have.
          alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1.ts' }]
        },
        test: {
          name: 'backend',
          environment: 'node',
          include: ['backend/**/*.test.ts']
        }
      }
    ]
  }
});
