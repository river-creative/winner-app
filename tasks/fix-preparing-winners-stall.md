# "Preparing winners…" keeps spinning after the delay

Status: **implemented and verified against the running app.**

## Result

| | Before | After |
|---|---|---|
| Batch payload, 5 winners from 20 000 entries | 7 415 614 bytes | **3 784 bytes** |
| Undo payload, same draw | a second whole list | **2 522 bytes** |
| Spinner on a draw whose write finished during the countdown | shown every time | **never mounted** |
| Spinner when the write really does outlast the countdown | shown | shown, unchanged |
| A write that never returns | spins forever, reload only way out | **fails at 20 s, show recovers** |

Measured on `/present`, real backend, same 20 000-entry fixture as the original diagnosis.

## A defect the walkthrough caught, that the tests would not have

Driving the real timeout produced:

> The draw failed. **The user aborted a request.**

…on a draw the server had saved *in full* — winners, history, the prize decrement, the entry
removals — with no undo offered and an invitation to draw the same prize again.

Cause: a deadline can fire at two different points. `fetch` rejects while the request is in
flight; the **body read** rejects if the response had already started streaming. Only the first
was inside `request()`'s `try`, so the second escaped as a raw `DOMException`, never became an
`ApiError`, and never reached the `timedOut` branch. `AbortSignal.timeout()` rejects `fetch` with
`TimeoutError`, but the cancelled body read rejects with `AbortError` — both observed, both now
classified together and both covered by `src/lib/api/client.test.ts`.

This is why the walkthrough is not optional: every unit test passed while this was broken.

## The report

> Why is it still loading and saying preparing winners even after the delay? First of all,
> selecting winner takes only split of a second; secondly, 3 seconds delay is sufficient to get
> winners. Something is wrong here.

Correct on both counts. The pick itself is milliseconds, and the delay is long enough. The
spinner is not waiting for the draw — it is waiting for the **write**.

## What was measured

Live walkthrough against `pnpm dev:server` + `vite dev`, real data layer, `/present` route,
driving the real Play button. Instrumentation was a `window.fetch` wrapper and a
`MutationObserver` installed from the devtools side; **no repo file was changed**.

### Run A — the operator's own data (1,937 entries, delay 2 s, 1 winner)

```
42033ms countdown SHOWN
42163ms fetch START  ./api/batch-save
42209ms fetch HEADERS in 46ms status 200      <- winners are saved here
44031ms spinner SHOWN                          <- 1.8 s AFTER the work finished
44038ms spinner hidden
```

The spinner is mounted on **every** draw, even when the write finished nearly two seconds
earlier. Here it lasts 7 ms, so it reads as a flicker.

### Run B — 20 000 entries, delay 3 s, 5 winners

```
2520ms countdown SHOWN
3460ms fetch START  ./api/batch-save   bodyBytes = 7 415 614
3737ms fetch HEADERS in 276ms
5514ms spinner SHOWN
5519ms spinner hidden
```

**7.4 MB posted to remove 5 entries from a list.** On localhost the round trip is 276 ms, so the
delay still covers it. Client-side preparation before the request even starts is ~940 ms.

### Run C — the same draw with a 12 s stall injected on the save request only

```
 4931ms countdown SHOWN
 5771ms SAVE start, payload bytes = 7 410 052
 7928ms spinner SHOWN            <- countdown ended exactly on time (2997 ms)
18090ms SAVE done after 12318ms
18093ms spinner hidden           <- 10 165 ms of "Preparing winners…"
```

This is the reported screen, reproduced: the countdown finishes on schedule and the room then
watches a spinner for precisely as long as the write overshoots the delay.

### Component costs (measured in-page)

| Step | 1 938 entries | 20 000 entries |
|---|---|---|
| `selectIndices` (the actual draw) | 41 ms | 358 ms |
| `JSON.stringify` of the list, plain objects | — | 19 ms |
| `JSON.stringify` of the same list as `$state` proxies (by subtraction) | — | ~500 ms |
| Batch payload posted | ~1 MB | 7.4 MB |
| Round trip on localhost | 46 ms | 276 ms |

The 358 ms shuffle is `crypto.getRandomValues` being called once per swap — 80 000 separate
calls. It runs in the worker, off the main thread, so it does not stutter the countdown.

## Root cause

Three separate defects, all on the path between "countdown ends" and "winners on screen".

### 1. The spinner is shown even when there is nothing left to wait for

`DelayOverlay.svelte` infers "still working" from `draw.phase === 'delaying'` plus a locally
tracked `delayElapsed` flag:

```ts
const waiting = $derived(
  previewVisual === null && drawing && (settings.current.preSelectionDelay <= 0 || delayElapsed)
);
```

`phase` is one flag covering two concurrent activities, so it cannot tell "the write is still in
flight" apart from "the write finished two seconds ago and the reveal is one microtask away".
Result: the spinner is mounted at the instant every countdown ends, unconditionally.

`DrawPhase` already declares `'selecting'`, and `draw.busy` already tests for it — but
**nothing ever assigns it**. The state that exists precisely to mean "the countdown is over and
we are still working" is dead code.

### 2. The reveal is gated on re-uploading the entire source list

`draw.svelte.ts:251-261` rebuilds each source list with the drawn entries filtered out and pushes
the **whole list** into the batch, so a draw that removes 5 rows posts every remaining row back.
`data.commit()` is awaited before `phase` moves to `'revealing'`, so the reveal waits for it. The
spinner's duration is therefore `list size × network`, which is what the operator is watching.

Undo has the same shape at `draw.svelte.ts:458-468`.

### 3. The write has no timeout

`runSelection` has `SELECTION_TIMEOUT_MS = 30_000` ("anything near this is a wedged worker").
`data.commit` has none. A stalled request leaves the show on "Preparing winners…" indefinitely,
with no error and no way out but a reload — the exact shape Run C simulated.

## Proposed fix

### A. Give the store a real `'selecting'` phase

In `DrawStore.start()`, assign `'selecting'` when — and only when — the delay runs out while the
commit is still in flight, guarded so a failed draw that already set `'idle'` is not overwritten.
`DelayOverlay` then shows the spinner for `phase === 'selecting'` and nothing else; the local
`delayElapsed` state and its `$effect` are deleted, because the store owns the truth instead of
the component re-deriving it.

Effect: in the normal case the countdown hands straight over to the reveal with no spinner.

**Consequence to confirm:** when `soundEndOfDelay` is set, `#runDelay` sleeps 100 ms + 500 ms
after the countdown for the sting. Today the spinner covers that gap. With this change the stage
is empty for those 600 ms — a beat before the reveal rather than a false "loading". With
`soundEndOfDelay: 'none'` (the current setting) there is no gap at all.

The block comment in `DelayOverlay.svelte` that explains why the spinner exists ("the room stares
at a frozen '1'") is **rewritten, not deleted** — the reasoning it records is still the reason the
countdown must not linger on its last number; only the remedy changes.

### B. Stop shipping the whole list to remove a few entries

Add two targeted operations to the batch protocol:

```ts
{ collection: 'lists', operation: 'removeEntries',  id: listId, entryIds: [...] }
{ collection: 'lists', operation: 'restoreEntries', id: listId, entries: [...] }   // undo
```

The backend already reads the collection, mutates it and writes it back; it just needs to do the
filtering itself instead of accepting a wholesale replacement. Payload drops from megabytes to a
few hundred bytes regardless of list size, and the ~500 ms `JSON.stringify` over `$state` proxies
disappears with it.

Staying inside `/batch-save` rather than adding `POST /lists/:id/remove-entries` is deliberate:
the draw must remain **one** request, or a failure between two requests leaves winners saved and
entries not removed.

Three details this forces:

- **`metadata.entryCount` moves server-side** for these two operations. Today three call sites
  (draw, undo, import) each remember to recompute it — correct only while every future caller
  remembers. The remove/restore path owns it in one place instead. Import still sends a whole
  list, and still sets it there, which is correct.
- **The filtering lives in a service**, `backend/services/list-entries.ts`, not inline in the
  batch route — the route stays plumbing, matching how `collection.ts` is already split out.
- **`BatchSaveOperation` becomes an *additive* discriminated union**, so `removeEntries` without
  `entryIds` cannot be constructed. The existing upsert and `delete` shapes stay as members of
  the union unchanged, so the operations built elsewhere still typecheck without edits.

  This is a correction to the first draft of this plan, which said the union "touches four call
  sites". It does not. `BatchSaveOperation[]` is constructed at **twelve** sites across seven
  files — `draw.svelte.ts` ×2, `winners.svelte.ts` ×5, `history.svelte.ts` ×2, `texting.ts`,
  `services/lists.ts`, `services/export.ts`. Rewriting all twelve for a defect in one of them is
  the "don't bolt unrelated improvements onto the task at hand" rule; keeping the union additive
  gets the compile-time guarantee where it is needed and leaves the other eleven alone.

  The backend validates the same shape and **rejects a malformed op with 400** rather than
  skipping it — a silently-ignored write is how a draw ends up half-saved.
- **`/batch-save` returns the new `entryCount`** in the `results` entry for a list op. Without it
  the count is arithmetic done twice — once on the client for local state, once on the server for
  storage — and the two silently disagree the moment the server's copy differs from the client's,
  which is exactly the lost-update case this change is meant to close. A number in the response
  costs nothing and keeps one authority.

This also closes a real lost-update window: posting a whole list overwrites any change another
operator made to it since this page loaded.

### C. Bound the write

Give `data.commit` a deadline (`AbortSignal.timeout`) so a hung save fails loudly instead of
freezing the show. `request()` spreads `init`, so the signal reaches `fetch` with no plumbing —
but two things do need real work, and neither was in the first draft of this plan:

- **`request()` currently swallows the abort.** Its `catch (cause)` turns *every* fetch rejection
  into `ApiError('Cannot reach the server. Please check your connection.', 0, …)`. A timeout would
  arrive wearing a connection error's clothes, which is precisely the distinction this change
  exists to make. `request()` has to branch on the rejection first. `AbortSignal.timeout()` is
  documented to reject with a `DOMException` named `TimeoutError` (not `AbortError`) — that is
  **asserted by a test, not assumed**, because the whole error path depends on the name.
- **A timed-out write is not a write that did not happen.** The server may have applied it while
  the client, which only updates local state *after* a successful commit, did neither that nor
  set `#lastAction`. The draw is then saved, invisible in the UI, and not undoable. So on a
  timeout specifically the store must reload the affected collections to converge on what the
  server actually holds, and say so.

**Honesty requirement:** `start()`'s catch currently says "The draw failed. Nothing was saved."
That is true for a rejected request and false for a timed-out one. The two need different
messages; the timeout's must tell the operator to check the Winners tab before re-drawing.

### Not proposed

- **Revealing before the write is confirmed.** It would hide the latency completely, but it puts
  names on a screen that may not be recorded. Current behaviour is the safe one; making the save
  fast is the right fix. Say so if you want the trade anyway.
- **Batching `crypto.getRandomValues`.** Would cut the 358 ms shuffle to a few ms, but it runs in
  the worker, concurrently with the delay, and touches the fairness-critical code. Separate change.
- **Announcing the reveal to screen readers.** The countdown pane carries
  `<span class="visually-hidden">Selecting winners…</span>` inside a `role="status"`, and then the
  winners grid — `role="list"`, not a live region — replaces it silently. A screen-reader user is
  told the draw started and never told it finished. That is **pre-existing**, not caused by this
  change, but removing the spinner makes it the only announcement left. Worth a one-line
  `aria-live` on the result; say if you want it in scope.

## Verification plan

0. **Prove the harness before writing assertions.** The `component` vitest project exists in
   `vite.config.ts` but has **zero files** — no `*.svelte.test.ts` has ever run in this repo. That
   a class with `$state`/`$derived` fields in a `.svelte.ts` module instantiates correctly under
   it is *unverified*. Step one is a throwaway test that reads one rune off `draw`; if that does
   not run, the harness question gets solved before anything else is written.
1. `src/lib/state/draw.svelte.test.ts` (new): with `$lib/api/client` and `$lib/services/sounds`
   mocked, assert the phase sequence is `delaying → revealing` when the commit finishes during
   the countdown, and `delaying → selecting → revealing` only when it does not. This test must be
   shown failing against the current code before it counts.
2. Backend test for `removeEntries` / `restoreEntries` against a temp `DATA_DIR`, including the
   malformed-op rejection, `metadata.entryCount`, and that `restoreEntries` appends at the end —
   matching what undo does today, so this is not a silent reordering.

   There is no backend test today, so this adds a third `test.projects` entry in `vite.config.ts`
   covering `backend/**/*.test.ts`. It also requires adding `backend/**/*.test.ts` to the
   `exclude` of `tsconfig.backend.json`: that config has `include: ["backend/**/*.ts"]` and
   `outDir: "./backend"`, so without the exclusion `npm run build:backend` compiles the tests and
   ships `*.test.js` to production alongside the server.
3. Live walkthrough on `/present` with the same fetch/MutationObserver probe: assert the batch
   payload is now kilobytes, and that **no `.delay-spinner` node is mounted at all** on a draw
   whose write finished during the countdown.
4. Re-run Run C's injected stall to confirm the spinner still appears when it *should*, and that
   the new timeout produces a real error instead of an endless spinner.
5. Screenshot the reveal in both themes — the spinner's removal changes what the stage shows
   between countdown and cards.

### What the verification actually showed

1. `DelayOverlay.svelte.test.ts` — all three cases failed against the unfixed code first
   (spinner mounted on a completed draw; `phase` never reached `'selecting'`; spinner covered the
   sting gap), then passed.
2. `backend/services/list-entries.test.ts` — 10 cases, including the malformed-op refusals and
   that `restoreEntries` appends rather than reorders.
3. `client.test.ts` — the body-read abort case was shown failing (`expected AbortError: The user
   aborted a request. to be an instance of ApiError`) before the fix.
4. Live: normal draw posts 3 784 bytes, no `.delay-spinner` node ever mounted, countdown hands
   straight to the reveal. Undo restores all five entries and the prize, appending at the end.
5. Live: a 6 s and a 15 s stall each show the spinner for exactly the overshoot, then reveal.
6. Live: a request that never answers aborts at **20 422 ms** with `reason.name = TimeoutError`,
   the spinner clears, the Play button returns, and the message reads "The server did not answer
   in time. The winners may or may not have been saved — check the Winners tab before drawing
   again." The resync then showed those winners in the Winners tab — 10 of 10.
7. Screenshots taken in both themes.

## Notes for whoever implements this

- `backend/*.js` is **not** git-tracked (only the `.ts`), so there is no compiled output to
  commit. Dev runs `tsx backend/server.ts`; `npm run build:backend` is only needed for
  `npm run server` / deploy.
- Work happens on `svelte5-runes` in `.claude/worktrees/svelte5`, not on `main` — `main` still
  holds the pre-migration vanilla app, whose delay code is a different file entirely.
