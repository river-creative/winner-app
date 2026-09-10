# Open items after the production walkthrough — dispositions

Status: two diagnosed and closed, three blocked on something only the operator can supply.

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

## 3. Blocked — each needs the operator

- **A real SMS.** Everything up to dispatch is verified: confirmation dialog, template resolution,
  phone-field precedence, rendered message, `sms: null` afterwards proving nothing was sent. Only a
  live send to a number the operator owns remains. A public one-time SMS number is not a substitute
  — those pools are filtered by bulk gateways, so a failure would not distinguish a broken app from
  a junk number, the inbox is public, and the number may belong to someone real.
- **Ministry Platform / Pretix import.** Hits external systems and pulls real personal data into a
  new list. Note there is already a query named **"Mauch | Sun AM"** (`main-event-mauch`) that
  appears scoped to one person — that is the clean way to do "import only me" for real.
  MP *sync* on an existing live list is a separate matter: it mutates that list, so it should not
  be run against Thu AM and friends casually.
- **Backup / restore.** Cannot be tested on production: restore overwrites collections wholesale,
  and the app's own backup store was empty so there was nothing safe to restore from. Attempted on
  the dev instance instead and blocked at authentication — the dev app needs a signed-in session
  and the admin credentials must not be handled here. Sign in at the dev URL and it can be run.
- **QR scanner.** Needs a camera and a printed wristband.
