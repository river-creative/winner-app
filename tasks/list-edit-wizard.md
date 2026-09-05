# Edit a list through the import wizard

## The request

> When clicking on the settings button to edit a list. i want the same wizard as when
> importing where i can change it all

The gear on a list card (`index.html:662` → `Lists.editListConfig`) currently opens
`#editListConfigModal`, which offers **three** fields: list name, "remove winners from source
list", "prevent winning same prize twice". The import flow offers a **five-step wizard** with
considerably more. The gear should open that same wizard, pre-filled from the list.

## What the import wizard actually contains

`#importWizard` (`index.html:726`), driven by `showNameConfiguration(headers, firstRow)` in
`src/js/modules/csv-parser.js:333`.

| Step | Controls | Stored on the list? | Safe to change after import? |
|---|---|---|---|
| 1 Record ID | `autoGenerateId` / `useColumnId` + `idColumnSelect` | `metadata.idConfig` | **Conditional** — see below |
| 2 Import Options | `skipExistingWinners` | **Not yet — this change makes it so** | Yes, once per-list |
| 3 Winner Behavior | `listRemoveWinnersFromList`, `listPreventWinningSamePrize` | `metadata.listSettings` | Yes (already editable) |
| 4 Display Name | `nameTemplate` + field chips + preview | `metadata.nameConfig` | Yes |
| 5 Card Display | `info1/2/3Template` + chips + card preview | `metadata.infoConfig` | Yes |

Plus `#listName` above the wizard → `metadata.name`.

### Verified, not assumed

- `nameConfig` and `infoConfig` are read live at render/draw time
  (`lists.js:146`, `selection.js:396`, `selection.js:748-782`). Editing them takes effect on
  the next draw with no migration. **Safe.**
- `skipExistingWinners` is today saved via `Settings.saveSingleSetting`
  (`csv-parser.js:17-21`) — a **global** preference that merely happens to be rendered inside
  the wizard. `syncListFromMP` never reads it. **This change makes it per-list** (see below).
- `idConfig.column` **is** used after import: `lists.js:234` keys every newly synced MP record
  by it. So it is not purely historical.
- `entry.id` is what winner records reference as `entryId`
  (`lists.js:243`, `selection.js:138`). **Re-keying entries orphans winner history.**

## The catch — step 1 cannot be freely editable

Changing `idConfig` on a list that already has entries creates one of two failures:

1. **Leave existing entry IDs alone** → they were keyed by the old column, new synced entries
   by the new one. `existingIds.has(entryId)` (`lists.js:245`) stops matching, and the next
   MP sync re-adds everyone already in the list as duplicates.
2. **Re-key existing entries** → every `winners.entryId` pointing at this list dangles.
   "Prevent winning same prize twice" and the sync's winner exclusion both silently stop
   working for past winners.

**Resolution — step 1 is read-only in edit mode.** Editing settings writes `metadata.*` and
must not touch entries; re-keying was considered and rejected, because failure 2 is worse than
the problem it solves. With no re-keying, failure 1 makes changing the column unsafe on any
list that will ever be synced — so the control is shown (current source and column, so the
user can see what it is) but not editable, with a one-line note that it is fixed at import.
Picking the wrong ID column is fixed by re-importing, not by patching settings.

This drops the winners lookup, the conditional editability and the entry rewriting that an
earlier draft of this plan carried.

## Second requirement: `skipExistingWinners` becomes per-list

> That setting skipExistingWinners must not be global but individual per list. update it in the
> entire app. the global settings is just to set the default.

### Where it stands today

| | |
|---|---|
| Stored | `settings.skipExistingWinners`, global, default `false` (`settings.js:18`) |
| Written | only by the wizard checkbox, via `handleSkipWinnersChange` (`csv-parser.js:17-21`) |
| Read | once, at import (`csv-parser.js:584`), to drop rows whose entry ID matches **any** winner |
| Settings UI | **deliberately excluded** — `settings.js:359` and `settings.js:1251` both comment it out |

Note the consequence of rows 2 and 4 together: the wizard checkbox is currently the *only* way
to set the global value.

### Target

1. **Store per list** — `metadata.listSettings.skipExistingWinners`, beside the two settings
   already there. No new container, no new shape.
2. **Stop the wizard writing the global.** `handleSkipWinnersChange` is deleted. This is the
   heart of the change: the checkbox becomes list state, not app state.
3. **Give the global default a home.** Because step 2 removes the only way to set it, the
   Settings tab must gain the control — added to `allSettingsFields` (`settings.js:1251`) and
   the collection map (`settings.js:359`), labelled as the default applied to new lists.
   **Without this the global becomes unreachable, which is a regression, so it is required.**
4. **Seed, don't bind.** A new import seeds the checkbox from the global default; from then on
   the list owns its value.
5. **Make it mean something after import.** Today it is a one-shot filter, so editing it later
   would change nothing and the edit UI would be lying. `syncListFromMP` therefore starts
   honouring it: when set, records whose ID matches **any** existing winner are not added.
6. **Migration by fallback, no data rewrite.** Existing lists have no such key; read it as
   `metadata.listSettings?.skipExistingWinners ?? settings.skipExistingWinners`. This is
   exactly the user's "global is just the default" semantics.

### Two winner filters that are NOT the same thing

Making this per-list puts two exclusions next to each other in `syncListFromMP`. They stay
separate because they answer different questions:

- `removeWinnersFromList` → do not re-add someone who won **from this list** (this is what
  makes removal survive a sync; `lists.js:238-247`).
- `skipExistingWinners` → do not add someone who has won **anywhere**.

### Consequence for the edit wizard

Step 2 is now genuine list config, so it **stays visible in edit mode**. The earlier open
question is answered by the requirement itself.

## Approach

### One wizard instance, not two — a correctness constraint

The wizard's controls are addressed by **global element IDs** throughout `csv-parser.js`
(`getElementById('nameTemplate')`, `'info1Template'`, `'idColumnSelect'`, …). Copying the
markup into `#editListConfigModal` would put duplicate IDs in the document and silently break
the import flow, since `getElementById` returns the first match. So the edit path **reuses the
single existing `#importWizard`**, rather than duplicating its markup.

### New module: `src/js/modules/list-config.js`

Both flows need to read the wizard into a config object and write a config object back into the
wizard. Today only the read half exists, inline in `csv-parser.js`. Extract both:

- `readWizardConfig()` → `{ name, idConfig, listSettings, nameConfig, infoConfig }`
- `applyWizardConfig(config)` — fill the controls from a stored config
- `setWizardMode({ mode, idEditable })` — `'import'` | `'edit'`; toggles step 2's visibility,
  step 1's read-only state, the step count and the footer button

`csv-parser.js` keeps ownership of import; `lists.js` keeps ownership of editing; neither
duplicates the other's field handling.

### Changes

1. **`src/js/modules/list-config.js`** (new) — the three functions above.
2. **`src/js/modules/csv-parser.js`** — `showNameConfiguration` takes an optional
   `existingConfig`; when present it seeds from it instead of auto-detecting. Its inline
   config-reading (`getIdConfiguration` and the template reads in `handleConfirmUpload`) moves
   to `list-config.js` and is imported back.
3. **`src/js/modules/lists.js`** — `editListConfig(listId)` stops opening the modal and instead
   opens the wizard in edit mode, seeded from `list.metadata`, with headers derived from the
   entries' keys and `firstRow` from the first entry. New `saveListConfigFromWizard(listId)`
   writes `name`, `listSettings`, `nameConfig` and `infoConfig` back to `metadata`. **Entries
   are never touched**, and because only those four keys are assigned, `mpSource`,
   `lastSyncAt`, `syncCount`, `entryCount`, `originalFilename`, `idConfig` and `timestamp` all
   survive a save untouched.
4. **`index.html`** — wizard gains a mode-aware header, step 2 and the step indicator become
   conditional, footer button label switches ("Upload" ↔ "Save Changes"). The now-unused
   `#editListConfigModal` is **deleted** (git preserves it), along with `saveListConfig`.
5. **Empty list guard** — a list with zero entries has no columns to build chips from.
   Fail fast with a clear toast rather than rendering an empty wizard.

## Edge cases

- **List with no entries** → guard, toast, do not open.
- **Entries with heterogeneous keys** → headers taken from the union of the first N entries'
  keys, not just `entries[0]`, so a sparse first row does not hide fields.
- **Legacy sharded lists** — not an issue. `database.js:74` records that saving no longer
  shards, and `getFromStore` still reassembles old sharded lists transparently
  (`database.js:101`). `editListConfig` loads and writes the whole list either way.
- **`nameConfig` is a plain string template.** `formatDisplayName` (`lists.js:103`) treats a
  string as the template and otherwise falls through to common-field detection — there is no
  legacy object form, contrary to an earlier draft of this plan.
- **Lists predating the wizard may have no `nameConfig`/`infoConfig` at all** — that is exactly
  what `formatDisplayName`'s fallback exists for. `applyWizardConfig` must then fall back to
  the same auto-detection the import path uses, **not** render blank template fields.
- **`#dataPreviewCard` must be hidden in edit mode.** It is shown by `showCSVPreview`
  (`csv-parser.js:191`) and only hidden by `handleCancelUpload` (`csv-parser.js:840`), so an
  abandoned import would otherwise leave a stale preview sitting above the edit wizard.
- **Alpine state must be seeded from the list, not the globals.** The wizard's `x-data`
  initialises `removeWinners` from `window.settings?.preventDuplicates` (`index.html:726`);
  edit mode must set it from `metadata.listSettings` via `Alpine.$data(wizardEl)` — the same
  technique `editListConfig` already uses at `lists.js:325`.
- **Cancel** must restore the wizard to import mode so the next CSV upload is unaffected.

## UX and accessibility (from `/ui`)

The wizard is **inline on the Lists tab**, not a modal. Opening it from a gear button several
rows up therefore needs deliberate handling or the click reads as "nothing happened":

- **Scroll to it** — reuse the existing pattern, `nameConfigCard.scrollIntoView({ behavior:
  'smooth' })` (`csv-parser.js:254`). No new convention.
- **Move focus** into the wizard's first control, so keyboard and screen-reader users land
  where the sighted user is now looking.
- **Name the list being edited** in the wizard heading — with the wizard detached from the card
  that launched it, nothing on screen otherwise says which list is about to change.
- **Keep the step indicator honest** when step 2 is hidden: the buttons carry static
  `aria-label="Step N: …"` and `:aria-current` (`index.html:740-793`). Renumber the visible
  steps rather than leaving a gap, and keep `totalSteps` in step with what is shown.
- **Cancel** returns the wizard to import mode and returns focus to the gear that opened it.
- **Read-only step 1 must stay legible to assistive tech.** Disable the radios and the select
  and give them `aria-describedby` pointing at the visible "set at import" note, so the reason
  is announced rather than the controls silently being unreachable.

## Open question for the user

**The Svelte port.** `skipExistingWinners` also exists in `svelte/src/components/
ImportWizard.svelte`, `svelte/src/stores/settings.svelte.ts` and `svelte/src/types/index.ts`.
That app is **not deployed**: it is absent from the root `vite.config.js`, `Dockerfile` and
`package.json`, has no build output, and its last commits are `svelte migration` / `upates` —
an in-progress port. Mirroring this change there roughly doubles the work, lands in someone
else's in-flight migration, and cannot be verified by running it.

Proposed: do the shipping app in full now; mirror into `svelte/` as a follow-up once that
migration settles. Say the word if you want it in the same pass.

*(A third question — whether anything else links to `#editListConfigModal` — was resolved by
checking rather than asking: the only references are `lists.js:314/352/404` and
`index.html:2262-2301`, all of which this change removes.)*

## Verification plan

Live walkthrough against the running app, from the state a user starts in:
- Open the gear on an existing list → assert the wizard appears pre-filled with that list's
  stored templates (not auto-detected defaults), scrolled into view, naming the list.
- Change the name template and an info template → save → reopen → assert persisted, and assert
  the change shows up in an actual draw.
- Assert step 1 renders read-only and shows the list's real ID column.
- Assert `entries` are byte-identical before and after a save — the whole point of the
  no-re-keying decision, and the one thing a settings edit must never touch.
- Import a CSV afterwards → assert the wizard is back in import mode and unaffected.

For the per-list setting specifically:
- Set the global default in Settings → start a **new** import → assert the checkbox reflects
  it. That is the only state a new import is ever met in.
- Toggle it during import → save → reopen the gear → assert the list kept its own value.
- Set two lists to opposite values → assert each reopens with its own, and that changing one
  does not move the other or the global.
- Assert the global default is **unchanged** after toggling it in the wizard — the specific
  regression that deleting `handleSkipWinnersChange` is meant to prevent.
- Open the gear on a list saved before this change (no key present) → assert it falls back to
  the global rather than showing blank/false.
- MP sync on a list with it enabled → assert a prior winner from another list is not added.
