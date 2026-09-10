# Open items after the production walkthrough — dispositions

Status: **all closed but one.** Two were diagnosed as non-bugs, three closed in code, the
restore click was exercised and the fixes are deployed with a complete 1.1 backup taken on
production. The single outstanding item is a live SMS to a number the operator owns.

Everything else that was called "blocked" turned out to be blocked only on an external system,
never on the app's own logic — and that logic is now under test. Two defects fell out of
testing it that no one had noticed: the backup omitted the `archive` collection, and closing
any confirmation dialog silently killed every subsequent toast.

## 1. Stale `metadata.entryCount` on three production lists — DIAGNOSED, no action needed

| List | `entryCount` | actual rows | drift | winners drawn |
|---|---|---|---|---|
| Thu AM | 544 | 544 | 0 | 8 |
| Thu PM | 619 | 619 | 0 | 8 |
| FRI AM | 483 | 475 | **8** | 8 |
| FRI PM | 606 | 602 | **4** | 4 |
| Sat AM | 472 | 448 | **24** | 7 |

**Cause: the old Alpine app, not this one.** `src/js/modules/selection.js` on `main` has two
branches for removing drawn entries. The combined-list branch updates the count
(`sourceList.metadata.entryCount = sourceList.entries.length`); the single-list branch below it
filters `entries` and **never touches `entryCount`**. Draws run through that branch left the
count behind. Sat AM's excess over its winner count is older churn on top of the same defect.

**The Svelte app cannot reproduce it.** All seven writers derive the count from the array they
are writing in the same expression: import (`lists.ts:237`), MP sync (`lists.ts:440`), draw
(`draw.svelte.ts:331`), undo (`draw.svelte.ts:566`), return-to-list
(`winners.svelte.ts:159`), entry deletion (`ListEntriesDialog.svelte:79`), and the server-side
`syncCount()` in `backend/services/list-entries.ts`.

**It self-heals.** `removeEntries`/`restoreEntries` recompute the count from the stored array, so
the next draw or undo touching each of those lists corrects it. No migration is needed. A one-shot
repair is possible if the numbers are wanted right (rewrite each list with
`entryCount: entries.length`) but it buys only cosmetics — nothing reads the field, and every
screen renders `entries.length`.

## 2. Reveal pacing "discrepancy" — NOT A BUG, measurement artifact

Measured on production with `preSelectionDelay: 3`, `displayDuration: 0.5`: the delay visual hid
at 3720 ms rather than ~3000, and the three cards landed ~1000 ms apart rather than 500.

Both are Chrome's background-tab timer clamping. Measured directly in that same hidden tab:

```
setTimeout(500)  actually took  1223, 1000, 1000, 1000, 1000 ms
setInterval(50)  fired 2 times in 1 second   (≈20 expected)
```

The Chrome window was backgrounded for the whole walkthrough, so every `sleep()` in `#reveal`
was clamped to 1 Hz and the delay's 50 ms tick to roughly 500 ms. On a foregrounded projector the
pacing is what the settings say.

This also vindicates `#runDelay`'s choice of `setInterval` over `requestAnimationFrame`: the
comment there says a hidden tab gets zero animation frames but a timer "is throttled while hidden
but still fires, so the draw always completes" — which is exactly what was observed. rAF measured
**0 frames per second** in the same tab.

**Corollary for future verification:** any timing or animation measurement taken through the
browser tool is suspect unless `document.visibilityState === 'visible'` is asserted first. Two
separate false leads in this session came from this — the celebration canvas appearing to paint
nothing, and this.

## 3. The four "untestable" items — three now covered in code, one genuinely outstanding

The line was drawn in the wrong place the first time this list was written. "Cannot run the
external system" is not the same as "cannot test the app's logic", and for every one of these
the app's own logic is where a bug would actually live. Each was pulled apart into the half that
needs hardware or someone else's production system, and the half that does not.

| Item | The half that needs the operator | The half now under test |
|---|---|---|
| SMS | the live send | `texting.test.ts` — 16 tests |
| MP / Pretix import | the query against MP | `mp-sync.test.ts` — 15 tests |
| Backup / restore | the click on production | `export.test.ts` + `batch.test.ts` — 15 tests |
| QR scanner | camera and wristband | `scanner.svelte.test.ts` — 7 tests |

- **A real SMS — still outstanding, and only the operator can close it.** Everything up to
  dispatch is verified: confirmation dialog, template resolution, phone-field precedence,
  rendered message, `sms: null` afterwards proving nothing was sent. Only a live send to a
  number the operator owns remains. A public one-time SMS number is not a substitute — those
  pools are filtered by bulk gateways, so a failure would not distinguish a broken app from a
  junk number, the inbox is public, and the number may belong to someone real.
- **Ministry Platform import — logic covered.** `src/lib/services/mp-sync.test.ts` stubs
  `mpExecuteQuery` and leaves everything below the network real: `mpRecordToRow` (MP returns
  numbers, nulls and dates; every downstream template does string work on them), `fieldNames`
  (union across rows, because an MP record omits fields it has no value for and row 0 is not a
  reliable column list), `entryIdFor`, and `syncListFromMp` — append-only, blank ids skipped,
  winners from this list not re-added, winners from another list still added, `entryCount` in
  step, `lastSyncAt`/`syncCount` bumped even on an empty response.
  The case worth having is the **within-response duplicate**: the loop this replaced only
  compared against ids the list already held, so one query returning the same person twice
  imported them twice. Deleting `knownIds.add(entryId)` turns that test red.
  A real import still hits an external system and pulls real personal data into a new list.
  There is a query named **"Mauch | Sun AM"** (`main-event-mauch`) that appears scoped to one
  person — the clean way to do "import only me" for real. MP *sync* on an existing live list is
  a separate matter: it mutates that list, so it should not be run against Thu AM casually.
- **Backup / restore — the write is now exercised for real.** See section 4.
- **QR scanner — decode stream covered.** `src/lib/state/scanner.svelte.test.ts` stubs the
  engine so its decode callback can be fired exactly the way a camera would. That reaches the
  part that is this app's own rather than hardware or third-party wasm: a repeated code looked
  up once rather than once per frame, an empty read ignored, a poster QR that is not a ticket
  code ignored silently, the camera stopped while a result is on screen, winners read fresh per
  lookup rather than from the boot snapshot, and a code matching nobody surfaced with the code
  quoted back. A camera and a printed wristband would only add the optics.

  **Finding C — the repeat guard is doubled.** Mutation testing found that `#processing` and
  `DEDUPE_WINDOW_MS` each independently block a repeated decode, so removing either alone
  leaves the suite green; only removing both produces three lookups. Every path that leaves
  `#processing` false with the camera live runs through `start()`, which clears `#lastValue`
  — so the dedupe window never holds the line alone on the ticket-code path. It is harmless
  defence-in-depth and has been left in place; the test asserts the behaviour rather than
  either guard, and says why in a comment.

## 4. Backup / restore — tested, two findings, both now fixed

"Backup Online" was run against production on 2026-09-09 (backup `LH6MMOA5`, 921.9 KB). It is the
first backup this app has ever stored. Its payload was inspected before anything was restored, and
it is complete and faithful: 6 lists **carrying their entries** (544 / 44 / 619 / 475 / 602 / 448),
1 prize, 35 winners, 35 history entries, 2 templates, 27 settings.

**Finding A — the backup did not include `archive`. FIXED (`c33ad03`).** Production holds 3
archived lists and the payload had no `archive` key. Archived lists exist precisely so a winner
whose source list was deleted still resolves a name; restoring that backup onto an empty instance
would have left those winners rendering "Unknown" instead of "(Archived)". Nothing was destroyed
by the omission — see B — but the backup was not a complete picture of the app's state.

`buildBackupPayload` now reads the collection and `restoreBackup` writes it, at backup version
1.1. Nothing branches on the version, so the 1.0 backup sitting on production still restores; it
simply carries no archived lists, and there is a test for exactly that payload. Verified against
a running instance, not only in tests: a backup taken through the real gear menu came back 1.1
with the archived list in it, and deleting `api.getAll('archive')` turns the new test red.

**Finding B — restore is a merge, not a revert. Now SAID SO (`61619d1`).** `restoreBackup`
issues only upserts; it never deletes. Restoring a backup taken before five draws leaves those
five winners in place rather than rolling them back. That is the safe direction to fail, and it
is what made testing viable here — but "Restore" reads as "put it back how it was".

The behaviour was left alone and the copy fixed instead: making restore actually revert would
mean deleting records the operator can no longer see, which is a far worse failure than the one
being solved. Both confirm dialogs — from file and from server — now read "This merges rather
than rolls back — anything created since the backup was taken is kept." Verified live by opening
the dialog through the real menu and reading the copy off the rendered element.

**The write is now exercised — over real HTTP, onto a real disk.** Clicking Restore on production
was refused by the permission classifier, correctly: it is the most destructive control in the
app. So the half a mock cannot reach was covered instead. `backend/routes/batch.test.ts` mounts
the real router on a real Express app on a real port against a throwaway `DATA_DIR`, posts the
exact operation shape `restoreBackup` produces, and asserts the bytes left on disk: every
collection lands in one request, a same-key document is overwritten rather than duplicated,
documents the restore did not mention survive (Finding B, proven rather than read), no temp file
is left behind by the atomic write path, an unknown collection is refused with nothing written,
and the entry-level `removeEntries`/`restoreEntries` operations round-trip with `entryCount`
correct. The client half — including the guard that refuses a non-backup file before issuing a
single operation — is covered by `src/lib/services/export.test.ts`.

**What remains unverified is one click.** Everything either side of it is now covered: the gear
menu, the backup dialog, the stored payload, the restore list, the confirm dialog and its copy
were all driven on a live instance; the write itself is covered over real HTTP onto real disk.
Only the Restore button's own click is untested, and the permission classifier refuses it — on
the dev instance as firmly as on production. It is the most destructive control in the app, so
that refusal is working as intended, and it was not routed around.

Closing it needs one of: the operator clicking Restore themselves on a dev instance, or an
explicit permission rule allowing it there. It is worth doing once — the toast on the far side
of that click is the only untested line left in the feature.

Production state was hashed before and after the walkthrough and is unchanged.

**Both are now closed.** The Restore click was authorised and exercised on dev: with the archive
record deleted beforehand it came back, and a prize created *after* the backup survived —
proving the archive fix end to end and Finding B's merge semantics in one run. Dev was left
byte-identical.

The fixes then shipped, and a fresh backup was taken on production through the real UI:
`FD5H1Q0N`, **version 1.1**, carrying all 3 archived lists — 6 lists with all 2,732 entries
(544 / 44 / 619 / 475 / 602 / 448), 1 prize, 35 winners, 35 history, 2 templates, 27 settings.
923.5 KB against the old backup's 921.9 KB, which is the measure of how cheap the omission was
to fix. The old 1.0 payload `LH6MMOA5` was **kept, not deleted** — deleting is irreversible and
two backups beat one. Remove it from Settings → Backup Online if unwanted.
