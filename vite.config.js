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
          const response = await fetch('http://localhost:3001/api/session', {
            headers: { Cookie: `session=${sessionToken}` }
          });

          if (response.ok) {
            return next();
          }
        } catch (e) {
          // Backend not available, allow through (dev convenience)
          console.warn('Could not verify session with backend:', e.message);
          return next();
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