# Claude Code prompts — performance and memory audit of winner-app

Written 2026-09-10 for the `svelte5-runes` tree (`.claude/worktrees/svelte5`), which was what
`deploy.sh` shipped at the time.

**Both of those are gone as of the cutover later that day.** `svelte5-runes` was merged into
`main` and deleted along with its worktree, so `main` *is* the Svelte tree now and these prompts
belong there — the reverse of the warning this paragraph used to carry. The retired Alpine files
(`src/js/…`, `index.html`) no longer exist on any branch; they are reachable only through history
before `ab77865`.

Every prompt drives the existing skill system. Bare `/tokens` in a typed prompt are enforced by
`hooks/skill-guard.py`: the `UserPromptSubmit` hook turns them into a manifest and the `Stop`
hook refuses to end the turn until each was invoked, including the skills a loaded skill body
names in turn (`/hunt` loads `/adhere`, `/best`, `/max`, `/cd`; `/solve` adds `/validate-plan`,
`/inspect-fix`, `/commit`). That is what makes these prompts adhere to `/best` and `/adhere` by
construction rather than by request.

`/hunt` is the audit skill for a reason: it refuses a performance finding without a
measurement ("No number, no finding"), and it separates findings that carry a witness from
hypotheses that do not. So the baseline (P0) runs first, and the audits cite it.

---

## 0. Setup

| Item | Fact | Verified |
|---|---|---|
| Claude Code | 2.1.267 installed. Run it from the worktree root so `pnpm …` and `@file` references resolve. | `claude --version` |
| Permissions | `pnpm *`, `npm *`, `node *`, `curl *` and the read-only shell tools are already allowlisted, so the measurement steps do not prompt. | `settings.json` `permissions.allow` |
| Plan mode | `--permission-mode plan` is for reading only. The measurement prompts need to run `node` and `curl`, so run them in the normal session; the read-only guarantee comes from the skill's own gate ("this skill does not change code beyond throwaway probes it reverts"). | `claude --help`; `/hunt` close-out |
| Context file | Save §1 as `CLAUDE.md` at the worktree root. It holds **project facts only** — the house rules already load from the global `CLAUDE.md` every session and must not be duplicated. | Claude Code loads `CLAUDE.md` from cwd and parents |
| File references | `@path` in a prompt injects that file. Used below for the docs that hold the measured numbers. | code.claude.com/docs/en/slash-commands |
| Project commands | `.claude/skills/<name>/SKILL.md` in the worktree becomes `/<name>`; `$ARGUMENTS` carries what is typed after it; `disable-model-invocation: true` keeps it out of Claude's own menu. §3 has the shape. | same page |
| Guard-hook caveat | The hook reads skill bodies only under `~/.claude/skills/`. A project skill's body is **not** read, so the chain inside it is enforced by the body's own `CALL Skill(...)` lines, not by the hook. Every project skill below therefore opens with an explicit CALL list — the same convention your own skills use. | `hooks/skill-guard.py` `SKILLS_DIR` |
| Headless | `claude -p "$(cat <prompt-file>)" --output-format json` prints one JSON result; the hooks still run. | `claude --help` |
| Measure against | `pnpm build`, then `node backend/server.js` — compiled, as the container runs it. Never `pnpm dev:server` (tsx) or `vite dev` for server numbers. | `Dockerfile` CMD |
| Production shape | `node:22-alpine`, `mem_limit: 512m`, `cpus: 1.0`, Traefik in front, uid 1001, `data/` bind-mounted. | `deploy/compose.rmi-services.yml` |
| Browser | Claude in Chrome is available: `read_network_requests` for bytes and timings, `javascript_tool` for `performance.now()` / `performance.measure` / `performance.memory`, screenshots to confirm what is on screen. | this session's tool list |
| `/production` | Written for a different codebase (Go / SolidJS). Do not use it here as-is. | `skills/production/SKILL.md` |

**The dev backend is shared.** Another session may be writing the same multi-megabyte files.
Every prompt that seeds data creates its own ids, deletes only those, and never restores
`data/` wholesale. `ls -l data/` twice, ten seconds apart, before anything irreversible. A
backend left running by an earlier session is the normal state: if port 3001 is taken, find
what holds it rather than starting a second one — a second backend on localhost signs the
browser out of the first (shared `session` cookie).

**Timing in a hidden Chrome window lies.** Timers and `requestAnimationFrame` clamp to about
1 Hz. Assert `document.visibilityState === 'visible'` before trusting any browser timing
(`tasks/open-items-2026-09-09.md` §2 has the measurement).

---

## 1. `CLAUDE.md` for the worktree — project facts only

```markdown
# winner-app (svelte5-runes)

River Winner App: random winner selection for live events. SvelteKit 2 + Svelte 5 (runes) SPA
built by adapter-static into `dist/`, served by an Express 4 backend (`backend/`) that also owns
sessions, the JSON-file collections in `data/`, Ministry Platform (MP) queries and SMS texting.
pnpm, TypeScript everywhere, vitest (projects: unit / component / backend), eslint + prettier,
svelte-check. This tree is what `deploy.sh` ships; `main` holds the retired Alpine app.

## Layout
- `backend/server.ts` bootstrap; `backend/routes/*.ts` are plumbing only; `backend/services/*.ts`
  hold the logic. `collection.ts` and `list-entries.ts` show the house style and comment density.
- `src/lib/state/*.svelte.ts` rune stores (class + `$state` / `$derived`); `src/lib/services/*.ts`
  pure logic; `src/lib/api/client.ts` is the only fetch layer; `src/lib/workers/` web workers;
  `src/routes/` pages.
- `backend/**/*.js` and `*.map` are compiled output (git-ignored). Edit the `.ts`.
- Tests sit beside the code as `*.test.ts` / `*.svelte.test.ts`. A backend test must also be
  excluded in `tsconfig.backend.json` or `pnpm build:backend` ships it.
- `tasks/*.md` are the design and decision records. Write new ones in the style of
  `tasks/fix-preparing-winners-stall.md`: report, what was measured, root cause, fix, what
  verification showed.

## Commands
`pnpm dev:server` + `pnpm dev` (3001 / 3000, strictPort). `pnpm test`, `pnpm check`,
`pnpm lint`, `pnpm build`. Production shape: `pnpm build && node backend/server.js`.

## Storage model — the single biggest performance fact
- One JSON array per collection in `data/`: lists, winners, history, prizes, settings,
  templates, archive, backups.
- Every read is a whole-file read + `JSON.parse` (`readCollection`). Every write is
  `JSON.stringify(array, null, 2)` of the whole collection + fsync + atomic rename
  (`writeCollection`). No in-memory cache, no per-collection write queue.
- Lists carry entries inline; a 20 000-entry list is ≈ 7.4 MB
  (`tasks/fix-preparing-winners-stall.md`). The console loads all six collections, entries
  included, on boot (`src/lib/state/data.svelte.ts` `loadAll`).
- `express.json` accepts 50 MB bodies because CSV import and backup restore post whole lists.
  Draws and undo post entry ids only.

## Production
`node:22-alpine`, `mem_limit: 512m`, `cpus: 1.0`, Traefik, uid 1001, `data/` bind-mounted
(`deploy/compose.rmi-services.yml`). Operators read the JSON files by hand.

## Decisions already taken — do not re-open casually
- `crypto.getRandomValues` once per swap in the shuffle (358 ms for 20 000 entries, in a
  worker) is known; batching it is fairness-critical and needs a statistical test — its own
  change. The triple shuffle stays; `src/lib/services/shuffle.ts` says why.
- Winners are never revealed before the write is confirmed.
- The JSON files stay pretty-printed unless the owner decides otherwise.
- Background-tab timer clamping is not a bug (`tasks/open-items-2026-09-09.md` §2). Assert
  `document.visibilityState === 'visible'` before trusting a browser timing.

## Verification traps (measured, not guessed)
- The dev backend is shared with other sessions: create your own ids, delete only those,
  never restore `data/` wholesale; `ls -l data/` twice before anything irreversible.
- A second backend on localhost signs the browser out of the first (shared `session` cookie).
- A modal `<dialog>` blocks the screenshot call that opened it; open in one call, inspect in
  the next. Svelte flushes asynchronously: a click and its assertion cannot share one
  evaluation.
```

---

## 2. The prompts

P0 measures. P1–P3 audit and propose only. P4 is the only one that edits, one approved finding
at a time. P5 proves nothing was lost. Paste each whole; the bare tokens are deliberate.

### P0 — Baseline measurements (writes only under `tasks/perf/`)

```text
Establish the performance baseline of winner-app before anyone changes code. /max /best /adhere /cd
Load each skill first.

Deliverable: tasks/perf/baseline-<yyyy-mm-dd>.md, every number recorded with the exact command
and its output. You may create files only under tasks/perf/. Do not modify any source file.

Facts to reason from, all in this tree:
- One JSON file per collection in data/. Every read is a whole-file read + JSON.parse
  (backend/services/collection.ts readCollection); every write is JSON.stringify(array, null, 2)
  of the whole collection + fsync + rename (writeCollection). No cache, no write queue.
- Lists carry entries inline; a 20 000-entry list is about 7.4 MB. The numbers already taken
  are in @tasks/fix-preparing-winners-stall.md — extend them, do not repeat them.
- Production: node:22-alpine, mem_limit 512m, cpus 1.0 (@deploy/compose.rmi-services.yml),
  running the compiled `node backend/server.js`.

Measure against the production shape: `pnpm build`, then `node backend/server.js` in a
background Bash. Never measure `pnpm dev:server` (tsx) or `vite dev` for server numbers. If
port 3001 is already bound, find what holds it — do not start a second backend; a second one
on localhost signs the browser out of the first.

Preconditions, verified not assumed:
- The dev backend is shared. `ls -l data/` twice, ten seconds apart; if any size moved,
  another run is live — stop and say so. Never restore data/ wholesale. Create your own
  records and delete only those ids, in a finally step that runs even if a measurement fails.
- Sign in through the admin endpoint: POST ADMIN_USERNAME / ADMIN_PASSWORD from .env to
  /api/auth/login and keep the `session` cookie. Google sign-in cannot run headless.
- Confirm which process answered: check the port is bound by your server before trusting a
  number.
- Record the start state: heap_size_limit from v8.getHeapStatistics(), process.memoryUsage(),
  and the server's RSS from ps.

Measurements:
1. Seed one list with 20 000 realistic entries via POST /api/lists (id, first and last name,
   phone, idCard). Bytes of data/lists.json before and after.
2. GET /api/lists and POST /api/batch for all six collections: wall time, response bytes,
   server RSS and heapUsed before, during and after. Run the profiled pass under
   `node --cpu-prof --heap-prof backend/server.js` and attribute time to file:line.
3. A draw's write: POST /api/batch-save with removeEntries of five ids, five winners and one
   history entry — wall time and memory delta. Then ten concurrent batch-saves to different
   collections, then ten to the same collection; re-read afterwards and report whether any
   write was lost.
4. CSV import of the same 20 000 rows through the real endpoint (a whole-list post): wall time
   and peak RSS.
5. The backup/export path, which reads every collection: wall time and peak RSS.
6. Delivery: `curl -sI -H 'Accept-Encoding: gzip, br' http://localhost:3001/` and one hashed
   asset under dist/_app/ — quote Content-Encoding and Cache-Control exactly as seen.
7. The page, with Claude in Chrome against `pnpm dev:server` + `pnpm dev`: read_network_requests
   for bytes and timings on / and /present; javascript_tool with performance.now() around boot
   and around one draw; performance.memory.usedJSHeapSize (Chrome-only, coarse) after 1 and
   after 20 draws. Assert document.visibilityState === 'visible' first — a hidden window
   clamps timers and rAF to about 1 Hz and every timing lies.

Summarise: the three most expensive operations per unit of list size; peak RSS against the
512 MB limit with headroom at 2× and 5× today's data; the file:line the profile attributes time
to. Delete raw .cpuprofile and .heapprofile files after summarising; keep the markdown. Finish
by removing every record you created and confirming data/lists.json is back to its starting
size.
```

### P1 — Backend bottleneck and RAM hunt (read-only)

```text
Performance and memory hunt on the Express backend. /hunt /best /adhere /max
Load each skill first. Read-only: no source changes; every scratch probe is reverted.

Witnesses come from tasks/perf/baseline-*.md (W4) and from probes you run now. A candidate
with no number stays in Unproven with the exact probe that would settle it — the skill forbids
a performance finding without a measurement, and so do I.

Facts: every collection is one JSON file, read and parsed whole per request and rewritten
whole (pretty-printed, fsync, rename) per write — backend/services/collection.ts; a
20 000-entry list is about 7.4 MB (@tasks/fix-preparing-winners-stall.md); 512 MB and one CPU
in production; no cache and no write queue.

Hunt, in this order:
1. Work proportional to data size done per request or per write when it could be done once:
   the same collection parsed more than once inside one request (backend/routes/batch.ts),
   whole-collection rewrites for single-item changes, whole-body buffering where a stream would
   do (backend/routes/reports-proxy.ts).
2. Peak-memory hazards under 512 MB: request body + parsed collection + serialised output of
   the same list held at once (the 50 MB body limit in backend/server.ts); synchronous fs on
   the request path; unbounded growth in maps, arrays, timers, listeners; no V8 heap sizing for
   a cgroup limit.
3. Lost updates: two concurrent writers to one collection today. T3 differential probe — ten
   concurrent batch-saves to the same collection, then count what survived. This is the one
   invariant any cache or write queue must close, and it decides the design.
4. Event-loop blockers: multi-megabyte JSON.parse / JSON.stringify on the main thread and
   CPU-bound loops over entries — use the cpu profile from the baseline.
5. T7 after each confirmed finding: where else does the class occur? Every route in
   backend/routes/collections.ts has the same read-mutate-write shape.

Fan the read-only sweeps out to Explore subagents by area (routes/, services/, server +
middleware) and verify every candidate yourself before it becomes a finding.

For each finding, the skill's format, plus: the proper fix as a design — the module it lives
in under backend/services/ (routes stay plumbing), the invariant it keeps (atomic write, one
writer per collection, fail-fast on corruption), whether it changes the on-disk shape of
data/*.json, the features touched, and the guard: a vitest test in the `backend` project (the
.js-to-.ts alias makes it test source; the file must be excluded in tsconfig.backend.json or it
ships).

Answer separately, with evidence: (a) compression and cache headers on the wire — quote curl;
(b) heap_size_limit for this container shape and whether GC or the cgroup OOM kill comes first
under load; (c) which fixes keep the on-disk shape unchanged.

Recorded decisions — do not re-open unless your numbers change the trade-off, and then say how:
batching crypto.getRandomValues (fairness-critical, needs a statistical test); the triple
shuffle; revealing before the write is confirmed; compacting the pretty-printed JSON files
(operators read them — present the bytes, the owner decides).

Output to tasks/hunt-backend-perf-<date>.md per the skill. Propose only.
```

### P2 — Frontend main-thread and memory hunt (read-only)

```text
Main-thread and memory hunt on the Svelte 5 frontend. /hunt /best /adhere /max
Load each skill first. Read-only.

Witnesses come from running the app, not reading it (T8): Claude in Chrome against
`pnpm dev:server` + `pnpm dev`. Before any timing, assert document.visibilityState === 'visible'
— a hidden window clamps timers and rAF to about 1 Hz and has produced two false leads already
(@tasks/open-items-2026-09-09.md §2). javascript_tool for performance.now() /
performance.measure and performance.memory.usedJSHeapSize (Chrome-only, coarse) after 1, 10 and
20 draws and after 20 celebrations; read_network_requests for boot bytes; screenshots to
confirm what is actually on screen. The headless recipe — admin login, seeding, the <dialog>
screenshot trap, Svelte's asynchronous flush — is in project memory; use it.

Facts: loadAll in src/lib/state/data.svelte.ts pulls six collections, entries included, and
wraps them in $state; 20 000 entries as deep proxies cost about 500 ms to stringify (measured,
@tasks/fix-preparing-winners-stall.md); the draw runs in a worker
(src/lib/workers/selection.worker.ts) created per draw in src/lib/state/draw.svelte.ts.

Hunt:
1. $state over data that never needs reactivity: which stores wrap large arrays, which reads
   iterate them per render, and where $state.raw or a plain array behind a getter is correct.
   Prove the reactivity each consumer needs from its usage, not from taste.
2. $derived chains and O(n·m) joins recomputed per dependency change over whole collections
   (the filters, enrich(), winner search). performance.measure around the store getters.
3. Anything that outlives its owner — the witness is a heap that does not come back after the
   owner is gone: $effect without teardown; intervals and timeouts not cleared on unmount or on
   a second start; window/document listeners; AudioContext or audio elements never closed;
   Workers not terminated on every path (error, timeout, abandoned run); object URLs not
   revoked; particle arrays that only grow; observers never disconnected. Read
   src/lib/services/animations.ts, sounds.ts, scan-engines.ts, src/lib/state/draw.svelte.ts,
   preview.svelte.ts, scanner.svelte.ts closely, then drive each twenty times and compare heap.
4. Boot cost before first paint on / and on /present: what is fetched, parsed and proxied.
   Which screens need entries at all, and what a metadata-only read takes end to end (API
   contract, store, types, tests) — design only.
5. The draw path between "countdown ends" and "cards on screen": anything that is not the
   draw itself.

Per the skill's format, plus: the proper fix and the file it belongs in; features touched;
the guard (vitest unit or component project). Do not propose shuffle changes or revealing
before the write is confirmed. Output tasks/hunt-frontend-perf-<date>.md. Propose only.
```

### P3 — Delivery: where the app fights the framework, and what the browser pays

```text
Where is this app fighting Express, SvelteKit and Vite on delivery, and what does the browser
pay for it? /framework /best /adhere /max
Load each skill first. Read-only for source; you may run `pnpm build` and read dist/.

Measure first, judge second: the `pnpm build` output and `du -a dist | sort -n | tail -40`;
`curl -sI -H 'Accept-Encoding: gzip, br'` against `node backend/server.js` for / and for one
hashed asset under dist/_app/; read_network_requests on / and /present in Claude in Chrome for
bytes actually transferred.

Look at, with exact byte counts:
1. Compression. No `compression` dependency in package.json, `precompress: false` in
   svelte.config.js, no Traefik compress middleware label in deploy/compose.rmi-services.yml —
   so the 7.4 MB batch payload and megabyte-scale JS go out as-is unless something outside the
   repo intervenes. Which layer is the correct-by-construction place for this deployment —
   Express middleware, SvelteKit precompress plus static headers, or the Traefik label — and why.
2. Cache headers. express.static(DIST_DIR) with defaults in backend/server.ts. Hashed assets
   should be immutable, index.html no-store. Quote what is sent today.
3. Whole imports where a subset is used: src/routes/+layout.svelte imports bootstrap.min.css
   and bootstrap-icons.css entire; check qr-scanner and anything else. Route-level splitting
   for /present, the scanner, the celebration canvas, MP and CSV import.
4. Fonts. src/app.html loads five Google families across more than twenty weights while
   settings selects one. What loading only the selected family takes (settings store, CSS,
   fallback stack) — design only.
5. Source maps. `sourcemap: true` in vite.config.ts — what it adds to dist/ and the image, and
   whether .map files are served.
6. Hand-rolled where the framework has it: the session store, CORS, the page-auth shell
   routing, the static-serving order. Flag only where the built-in is actually more robust
   here, with the reason. adapter-static and ssr=false are deliberate; svelte.config.js says
   why, and that reasoning stands.

Per item: bytes before, expected bytes after, the fix and where it lives, features touched,
how to verify. Rank by bytes saved on the first load of /present. Propose only.
```

### P4 — Fix ONE approved finding (the only prompt that edits)

```text
/solve this performance finding, and only this one: <paste the F-number, file:line and the
agreed design from tasks/hunt-*.md> /best /adhere /max
Load each skill first.

The skill's phases apply in full: root cause, plan in tasks/, validate-plan, approval,
implement, inspect-fix, walkthrough, commit. Two additions specific to this work:
- Numbers are part of the walkthrough. Re-run the exact commands from
  tasks/perf/baseline-*.md and put before and after side by side. No number, no "fixed".
- Correct by construction. If the fix depends on every future caller remembering a step, it is
  not finished: one owner, a type that makes the wrong call unrepresentable, or a guard that
  throws. The class gets the guard, not the instance.

Constraints this tree imposes: routes stay plumbing and logic lives in backend/services/ or
src/lib/services|state|utils; a new backend test must be excluded in tsconfig.backend.json or
it ships; the on-disk JSON must stay readable by backup restore, CSV import, MP sync and by an
operator opening the file. Record the reasoning at the change and in tasks/<slug>.md in the
style of tasks/fix-preparing-winners-stall.md.
```

### P5 — Prove nothing was lost (after a fix, read-only)

```text
Prove the performance change <one line naming it> lost nothing. /code-review /best /adhere
Load each skill first. Do not modify source files.

1. From `git diff` (or the last commit), list every function, store, route and component
   whose behaviour could have changed, and the user-visible features that depend on each.
2. For each feature: an existing test (name it, run it, quote the result); or a live step
   against `pnpm dev:server` + `pnpm dev` with Claude in Chrome (do it, screenshot, say what
   you saw); or NOT COVERED — never "should be fine".
3. On-disk shape before and after: data/*.json still readable by backup restore, CSV import,
   MP sync and by an operator. Quote the bytes.
4. Re-run the tasks/perf/baseline-*.md commands; numbers side by side.
5. Report proven, tested-only and uncovered, and the smallest test that closes each gap.
```

### Headless

```bash
# Baseline as a one-shot run; the allowlist already covers pnpm, node and curl.
claude -p "$(cat .claude/prompts/perf-baseline.md)" --output-format json > tasks/perf/baseline-run.json
```

---

## 3. Optional: install P0–P5 as project skills

`.claude/skills/<name>/SKILL.md` in the worktree becomes `/<name>`. The body must open with an
explicit CALL list: the guard hook does not read project skill bodies, so the chain is carried by
the text, exactly as your own skills do it. Two examples; the rest follow the same shape.

`.claude/skills/perf-baseline/SKILL.md`

```markdown
---
description: Measure winner-app's performance baseline into tasks/perf/ before any change. Read-only for source.
disable-model-invocation: true
---

CALL `Skill(max)`, `Skill(best)`, `Skill(adhere)`, `Skill(cd)` — tool calls, before any other
tool call. GATE: do not start until all four are loaded.

<paste the body of P0 from "Deliverable:" to the end>
```

`.claude/skills/perf-fix/SKILL.md`

```markdown
---
description: Fix ONE approved performance finding through /solve, with before/after numbers. Usage: /perf-fix <finding>
disable-model-invocation: true
argument-hint: [F-number and agreed design]
---

CALL `Skill(solve)`, then `Skill(best)`, `Skill(adhere)`, `Skill(max)` — tool calls, before any
other tool call. GATE: do not start until all four are loaded.

Implement exactly one approved change: $ARGUMENTS

<paste the body of P4 from "The skill's phases apply in full" to the end>
```

---

## 4. Leads from reading the code — verified by reading, not yet measured

A first pass over the live tree. Each cites the line it rests on; none has a number yet. They
are candidates for `/hunt`, not findings: a candidate without a witness stays in Unproven.

| # | Where | What the code does | Why it matters at 20 000 entries / 512 MB | What settles it |
|---|---|---|---|---|
| 1 | `backend/routes/batch.ts:31,36` | `readCollection` runs inside the per-request loop; a batch asking for N ids of one collection parses that file N times. | N × 7.4 MB parsed per request. | Count parses for a 3-id batch against a 20k list. |
| 2 | `backend/services/collection.ts` (`readCollection` / `writeCollection`) | No cache and no write queue. Every route reads the whole file; concurrent writers to one collection each read, mutate and rename — last rename wins. The temp-file comment already notes settings saves arrive in bursts. | Lost updates plus repeated parse cost. The proper shape is a repository service: one parsed copy per collection, a per-collection write queue, write-through with the existing atomic rename, fail-fast on corruption. | P0 step 3 (ten concurrent writes to one collection). |
| 3 | `backend/services/collection.ts:120` | `JSON.stringify(data, null, 2)` on every write. | Indentation inflates the file and the string held in memory during the write. Operators read these files, so compacting is the owner's decision — present the bytes. | Bytes with and without indent for the 20k list. |
| 4 | `backend/server.ts:35` | `express.json({ limit: '50mb' })`. | One import can hold the 50 MB body, the parsed object and the stringified file at once — three copies of the same list inside 512 MB. | Peak RSS during P0 step 4. |
| 5 | `backend/routes/reports-proxy.ts:25` | `await response.text()` buffers the whole upstream CSV before sending. | Memory proportional to report size; a stream costs constant memory. | Proxy a large report and watch RSS. |
| 6 | `src/lib/state/data.svelte.ts:70-80` | `loadAll` fetches six collections, entries included, then wraps them in `$state`. | 7.4 MB per 20k list on every console load, then deep proxies over every entry (≈500 ms to stringify, measured). | P0 steps 2 and 7. |
| 7 | `src/routes/+layout.svelte:2-3` | Imports the entire `bootstrap.min.css` and `bootstrap-icons.css`. | Whole framework CSS and an icon font for the subset in use. | `pnpm build` chunk sizes; a coverage recording. |
| 8 | `src/app.html:22` | Five Google font families, more than twenty weights, requested on every page. | One family is selected in settings; the rest is paid for by every viewer. | `read_network_requests` on `/present`. |
| 9 | `package.json` (no `compression`), `svelte.config.js:28` (`precompress: false`), `backend/server.ts:89` (`express.static` defaults) | No compression anywhere in the repo's path and default cache headers. | The 7.4 MB JSON and megabyte-scale JS go uncompressed; hashed assets are revalidated each load. Traefik compresses only when a middleware label says so — none is set. | `curl -sI -H 'Accept-Encoding: gzip, br'` against the built server; the Traefik labels. |
| 10 | `vite.config.ts:73` | `sourcemap: true` for the production build. | .map files in `dist/` and in the image; served if requested. | `du dist`; `curl -I` a .map. |
| 11 | `Dockerfile`, `deploy/compose.rmi-services.yml` | No `NODE_OPTIONS=--max-old-space-size` for a 512 MB cgroup. | If V8 sizes its heap above what the cgroup grants, the failure is an OOM kill rather than GC pressure. | `heap_size_limit` inside the container. |
| 12 | `backend/routes/auth.ts:59` | `fs.writeFileSync` on sign-in and in the hourly sweep. | Blocks the loop only at login — low priority; listed so it is ranked, not merely flagged. | — |
| 13 | `src/lib/state/draw.svelte.ts:683,713` | A Worker per draw, terminated at 713. | Fine if `terminate()` runs on every path (error, timeout, abandoned run). | Read the surrounding try/finally; heap after 20 draws. |
| 14 | `src/lib/services/animations.ts:953` | `spawnTimer = setInterval(...)` for the celebration canvas. | Must be cleared on stop and on a second start; particle arrays must be bounded. | Heap after 20 celebrations. |
| 15 | `backend/services/texting-scheduler.ts:17` | Cron every two minutes. | Cheap if it reads only `texting-jobs.json`; confirm it does not touch larger collections per tick. | Read the tick body. |

Items 2, 6 and 9 are the ones most likely to move the numbers by an order of magnitude. Item 2
also changes the backend's shape, so it is the one to design first and measure before and after.

---

## Sources (2026-09-10)

- `claude --help` and `claude --version` on this machine (2.1.267): flags `-p`, `--output-format`,
  `--permission-mode` (`plan`, `acceptEdits`, `auto`, …), `--add-dir`, `-w/--worktree`.
- Skills and commands reference — `SKILL.md` layout, `$ARGUMENTS`, frontmatter,
  `disable-model-invocation`, `@file` references: https://code.claude.com/docs/en/slash-commands
- `~/.claude/hooks/skill-guard.py` — manifest from bare `/tokens`, chaining through
  `~/.claude/skills/*/SKILL.md` bodies only, leading `/token` typed as a command is exempt.
- `~/.claude/skills/{hunt,solve,framework,implement,inspect-only,fix,max,quality,validate-plan}/SKILL.md`.
- `~/.claude/settings.json` `permissions.allow`: `pnpm *`, `npm *`, `node *`, `curl *`.
