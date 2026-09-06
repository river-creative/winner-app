# Multi-stage build for a smaller, reproducible final image.
#
# pnpm, not npm: pnpm-lock.yaml is the only lockfile this repo has, and `npm install` ignores it
# entirely — it would resolve fresh versions at build time, so the image shipped to production
# would be built from a different dependency set than the one tested here. `--frozen-lockfile`
# fails the build instead of silently drifting.
#
# Three stages, so pnpm and the dev dependencies stay out of the runtime image: `deps` resolves
# production dependencies alone, `builder` needs everything, and the final stage copies the two
# results and nothing else.

# ------------------------------------------------------------------------------------------------
# Stage 1: production dependencies
# ------------------------------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# pnpm-workspace.yaml is not optional. It carries the `allowBuilds` approvals, and pnpm 10 skips
# dependency build scripts without them — which would leave esbuild with no platform binary.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Corepack installs the exact pnpm named by `packageManager` in package.json, so the image and the
# developer's machine run the same one.
RUN corepack enable && corepack prepare --activate

RUN pnpm install --frozen-lockfile --prod

# ------------------------------------------------------------------------------------------------
# Stage 2: build the frontend bundle and compile the backend
# ------------------------------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare --activate

# The full tree, dev dependencies included: SvelteKit, Vite and tsc all live there.
RUN pnpm install --frozen-lockfile

COPY . .

# `vite build` writes dist/, then `tsc -p tsconfig.backend.json` emits backend/*.js beside the .ts.
RUN pnpm run build

# ------------------------------------------------------------------------------------------------
# Stage 3: runtime
# ------------------------------------------------------------------------------------------------
FROM node:22-alpine

# dumb-init reaps zombies and forwards signals, so the container stops on the first SIGTERM.
RUN apk add --no-cache dumb-init

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# package.json only — no lockfile or workspace file, because nothing installs from here.
COPY package.json ./

# pnpm's tree is symlinks into node_modules/.pnpm; they are relative, so they survive the copy.
COPY --from=deps /app/node_modules ./node_modules

# public/ is deliberately not copied: svelte.config.js sets `files.assets: 'public'`, so the build
# already placed every static asset — icons, sounds, the manifest — inside dist/. Copying it again
# duplicated all of them in the image, and the backend never reads that directory.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/backend ./backend

# The volume is mounted over this in production; it exists so the container also runs without one.
RUN mkdir -p /app/data && \
    chown -R nodejs:nodejs /app

USER nodejs

# Documentation only, and the default the server falls back to. PORT overrides it at run time.
EXPOSE 3001

# Reads PORT rather than assuming 3001, so a container told to listen elsewhere is not reported
# unhealthy forever. 127.0.0.1, not localhost: the server binds IPv4, and localhost can resolve to
# ::1 first. The error handler makes a refused connection an explicit failure rather than relying
# on an uncaught exception to set the exit code.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const p=process.env.PORT||3001;require('http').get('http://127.0.0.1:'+p+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "backend/server.js"]
