# Google `@revival.com` Sign-In + Admin Backdoor — Implementation Plan

**Date:** 2026-09-02
**Status:** Approved 2026-09-02 — decisions recorded in §7
**Reference implementation:** `/home/wilhelm/dev/mp/river-rsvp` (RiverRSVP, .NET)

---

## 0. Originating request

> "The app in `/home/wilhelm/dev/mp/river-rsvp/` allows to login with a @revival.com email
> address. make it happen here as well but allow the backdoor via admin creds in .env file
> `/implement`"

---

## 1. Requirement as understood

1. Winner App gains **Google sign-in restricted to the `revival.com` Google Workspace domain** —
   the same mechanism RiverRSVP uses.
2. The **existing `ADMIN_USERNAME` / `ADMIN_PASSWORD` login from `.env` stays** as an explicit
   backdoor (needed: scanner volunteers and non-Workspace operators have no `@revival.com`
   account).
3. Both paths must land in the **same session cookie** the app already uses, so nothing
   downstream changes.

**Deliberate difference from RiverRSVP:** RiverRSVP additionally requires the email to exist in
its `AppUser` table (an admin-managed allow-list). Winner App has no user store and none was
requested, so **any verified `@revival.com` Workspace account may sign in**. An allow-list can be
layered on later without changing the token-verification code.

---

## 2. How RiverRSVP does it (verified by reading the source)

| Concern | RiverRSVP | File |
|---|---|---|
| Flow | Google Identity Services (GIS) **ID-token only** — no code exchange, no client secret, no Google API scopes | `Web/Endpoints/AuthEndpoints.cs` |
| Frontend | Loads `https://accounts.google.com/gsi/client`, `id.initialize({client_id, callback, hosted_domain, auto_select:false})`, `id.renderButton(...)` | `Client/src/routes/login/+page.svelte` |
| Bootstrap | Public `GET /api/auth/config` returns `{ clientId, hostedDomain }` — both are public values, not secrets | `AuthEndpoints.GetConfig` |
| Verification | `GoogleJsonWebSignature.ValidateAsync` with `Audience = ClientId`, `HostedDomain = "revival.com"` | `AuthEndpoints.Verify` |
| Defense in depth | Re-checks `payload.HostedDomain` and `payload.EmailVerified` after validation | `AuthEndpoints.Verify` |
| Config | `ClientId` + `HostedDomain` committed **non-secret** in `appsettings.json`; required, `ValidateOnStart` | `Web/Auth/GoogleAuthOptions.cs`, `Web/appsettings.json` |
| Rate limit | `/verify` has a dedicated `"auth"` limiter | `AuthEndpoints` |
| Session | Cookie scheme, 30-day sliding | `Web/Auth/AuthenticationExtensions.cs` |

RiverRSVP's client ID: `137921929588-atf59aq401qv7mlsn83q45h0gv24r9jf.apps.googleusercontent.com`
(hosted domain `revival.com`).

---

## 3. Winner App's current auth (verified by reading the source)

- `backend/routes/auth.ts` — `POST /api/login` (plain `===` compare against
  `process.env.ADMIN_USERNAME`/`ADMIN_PASSWORD`), `POST /api/logout`, `GET /api/session`.
  Sessions are a `Map<token, {username, createdAt}>` persisted atomically to
  `data/sessions.json`; 3-day fixed lifetime; hourly sweep.
- `backend/middleware.ts` — `sessionAuth` with `publicPaths = ['/health','/login','/logout','/session']`;
  `securityHeaders` sets a CSP for non-`/api/` paths; `generalLimiter` / `strictLimiter`.
- `backend/server.ts` — `pageAuth` redirects unauthenticated page loads to
  `/login?redirect=…`; `mainRouter` is mounted at **both** `/` and `/win`.
- `login.html` — Inter/gradient/white-card design, username+password form posting to
  `/api/login`; error box; loading spinner on the button.
- `vite.config.js` — dev-only `sessionAuthPlugin` that mirrors `pageAuth` by probing
  `http://localhost:3001/api/session`.
- **No sign-out UI exists anywhere in the app today.**

### Blocking pre-existing defect (already recorded in `tasks/audit-2026-07-19.md`, still unfixed)

`server.ts` registers the guards at app level:

```ts
app.use('/api', generalLimiter);
app.use('/api', sessionAuth);
...
app.use('/',    mainRouter);   // mainRouter.use('/api', apiRouter)
app.use('/win', mainRouter);
```

`app.use('/api', …)` does not match `/win/api/...`, so **`/win/api/*` reaches every API route
with no authentication and no rate limit.** Adding Google sign-in on top of this is theatre —
the door we are hardening has an unlocked one next to it. Fixing it is therefore treated as
**in scope**, not as a bolted-on improvement:

```ts
mainRouter.use('/api', generalLimiter, sessionAuth, apiRouter);   // guards travel with the router
```

---

## 4. Proposed approach

### 4.1 Backend — token verification

Add **`google-auth-library`** (Google's official Node client) and verify with
`OAuth2Client.verifyIdToken({ idToken, audience: clientId })`. It fetches and caches Google's
JWKS, checks signature, `iss`, `aud`, `exp` and clock skew. No hand-rolled JWT parsing; no
`tokeninfo` HTTP round-trip per login.

**Node version constraint (verified against the npm registry and the Node release schedule):**

| Package | Requires | Note |
|---|---|---|
| `google-auth-library@11.0.2` (latest) | Node **>= 22** | |
| `google-auth-library@^10.9.1` | Node **>= 18** | works on the current image |

`Dockerfile` currently builds and runs on `node:20-alpine`. **Node 20 reached end-of-life on
2026-04-30** — it is already receiving no security updates. Recommendation: bump both stages to
`node:22-alpine` (LTS, EOL 2027-04-30) and take `google-auth-library@^11`. Fallback if the base
image must not move: pin `google-auth-library@^10`.

### 4.2 Backend — endpoints

New, mirroring RiverRSVP's shape:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/auth/config` | public | `{ clientId, hostedDomain }` for GIS bootstrap |
| `POST` | `/api/auth/google` | public, `strictLimiter` | verify credential → session cookie |

Verification sequence in `POST /api/auth/google` (all failures logged with reason, generic
message returned to the client):

1. `verifyIdToken({ idToken: credential, audience: clientId })` → `401` on `InvalidJwt`.
2. `payload.hd` equals the configured hosted domain, case-insensitively → `403`
   *"Only @revival.com accounts are permitted."*
3. `payload.email_verified === true` → `403`.
4. `payload.email` ends with `@<hostedDomain>` (defense in depth beyond `hd`) → `403`.
5. Mint session `{ provider:'google', username: email, email, name, createdAt }`, persist, set
   the same `session` cookie, return `{ success:true, user:{ email, name, provider } }`.

Changes to existing endpoints:

- `POST /api/login` (**the backdoor — kept**): compare username **and** password with
  `crypto.timingSafeEqual` over SHA-256 digests (constant time, length-safe) instead of `===`
  — audit finding, and this is the exact line we are touching. Session gains
  `provider:'admin'`. Add `strictLimiter` (audit finding: the shared admin password currently
  sits behind only the 100/min general limiter).
- `GET /api/session`: also returns `email`, `name`, `provider` so the UI can show who is signed
  in.
- `Session` type gains `provider: 'google' | 'admin'` and optional `email` / `name`. Sessions
  already persisted in `data/sessions.json` predate Google sign-in, so on load a record with no
  `provider` is read as `'admin'` — that is factually what it is, not a masking default. Written
  as an explicit, commented migration step in `loadSessions()`.

### 4.3 Backend — configuration (fail-fast)

New module `backend/config.ts` export (or `backend/auth-config.ts` if `config.ts` grows too
broad) validated **once at startup**, before `app.listen`, following RiverRSVP's
`ValidateOnStart`:

- `ADMIN_USERNAME`, `ADMIN_PASSWORD` — required, from `.env`. Today a missing value is only
  discovered when someone tries to log in (a 500 at 8:55pm before an event). Startup validation
  moves that to deploy time.
- `GOOGLE_CLIENT_ID`, `GOOGLE_HOSTED_DOMAIN` — required. See §7 Q2 for whether these carry a
  committed default (RiverRSVP's pattern — the client ID is the OAuth audience, not a secret) or
  are env-only.

Failure prints exactly which variable is missing and exits non-zero, so `docker-compose up`
surfaces it in `docker logs` instead of serving a broken login page.

### 4.4 Backend — CSP and public paths

`securityHeaders` currently blocks GIS outright: `script-src` has no `accounts.google.com`, and
`frame-src 'none'` — the rendered Google button is an iframe. Per Google's CSP guidance
(<https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid>, GIS CSP
guidance) add:

```
script-src  … https://accounts.google.com/gsi/client
frame-src   https://accounts.google.com/gsi/
connect-src 'self' https: https://accounts.google.com/gsi/
style-src   … https://accounts.google.com/gsi/
```

Google's guidance is to use the **parent URL** `https://accounts.google.com/gsi/` rather than
enumerating individual GIS endpoints, so that is what goes in every directive except `script-src`,
which Google documents as the exact file `…/gsi/client`.

`sessionAuth`'s `publicPaths` gains `/auth/config` and `/auth/google`.

### 4.5 Frontend — `login.html`

Keep the existing visual language exactly (Inter, `#0A4f7B → #5FA1F7` gradient, white 20px-radius
card, existing `.form-input` / `.login-btn` / `.error-message` / `.spinner` rules). Add:

1. `GET ./api/auth/config` on load → load `https://accounts.google.com/gsi/client` →
   `id.initialize({ client_id, callback, hosted_domain, auto_select:false })` →
   `id.renderButton(el, { theme:'outline', size:'large', text:'signin_with', width:… })`.
2. On credential: `POST ./api/auth/google` → on success follow the `?redirect=` logic, **fixed**
   (see §4.5.1) and shared by both sign-in paths rather than duplicated.
3. **Google is the primary path**; the admin form moves behind a `<button aria-expanded>`
   disclosure labelled *"Sign in with admin credentials"*, below a divider. It is a backdoor, so
   it should not be the front door — but it stays fully keyboard reachable and is visible in the
   default, nothing-configured state (no JS required to discover it).
4. States covered: initial skeleton while the config request is in flight; GIS script blocked or
   offline (→ show the admin form expanded, with an explanatory message, rather than a dead
   page); `403` wrong domain (server message shown verbatim); `401`; `5xx`; `fetch` throw.
5. Accessibility: `role="alert"` + `aria-live="assertive"` on the error box (currently neither),
   focus moved to the error on failure, `aria-expanded` / `aria-controls` on the disclosure,
   focus into the username field when it expands.
6. Responsive width: `renderButton` takes a fixed pixel `width`, so it is computed from the
   container at render time (and re-rendered on a debounced `resize`) to line up with the
   full-width `.login-btn` instead of sitting at GIS's content-sized default.

#### 4.5.1 Open redirect in the existing success path — must be fixed here

`login.html` today ends a successful sign-in with:

```js
const redirect = new URLSearchParams(window.location.search).get('redirect') || '/';
window.location.href = redirect;
```

The value is **never validated**, so `https://win.revival.com/login?redirect=https://evil.example/`
signs the operator in and then hands them to an attacker-controlled page that can convincingly
ask for the credentials again. This is the exact line the Google path has to reuse, so it is not
an unrelated improvement — it is a defect in the code being rewritten, and CLAUDE.md's precedence
puts security (3) above minimal diff (6).

Fix: resolve the parameter against the current origin and accept it only if it stays there —
`const url = new URL(redirect, location.origin); if (url.origin !== location.origin) → './'` —
which also rejects the protocol-relative `//evil.example` form. One helper, used by both the
Google and the admin path.

`src/js/modules/session.js` builds its `?redirect=` from `location.pathname + location.search`,
so it is same-origin by construction and needs no change.

### 4.6 Frontend — sign-out (new)

There is no way to sign out today. Both pages get one, reusing existing patterns:

- `index.html`: two items at the top of the existing Management settings dropdown — a disabled
  `dropdown-item-text` showing *"Signed in as `<email>`"* and a *"Sign out"* `dropdown-item`,
  then a `dropdown-divider`.
- `scan.html`: a *"Sign out"* entry in the header (the scanner header already has icon buttons
  and an operator button to match).
- New `src/js/modules/auth.js`: `getSession()` (`GET ./api/session`) and `signOut()`
  (`POST ./api/logout` → `location.href = './login'`). Small, single-purpose module consistent
  with the existing `src/js/modules/*` layout.

### 4.7 Docs / config files

- `.env.example` — document `GOOGLE_CLIENT_ID` and `GOOGLE_HOSTED_DOMAIN` alongside the existing
  admin block.
- `PROJECT.md` — short "Authentication" subsection describing the two paths.
- **`deploy.sh` excludes `.env` from the rsync**, so the production `.env` at `/srv/win/.env`
  must be updated by hand before the next deploy if the values are env-only (see §7 Q2).

---

## 5. Files touched

| File | Change |
|---|---|
| `package.json` | add `google-auth-library`; add `engines.node` so the version floor fails loudly at install rather than at runtime |
| `Dockerfile` | `node:20-alpine` → `node:22-alpine` (both stages) — see §4.1 |
| `backend/config.ts` | Google + admin auth config, validated at startup (fail-fast) |
| `backend/routes/auth.ts` | `GET /auth/config`, `POST /auth/google`; timing-safe admin compare; `provider`/`email`/`name` on the session; richer `GET /session` |
| `backend/middleware.ts` | CSP for GIS; `publicPaths` += `/auth/config`, `/auth/google` |
| `backend/server.ts` | guards moved into `mainRouter.use('/api', …)`; startup config validation |
| `login.html` | Google button + disclosure-gated admin form, all states, a11y, **open-redirect fix** |
| `index.html` | "Signed in as …" + "Sign out" in the settings dropdown |
| `scan.html` | "Sign out" in the scanner header |
| `src/js/modules/auth.js` | **new** — session probe + sign-out |
| `.env.example`, `PROJECT.md` | document the new variables and the two sign-in paths |

Not touched: `svelte/` (in-progress SvelteKit rewrite, not built or deployed — `Dockerfile` builds
only the root Vite app), `src/js/modules/session.js` (its `./login` link keeps working unchanged).

---

## 6. Impact on existing functionality

- **Existing admin logins keep working** — same endpoint, same cookie, same redirect behaviour.
- **Existing live sessions survive** the deploy (`data/sessions.json` is read with the documented
  legacy-record rule).
- `/win/api/*` stops being an unauthenticated hole. **Anything that was relying on that hole will
  break** — nothing in this repo calls it, but an external script or monitor might. Worth a
  moment's thought before approving.
- `strictLimiter` on `/login` is 10 requests/min **in production only** (it is skipped when
  `NODE_ENV !== 'production'`). A rapid-retry operator on a bad password could hit it; the error
  message says so.
- Container refuses to start if the Google config is missing (fail-fast) — deliberate, but it
  means the env must be in place before the next deploy.

---

## 7. Decisions (answered 2026-09-02)

| # | Decision | Consequence |
|---|---|---|
| **Q1** | **Reuse RiverRSVP's OAuth client** `137921929588-atf59aq401qv7mlsn83q45h0gv24r9jf.apps.googleusercontent.com` | The three origins below must be added to it in Google Cloud Console — **user action, outside this repo** |
| **Q2** | **Env-only, fail-fast** | `GOOGLE_CLIENT_ID` + `GOOGLE_HOSTED_DOMAIN` are required; the server refuses to start without them. `/srv/win/.env` **must be edited before the next deploy** (`deploy.sh` excludes `.env` from the rsync) |
| **Q3** | **Consolidate under `/api/auth/*`** | `/api/login` → `/api/auth/login`, `/api/logout` → `/api/auth/logout`, `/api/session` → `/api/auth/session`, plus the two new routes. Three call sites updated |
| **Q4** | **All extras included** | `/win/api/*` guard fix, open-redirect fix, `strictLimiter` + timing-safe compare, sign-out UI, Node 22 + `google-auth-library@^11` |

**Required Google Cloud Console change (user):** add to *Authorized JavaScript origins* on the
RiverRSVP OAuth client — `https://win.revival.com`, `http://localhost:3000`,
`http://localhost:3001`. Until this is done, GIS returns `origin_mismatch` and the Google button
will not sign anyone in; the admin backdoor is unaffected.

---

## 7b. Original open questions (kept for the record)

**Q1 — Google Cloud Console (cannot be verified from here; blocking for the live walkthrough).**
GIS only works from origins listed under *Authorized JavaScript origins* on the OAuth client.
Needed: `https://win.revival.com`, `http://localhost:3000` (Vite), `http://localhost:3001`
(Express direct).
 - **(a) New OAuth Web client for Winner App** *(recommended)* — separate origin list, separate
   consent-screen branding, revocable independently of RiverRSVP.
 - **(b) Reuse RiverRSVP's client** `137921929588-…` — add the three origins to it.
Either way this is a change **you** must make in Google Cloud Console; I cannot.

**Q2 — Where do `clientId` / `hostedDomain` live?**
 - **(a) Committed default in `backend/config.ts`, env-overridable** *(recommended — RiverRSVP's
   own pattern)*. Neither value is a secret; the client ID is the OAuth audience. No production
   `.env` edit needed, and `deploy.sh` excludes `.env` from the rsync.
 - **(b) Env-only, fail-fast** — stricter, but the server `.env` at `/srv/win/.env` must be
   edited by hand before the next deploy or the container will not start.

**Q3 — Endpoint shape.**
 - **(a) Add `/api/auth/config` + `/api/auth/google`, leave `/api/login`, `/api/logout`,
   `/api/session` where they are** — smallest diff, but two shapes for one concern.
 - **(b) Consolidate everything under `/api/auth/*`** *(recommended)* — one coherent shape
   matching RiverRSVP. Only three call sites exist (`login.html`, `vite.config.js`'s dev plugin,
   `middleware.ts`'s `publicPaths`), all in this repo, so the churn is small and contained.

**Q4 — Scope of the extras.** Include, or drop from this change?
 - Sign-out UI (§4.6) — the app currently has none at all.
 - `/win/api/*` guard fix (§3) — **strongly recommend including**; without it the feature is
   decorative.
 - `strictLimiter` on `/login` + timing-safe compare (§4.2) — both are audit findings on the
   exact lines being edited.
 - Open-redirect fix in `login.html` (§4.5.1) — **strongly recommend including**; it is on the
   success path both sign-in methods share.
 - Node 22 bump (§4.1) — required for `google-auth-library@11`; avoidable by pinning `@10`.
 - *Optional nicety:* pre-fill the scanner's `operatorName` (currently a manual localStorage
   value) from the signed-in Google user's name when it is empty.

---

## 8. Edge cases and trade-offs

| Case | Handling |
|---|---|
| Personal Gmail account | No `hd` claim → rejected at step 2 with the domain message |
| `@revival.com` alias on a non-Workspace account | `hd` mismatch → rejected; email-suffix check is the second gate |
| Unverified Workspace email | `email_verified === false` → rejected |
| Expired / replayed ID token | `exp` enforced by `verifyIdToken` (Google tokens live ~1 h) |
| GIS script blocked (CSP, ad-blocker, offline) | Admin form auto-expands with an explanatory message |
| `/api/auth/config` unreachable | Same fallback; login is never a dead page |
| Google outage | Admin backdoor is unaffected — that is the point of keeping it |
| Session file from before this change | Read as `provider:'admin'`; no forced sign-out |
| Two tabs, one signs out | Next API call 401s → the existing `showSessionExpired()` overlay fires |
| `?redirect=` pointing off-site | Rejected by the same-origin check (§4.5.1); falls back to `./` |

**Not doing, and why:** a GIS `nonce`. It guards against ID-token replay; the token is
audience-bound, ~1 h-lived and travels only over HTTPS to our own origin, and RiverRSVP — the
reference — does not use one. Adding it means server-side nonce issuance and storage. Flagged
here rather than silently skipped; say the word and it goes in.

**Not doing, and why:** RiverRSVP's anti-forgery token on sign-out. Its cookie scheme needs one;
Winner App's session cookie is already `sameSite: 'lax'`, which stops a cross-site `POST` from
carrying the cookie at all. Copying the CSRF machinery would add a token endpoint and a header
round-trip that protect nothing extra here.

**Not doing, and why:** One Tap / `auto_select`. `renderButton` only, matching RiverRSVP. One Tap
drags in the FedCM migration surface and third-party-cookie behaviour for no gain on a
staff-operated app.

---

## 9. Verification plan (Phase 5 — the feature is not done until this passes)

1. `npm run build` (Vite + `tsc -p tsconfig.backend.json`) clean.
2. Start the real server against the real `data/` layer; confirm the port is bound by *this*
   process before trusting any response.
3. **Puppeteer walkthrough** (`puppeteer` is already a devDependency; script written to the
   session scratchpad, not the repo):
   - Load `/login` **from the default state** — assert the Google button iframe actually rendered
     (not merely "no error"), and assert the admin disclosure is **discoverable and operable with
     nothing configured**, using only what is on screen.
   - Expand the disclosure, sign in with the real `.env` admin credentials, assert the app shell
     rendered, assert *"Signed in as …"* is present in the settings dropdown.
   - Sign out; assert the redirect to `/login` and that a subsequent `/` load redirects to login.
   - Screenshots at each step, **looked at**, not just asserted on.
4. **Negative tests against the running server** (these are what prove the gate is real):
   - `POST /api/auth/google` with a syntactically valid but forged JWT → `401`, no cookie set.
   - `POST /api/auth/google` with a token for a non-`revival.com` `hd` → `403`.
   - `GET /win/api/winners` with no cookie → `401` (regression test for §3).
   - `GET /api/auth/config` unauthenticated → `200` with the right client ID.
   - `/login?redirect=https://example.com/` → after a successful sign-in the browser is on
     `win.revival.com`, not `example.com` (regression test for §4.5.1).
5. Restore anything mutated in a `finally`; `data/sessions.json` backed up first and verified
   against the backup at the end.
6. Re-run the whole walkthrough after the **last** change, cosmetic ones included.

---

## 9b. Verification results (2026-09-02, against the built app on :3001)

**Build:** `npm run build` clean (Vite + `tsc -p tsconfig.backend.json`, `--noEmit` exit 0).

**Server-side gates (curl against the running server):**

| Probe | Result |
|---|---|
| `GET /api/auth/config` (no cookie) | `200`, correct client ID + `revival.com` |
| Forged JWT — correct `aud`, `hd`, `email_verified`, `@revival.com`, bad signature | `401`, **no cookie set** |
| `POST /api/auth/google` with no / non-string / garbage credential | `400` / `400` / `401` |
| `POST /api/auth/login` wrong password / empty body | `401` / `400` |
| `POST /api/prizes` (no cookie) | `401` |
| `POST /win/api/prizes` (no cookie) | `401` |
| Pre-existing session record with no `provider` field | authenticates, reported as `provider: "admin"` — **no forced sign-out on deploy** |

**The `/win/api/*` bypass, proven rather than assumed.** The pre-change backend was rebuilt from
`git archive HEAD` and run on :3002 alongside the fixed one:

| | `POST /win/api/prizes`, no cookie |
|---|---|
| Before (HEAD) | **`200` — the record was written** |
| After | `401` |

The GET form returned `302` both before and after (the `mainRouter.get('*')` catch-all absorbs it
under the `/` mount), so the exposure was confined to non-GET methods — which is the whole of the
write surface. Probe writes landed in the throwaway tree, not `data/`; verified.

**Browser walkthrough (Puppeteer, from a clean profile): 22/22 checks passed.**
Unauthenticated `/` → login; Google button genuinely rendered (not merely "no error"); admin
disclosure discoverable and operable from the default state, found by its visible label; focus
moves into the username field; wrong password rejected in place; sign-in lands on the app;
Management → settings dropdown opened and *"Signed in as admin"* + *"Sign Out"* asserted
**visible on screen** (an earlier pass asserted DOM presence only and would have passed with the
menu unreachable — screenshots caught it); sign-out returns to login and the session is really
gone; `?redirect=https://example.com/phish` refused while `?redirect=/scan` still honoured;
scanner sign-out present and wired to the real implementation. Screenshots reviewed at each step.

**`data/sessions.json` backed up before the run and restored byte-identical afterwards; no other
file under `data/` was touched.**

### ⚠️ Not verified, and it blocks the Google path

The run logged, repeatedly:

```
[GSI_LOGGER]: The given origin is not allowed for the given client ID.
```

`http://localhost:3001` is **not yet** an authorized JavaScript origin on the RiverRSVP OAuth
client, so no Google sign-in can currently succeed from anywhere this app is served. Everything
up to the click is proven working — config endpoint, CSP, GIS load, button render, and the
server-side verification of a token — but **the end-to-end Google sign-in has not been executed
and cannot be until the Q1 console change is made** (§7). Note also that GIS renders the button
regardless, so the page's own "unavailable" fallback does **not** catch this case: it shows up as
a console error and a click that goes nowhere.

The admin backdoor is fully verified end-to-end and unaffected.

---

## 10. Task list

1. Confirm Q1–Q4 with the user. *(gate)*
2. `google-auth-library` + Node bump; config module with startup validation.
3. `POST /api/auth/google`, `GET /api/auth/config`; session shape; timing-safe admin compare;
   `strictLimiter`.
4. `middleware.ts` CSP + `publicPaths`; `server.ts` guard placement.
5. `login.html` — Google button, disclosure-gated admin form, all states, a11y.
6. Sign-out module + `index.html` / `scan.html` entry points.
7. `.env.example`, `PROJECT.md`.
8. `/inspect-fix`.
9. Build + Puppeteer walkthrough + negative tests.
10. `/commit`.
