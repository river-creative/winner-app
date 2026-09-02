import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'

// Parse cookies from request header
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.split('=');
    cookies[name.trim()] = rest.join('=').trim();
  });
  return cookies;
}

// Session auth middleware for Vite dev server
// Sessions are stored in the backend, so we proxy /api/session to check auth
function sessionAuthPlugin() {
  return {
    name: 'session-auth',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Skip auth for HMR websocket and Vite internal requests
        if (req.url?.startsWith('/@') || req.url?.startsWith('/__vite') || req.url?.startsWith('/node_modules')) {
          return next();
        }

        // Skip auth for public pages and API
        if (req.url?.startsWith('/login') || req.url?.startsWith('/api/') || req.url?.startsWith('/conditions')) {
          return next();
        }

        // Skip auth for static assets
        if (req.url?.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)(\?|$)/)) {
          return next();
        }

        // Check for session cookie
        const cookies = parseCookies(req.headers.cookie);
        const sessionToken = cookies.session;

        if (!sessionToken) {
          // Redirect to login
          const redirect = encodeURIComponent(req.url || '/');
          res.writeHead(302, { Location: `/login?redirect=${redirect}` });
          res.end();
          return;
        }

        // Verify session with backend
        try {
          const response = await fetch('http://localhost:3001/api/auth/session', {
            headers: { Cookie: `session=${sessionToken}` }
          });

          if (response.ok) {
            return next();
          }
        } catch (e) {
          // Fail-fast: the backend at :3001 is unreachable, so every API call this
          // page makes would be refused (ECONNREFUSED). Rather than silently serving
          // a broken shell, tell the developer exactly what's wrong and how to fix it.
          console.error(`\n[dev] Backend unreachable at http://localhost:3001 — is it running? (${e.message})\n      Start it with:  pnpm dev:server   (or run both with:  pnpm dev:all)\n`);
          res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html>
<meta charset="utf-8">
<title>Backend not running</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0A4f7B;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:1rem}
  .card{background:#fff;color:#1f2937;max-width:520px;padding:2rem 2.25rem;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3)}
  h1{margin:0 0 .75rem;font-size:1.25rem}
  p{margin:.5rem 0;line-height:1.55}
  code{background:#f3f4f6;padding:.15rem .4rem;border-radius:6px;font-size:.9em}
  .hint{color:#6b7280;font-size:.85rem;margin-top:1.25rem}
</style>
<div class="card">
  <h1>⚠️ Backend server not running</h1>
  <p>The Vite dev server proxies <code>/api</code> to <code>http://localhost:3001</code>, but nothing is listening there.</p>
  <p>Start the backend, then reload this page:</p>
  <p><code>pnpm dev:server</code> &nbsp;—&nbsp; or run both together with <code>pnpm dev:all</code></p>
  <p class="hint">Shown by the Vite dev auth plugin — this only runs in local development, never in production.</p>
</div>`);
          return;
        }

        // Session invalid, redirect to login
        const redirect = encodeURIComponent(req.url || '/');
        res.writeHead(302, { Location: `/login?redirect=${redirect}` });
        res.end();
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '');

  return {
    // Add session auth plugin
    plugins: [sessionAuthPlugin()],

    // Base public path when served in development or production
    base: './',

    // Build configuration
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: true,
      // Ensure proper asset handling
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          login: resolve(__dirname, 'login.html'),
          scan: resolve(__dirname, 'scan.html'),
          conditions: resolve(__dirname, 'conditions.html')
        },
        output: {
          // Organize assets in build
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name.split('.')
            const ext = info[info.length - 1]
            if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
              return `assets/images/[name]-[hash][extname]`
            }
            if (/css/i.test(ext)) {
              return `assets/css/[name]-[hash][extname]`
            }
            return `assets/[name]-[hash][extname]`
          }
        }
      }
    },

    envPrefix: 'VITE_',

    // Development server configuration
    server: {
      port: 3000,
      open: true,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true
        },
        '/uploads': {
          target: 'http://localhost:3001',
          changeOrigin: true
        }
      }
    },

    // Preview server configuration
    preview: {
      port: 4173
    }
  };
})