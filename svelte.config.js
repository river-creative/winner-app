import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * The app ships as a single-page app, not a prerendered or server-rendered one.
 *
 * Two things force that and both are load-bearing:
 *   1. Express already owns the session cookie, the JSON collections and the page-level auth
 *      redirect (backend/server.ts). A second Node server from adapter-node would duplicate
 *      that contract, so the frontend stays a static bundle that Express serves out of dist/
 *      exactly where the old Vite build put it — the Dockerfile and deploy.sh do not change.
 *   2. Almost every screen is browser-only: BarcodeDetector, getUserMedia, AudioContext,
 *      Fullscreen, canvas celebrations, localStorage-backed settings. Rendering those on a
 *      server buys nothing and costs a class of hydration bugs.
 *
 * `ssr = false` is therefore set once, in src/routes/+layout.ts, and `fallback` makes
 * dist/index.html the shell for every route.
 *
 * @type {import('@sveltejs/kit').Config}
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'dist',
      assets: 'dist',
      fallback: 'index.html',
      precompress: false
    }),

    // Static assets keep living in public/ — the PWA manifest, service worker, icons and
    // sound files are already there and the Dockerfile already copies that directory.
    files: {
      assets: 'public'
    },

    paths: {
      // Empty for win.revival.com. The legacy tickets.revival.com/win deployment is served by
      // a redirect in backend/server.ts rather than a second base path, because a SPA router
      // can only be built for one base and silently 404s under any other prefix.
      base: process.env.BASE_PATH ?? '',
      relative: true
    }
  }
};

export default config;
