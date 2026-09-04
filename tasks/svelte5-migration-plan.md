# Svelte 5 (runes) migration — implementation plan

Supersedes the sketch in `tasks/todo.md`, which stops at Phase 1 and predates the Alpine
migration, the Google sign-in work and `src/css/responsive.css`. Keep that file for the
Alpine→Svelte mapping table at its end; everything else here is authoritative.

**Branch:** `svelte5-runes`, in the worktree `.claude/worktrees/svelte5`.
**Backend:** unchanged in behaviour. Two small edits only, both listed in §3.4.

---

## 1. What is being replaced

| Layer | Today | After |
|---|---|---|
| Framework | Alpine.js 3.15 from a CDN, 8 stores declared inline in `index.html` | Svelte 5, runes, `src/lib/state/*.svelte.ts` |
| Component model | 3 700 lines of HTML + `x-data` islands | `.svelte` components under `src/lib/components` |
| Business logic | 15 000 lines of untyped ES modules in `src/js/` | Typed modules in `src/lib/services` |
| Routing | one page, Bootstrap tabs, a persisted `ui.currentTab` | SvelteKit routes — real URLs, real back button |
| Build | Vite, 4 HTML entry points | SvelteKit + `adapter-static`, same `dist/` output |
| Bootstrap JS | tabs, modals, dropdowns, tooltips + two monkey-patches | removed (§3.3) |
| Toasts | Toastify from a CDN | in-app, `aria-live`, undo-capable |
| Backend | Express + JSON collections | unchanged |

Pages: `/` (setup) · `/lists` · `/prizes` · `/templates` · `/winners` · `/history` ·
`/queries` · `/settings` · `/present` (public draw) · `/scan` · `/login` · `/conditions`.

---

## 2. Non-negotiables (parity contract)

These are behaviours the rewrite must not lose. Sources: the Alpine markup inventory, the
module audit and the backend contract gathered at the start of this migration.

### 2.1 Persistence keys — must not change
Renaming any of these silently resets a live operator's setup mid-event.

- `settings_<key>` — 26 keys, the exact list in §4.2.
- `setup_selectedListIds`, `setup_selectedPrizeId`, `setup_winnersCount`
- `ui_view`, `ui_currentTab`
- `winners_filter_prize`, `winners_filter_list`, `winners_filter_batch`, `winners_filter_date`
- `history_filter_list`, `history_filter_prize`, `history_filter_date`
- `settings` — the whole-object localStorage cache read on boot before the server answers

### 2.2 Record shapes — every field name is load-bearing
`Winner`, `List`, `Prize`, `HistoryEntry`, `Template`, `Backup` and the `sms` sub-object the
backend writes onto winners are all pinned in `src/lib/types/index.ts`. `POST /api/<collection>`
**replaces** a document wholesale (only `settings` merges), so a partial write destroys fields.
Every mutation therefore round-trips the full record or uses `PUT`.

### 2.3 The draw algorithm
Cryptographic RNG (`crypto.getRandomValues`), Fisher-Yates, the **triple shuffle** (shuffle all →
shuffle again → shuffle the selected slice), and selection running **in parallel** with the
pre-selection delay. Unit-tested for uniformity and for "every entry is a candidate".

### 2.4 Eligibility and removal rules
- Duplicate entry ids across selected lists collapse to one candidate; entries with no id are
  never deduplicated.
- `preventSamePrize` excludes entries that already won **the same prize name**.
- Removal after a draw: `list.metadata.listSettings.removeWinnersFromList ?? settings.preventDuplicates`
  — the per-list value wins, and an explicit `false` is honoured.
- Undo restores prize quantity, deletes the winners and the history entry, and puts entries back
  only when the draw actually removed them. Undo is refused once SMS has been sent.

### 2.5 Backend contract
- All API paths are **relative** (`./api/...`) so the app works under any mount.
- `credentials` are same-origin; the `session` cookie is `httpOnly` and unreachable from JS.
- A `401` from any `/api/*` call means "session expired" and must route to `/login` — never be
  rendered as empty data.
- No trailing slashes on `/api/*` (the public-path allowlist is exact-match).
- Batch multiple writes to one collection into a single `POST /api/batch-save`; the store has no
  locking, so two separate calls to the same collection lose one of the two writes.
- CSP forbids `<base href>` and `<object>`; no new CDN may be added without editing
  `backend/middleware.ts`. `Referrer-Policy` and `Cross-Origin-Opener-Policy` stay as they are —
  reverting either breaks Google sign-in with a misleading error.

---

## 3. Architecture decisions

### 3.1 The app lives at the repo root, not in `svelte/`
`tasks/todo.md` proposed staging the rewrite in `svelte/` and swapping it in later. The staging
step buys nothing here — this migration already runs in its own worktree on its own branch, which
is the isolation that `svelte/` was standing in for.

Keeping it nested would cost: a second `package.json`, a second dependency tree, a second Vite
config, a build that has to emit into `../dist`, and a Dockerfile that installs twice. That is two
of everything to keep in step forever, for no isolation benefit.

At the root, `pnpm build` still means `vite build && tsc -p tsconfig.backend.json`, still emits
`dist/`, and **`Dockerfile`, `docker-compose.yml` and `deploy.sh` do not change at all**.

*Rule Precedence applied: robustness (2) and maintainability (4) over consistency with the sketch
(5) and minimal diff (6).*

### 3.2 `adapter-static` in SPA mode, not `adapter-node`
Express already owns sessions, the JSON collections and page-level auth. `adapter-node` would add
a second Node server that duplicates that contract, or an in-process mount that complicates both.
`adapter-static` with `fallback: 'index.html'` emits exactly what Express already serves.

`ssr = false` is set once in `src/routes/+layout.ts`. Every screen depends on browser-only APIs —
`BarcodeDetector`, `getUserMedia`, `AudioContext`, Fullscreen, canvas, `localStorage` — so
server rendering would buy nothing and cost a class of hydration bugs.

### 3.3 Bootstrap CSS stays, Bootstrap JS goes
Bootstrap's stylesheet is the app's design system and stays (from npm now, not a CDN, so it
works offline and stops depending on jsdelivr being in the CSP).

Bootstrap's **JavaScript** is removed. It is the direct cause of two live workarounds:

- `index.html:2417` monkey-patches the global `JSON.parse` to swallow Bootstrap 5.3's parse
  errors on `data-bs-toggle` values.
- `index.html:2441` wraps `document.body.getAttribute` so Bootstrap's `ScrollBarHelper` stops
  throwing on nested modals — with a TODO admitting the real fix is not nesting modals.

Both disappear when the components are Svelte's:
- **Modals** → native `<dialog>` (`showModal()` gives focus trapping, Esc and an inert backdrop
  for free, which the current markup does not have).
- **Tabs** → a routed nav with proper `aria-current`, roving tabindex and arrow-key movement.
- **Dropdowns** → a small Svelte component with typeahead, Home/End, Esc and click-away.
- **Tooltips** → an attachment on `[title]`-carrying elements, honouring `prefers-reduced-motion`.

*Rule Precedence applied: correctness (1) and robustness (2) over consistency (5). Patching a
global JSON parser is the pattern that allowed the defect, so matching it would reproduce it.*

### 3.4 The two backend edits
1. `server.ts` page routes: `/login` and `/conditions` (public) and `/`, `/scan` plus the `*`
   fallback (auth-gated) all serve the one SPA shell `dist/index.html`. The four separate HTML
   files no longer exist.
2. The legacy `/win` mount: `/win/api/*` keeps working untouched, but `/win` **page** requests
   now `301` to the canonical path. A client-side router is compiled for exactly one base path;
   served under a second prefix it would 404 on every internal link. A redirect makes old
   bookmarks work and removes the whole class of base-path bugs the audit found (the `/login`
   redirect that drops the prefix, the absolute `/uploads/...` in upload responses, and any
   absolute `/api` in the client).

### 3.5 State: rune classes, one module per domain
`src/lib/state/*.svelte.ts`, each exporting a single instance:

| Module | Owns |
|---|---|
| `settings.svelte.ts` | the 26 settings, theme application, debounced persistence |
| `data.svelte.ts` | lists, prizes, winners, history, templates + load/save/delete |
| `setup.svelte.ts` | selected lists, selected prize, winner count, eligibility |
| `draw.svelte.ts` | draw state machine: idle → delaying → selecting → revealed |
| `winnerFilters.svelte.ts`, `historyFilters.svelte.ts` | filters, sorting, cascading options |
| `ui.svelte.ts` | theme, progress overlay, toasts, confirm queue |
| `session.svelte.ts` | signed-in user, 401 handling |

Rules: `$state` for owned values, `$derived` for anything computed, `$effect` **only** for
side effects that leave the component (persistence, canvas, audio, network). No `$effect` that
merely copies one piece of state into another — that is the anti-pattern the current
`Alpine.effect` winner-count cap is written as, and it becomes a `$derived` here.

Because the app is a SPA (`ssr = false`), module-level state is per-browser-tab and safe.

### 3.6 The selection worker becomes a real module worker
Today it is a template string → `Blob` → `createObjectURL`, and neither the URL nor the `Worker`
is ever released — one leaked worker per draw. It becomes `src/lib/workers/selection.worker.ts`,
instantiated with `new Worker(new URL(...), { type: 'module' })`, terminated in the `$effect`
teardown, and typed on both sides. The unused `seed` parameter is dropped rather than left as a
promise the code does not keep.

---

## 4. Parity checklist

### 4.1 Screens
- [ ] **Setup** — list multi-select with live eligible/excluded counts, prize combobox with
  quantity and default-winners badges, winner count with the two over-limit warnings, reveal
  settings, delay settings, celebration settings, three sound selectors with test buttons.
- [ ] **Lists** — sort pills (md+) and sort dropdown (below md), select-all / clear-all, add via
  CSV / Pretix report / Ministry Platform, cards with MP-sync badge, selection badge, entry
  count, upload date, sync date (never showing a 1970 date), per-card action drawer
  (settings / archive / delete) and sync / view, empty state.
- [ ] **Import wizard** — 5 steps (Record ID, Import Options, Winner Behavior, Display Name,
  Card Display), clickable progress rail, "Use Defaults" shortcut, live name and card previews,
  available-field chips that insert at the caret, ID auto-detection with the "Auto-selected"
  badge, duplicate/empty ID validation, data preview table with `data-label` stacking.
- [ ] **Prizes** — sort pills + dropdown, add/edit/delete, select toggle, quantity and winner
  badges, SMS template association, empty state.
- [ ] **Templates** — grid, add/edit/delete, set-default, placeholder list derived from the
  selected lists' first entry.
- [ ] **Winners** — 4 cascading filters (prize / list / batch / date), 6 sortable columns,
  pickup toggle, return-to-list, delete, SMS status badges, check-SMS-status, CSV export,
  clear-all (respecting the active filter), stacked cards below md.
- [ ] **History** — 4 stat cards, 3 filters, 4 sortable columns, delete.
- [ ] **Queries** — MP query CRUD, parameter editor with rename/add/remove, `fetchParentPhone`,
  category, loading and empty states.
- [ ] **Settings** — general toggles, webhook, sound upload + list, theme colours, font, 6
  presets, background type (gradient / solid / image with gallery + upload), display ratio,
  display font size.
- [ ] **Present** — letterboxed display stage honouring the ratio, prize header, 4 info cards,
  big play button, winners grid with the 5 display effects, countdown, 4 delay visuals,
  celebration canvas, fullscreen, undo / new / send-SMS.
- [ ] **Scan** — camera engines with fallback, manual entry, pickup marking, winner search.
- [ ] **Login / Conditions** — Google Identity Services + admin fallback, redirect handling.

### 4.2 The 26 settings keys
`preventDuplicates`, `preventSamePrize`, `hideEntryCounts`, `enableDebugLogs`, `enableWebhook`,
`webhookUrl`, `fontFamily`, `primaryColor`, `secondaryColor`, `selectionColor`, `backgroundType`,
`customBackgroundImage`, `displayRatio`, `displayFontSize`, `selectionMode`, `displayEffect`,
`displayDuration`, `stableGrid`, `preSelectionDelay`, `delayVisualType`, `soundDuringDelay`,
`soundEndOfDelay`, `soundDuringReveal`, `celebrationEffect`, `celebrationDuration`,
`celebrationAutoTrigger` — plus `skipExistingWinners`, which today exists only in the vanilla
object and never reaches the store. One typed `Settings` interface covers all 27; the split is
the bug, not the spec.

### 4.3 Keyboard
`p` play · `t` text · `u` undo · `f` fullscreen · `n` new · `m` manage · `v` toggle view — all
active only on the public view and never while an input has focus. Added: `?` opens a shortcut
help dialog, and `Esc` closes any open dialog.

---

## 5. Defects fixed as part of the migration

Each of these is a real defect found in the audit, not a preference. Fixing them is cheaper
during the rewrite than after it, and several are what the rewrite is for.

| # | Defect | Disposition |
|---|---|---|
| 1 | `Settings.settings` is `undefined`, so backup/restore silently never includes settings | Fixed — one typed settings source |
| 2 | `preventWinningSamePrize` is written per list but read nowhere | Wired up; the per-list rule now applies |
| 3 | Combined draws produce `historyEntry.listId === undefined` and a webhook with no list | Fixed — combined draws carry `sourceListIds` and a stable synthetic id |
| 4 | Selection worker and its object URL leak on every draw | Fixed — module worker, terminated |
| 5 | `displayWinnersSequential` never resolves if the effect fires no `animationend` | Fixed — awaited with a timeout ceiling |
| 6 | `stableGrid` cannot round-trip to the server | Fixed by the single settings model |
| 7 | `handleSaveSettings` cannot turn a checkbox **off** (`?.checked \|\| existing`) | Gone — two-way bindings |
| 8 | `getFromStore` returns `[]` on error, including for single-document reads | Fixed — errors throw, callers handle |
| 9 | `batchFetch` error path drops `collection:id` keys, so lists vanish mid-draw | Fixed — typed result, explicit per-key error |
| 10 | `initDB` does not throw on a non-OK health response | Fixed — fail fast |
| 11 | Stored XSS in templates, online-backup listing and the background gallery | Gone — Svelte escapes by default; no `innerHTML` |
| 12 | CSV import breaks on quoted fields containing newlines; export quoting corrupts on `"` and `,` | Fixed — RFC 4180 parse and serialise, unit-tested |
| 13 | Export ignores the date filter and mismatches archived list names | Fixed — export uses the same derived filter as the table |
| 14 | `resetToSelectionMode` sniffs `new Error().stack` to decide what to refresh | Gone — explicit argument |
| 15 | `pickupTimestamp` is `null` at creation but an ISO string when toggled | Normalised to epoch ms; reads tolerate legacy strings |
| 16 | `removeWinnersFromList` defaults to `settings.preventDuplicates` in the draw but `true` in the edit modal | One helper, one default |
| 17 | Eleven `setTimeout` waits standing in for reactivity | Gone — derived state and awaited transitions |
| 18 | `validateName`'s "dangerous characters" regex is a sequence, not a character class, so the check has never run | Removed deliberately: names with apostrophes are valid and rejecting them would be a regression. Output escaping is the real control, and Svelte does it. |
| 19 | `PORT` in `.env` was silently ignored: `config.ts` reads `process.env.PORT` at module scope, and `server.ts` called `dotenv.config()` *after* importing it | Fixed — `import 'dotenv/config'` is now the first import |
| 20 | No error-handling middleware anywhere, so a multer rejection or a blocked CORS origin came back as an **HTML** 500 that every JSON client mis-parsed | Fixed — one JSON error handler, client faults reported as 4xx |
| 21 | The sound upload never worked (see §6) | Fixed — real upload, list and delete endpoints on the persisted volume |
| 22 | `POST /api/settings` per key raced itself: each write reads the whole file and writes it back, so two in flight lost one | Narrowed — settings writes are debounced and coalesced into one `batch-save` |
| 23 | The CORS allowlist was applied to **same-origin** requests too, and a blocked origin threw a 500 rather than simply being refused | Fixed — same-origin always passes; a disallowed origin gets no CORS headers instead of an error. Found by the live pass: browsers fetch ES module scripts in CORS mode, so every one of the app's own JavaScript chunks now carries an `Origin`, and serving from any host not literally in the list rendered a blank page whose only symptom was a 500 on an asset `curl` fetched perfectly. |

### Not fixed here — deliberately
- **Prize quantity is a read-modify-write with no locking.** A true fix needs compare-and-set in
  the backend. The window narrows (one batched write per draw) but the race remains. Tracked
  separately.
- **Ministry Platform imports keep their raw field keys while CSV imports are camelised.**
  Camelising MP records would change the field names that existing saved lists' name and card
  templates reference, breaking live lists on their next sync. Documented instead.
- **TypeScript 6 / SvelteKit 3.** SvelteKit 3 is a release candidate and TypeScript 6 is outside
  the peer range of `@sveltejs/kit` and `svelte-check`. Pinned to SvelteKit 2.70 / TypeScript 5.9
  — an RC under a live event app is not a defensible risk. Revisit after SvelteKit 3 ships.
- **The giveaway-reports credentials are still in the client bundle.** `src/lib/api/client.ts`
  carries the same hardcoded Basic auth the old `reports.js` did, so anyone who can open the app
  can read them. The right fix is for `/api/reports-proxy` to attach its own credentials from the
  environment and stop forwarding the caller's header — but that needs two new required `.env`
  keys on the server, which would refuse to boot without them and break the next deploy. It wants
  doing deliberately, with the deploy in hand, not folded into this migration.

---

## 6. UX and accessibility work included

Beyond parity, because the rewrite is the only cheap moment to do them:

- **Real URLs** for every tab, so the back button, deep links and refresh all work.
- **Focus management** — `<dialog>` traps focus and restores it on close; route changes move
  focus to the page heading; a skip link precedes the nav.
- **Live regions** — toasts and the progress overlay announce; the winners table announces its
  filtered count.
- **`prefers-reduced-motion`** — celebrations, countdowns and reveal effects degrade to a plain
  cut. Today they always animate.
- **No theme flash** — the theme is applied from `localStorage` before first paint, and the
  choice is finally persisted (today `toggleTheme` is lost on reload).
- **Skeletons** instead of spinners where the layout is known (list, prize and winner grids).
- **Virtualised winners table** — the app is specified to 20 000 entries; the current table
  renders every row.
- **Optimistic pickup toggle and delete**, rolled back on failure, with an **undo toast** for
  destructive actions.
- **Empty states** with a real call to action rather than a bare icon and sentence.
- **Sound upload that works.** The old button downloaded the file to the operator's own machine,
  asked them to copy it into the source tree, and wrote metadata to a collection the backend
  rejects — so it always failed. Uploads now go to `data/uploads`, the persisted volume, which
  also means they survive a deploy; `public/sounds` is baked into the container image.

Considered and **not** done:

- **Filter state in the URL.** The winners and history filters already persist to localStorage
  under keys operators rely on. Putting them in the URL as well means two sources of truth for
  the same state, and the reconciliation rules are the kind that go wrong quietly. Left as is.
- **Re-enabling the PWA.** The service worker and the manifest link were removed deliberately in
  34b8b7b because the cached shell kept serving a stale build — the backend still sends
  `no-store` on every HTML response to finish that job. `public/manifest.json` stays orphaned
  rather than re-linked.

---

## 7. Phases

1. **Toolchain** — SvelteKit 2.70, Svelte 5.57, Vite 8, TypeScript 5.9 strict with
   `noUncheckedIndexedAccess`, `svelte-check`, ESLint 10 flat config, Prettier, Vitest.
2. **Foundation** — `types/`, `api/client.ts`, `state/*.svelte.ts`, `utils/`, design tokens.
3. **Shell** — layout, nav, toasts, dialogs, progress, theme, session guard.
4. **Screens** — in dependency order: Settings → Lists (+ import wizard) → Prizes → Templates →
   Setup → Present → Winners → History → Queries → Scan → Login.
5. **Services** — selection engine + worker, sounds, animations, export/backup, texting, MP,
   reports, PWA.
6. **Verification** — `svelte-check` clean, ESLint clean, unit tests green, production build,
   then a live pass against the real backend in a browser: every screen, a real draw, an undo,
   an import, a scan.
7. **Removal** — delete the Alpine app (`index.html`, `login.html`, `scan.html`,
   `conditions.html`, `src/js/`, `src/css/`, `src/main.js`, `scan/`, `svelte/`), update
   `PROJECT.md` and `docs/`.

---

## 7a. Two things the live pass caught that nothing else would have

Both were invisible to `svelte-check`, ESLint, the unit tests and the production build. They are
recorded here because each is a consequence of a deliberate architectural choice, and the next
person to touch that choice needs to know.

1. **Svelte `$state` proxies cannot be posted to a worker.** The draw sent its candidate entries
   to `selection.worker.ts`; entries come from `data.lists`, which is `$state`, so they are
   Proxies — and `postMessage` structured-clones. Every draw failed with "could not be cloned".
   The worker now takes a pool *size* and returns positions, which also means a 20 000-entry draw
   copies 20 000 integers instead of 20 000 objects, and the caller keeps the object identity it
   needs to map each winner back to its list.
2. **Module scripts are fetched in CORS mode.** See defect 23. The old app was a handful of
   classic scripts; a SvelteKit bundle is dozens of ES modules and dynamic imports, so the
   backend's origin allowlist suddenly gated the app's own JavaScript.

## 8. Verification

- `pnpm check` — zero errors and zero a11y warnings from `svelte-check`.
- `pnpm lint` — Prettier and ESLint clean.
- `pnpm test` — unit tests for the shuffle's uniformity, CSV round-tripping, eligibility and
  exclusion rules, template formatting, filter derivation and the settings defaults.
- `pnpm build` — a production build emitting `dist/`, served by the real Express server.
- Manual pass in a browser against the real backend, covering each screen in §4.1.
