# Edit a list through the import wizard (Svelte 5 port of `8aaa9b7`)

Port of main's `8aaa9b7` — *feat(lists): edit a list through the import wizard, and make
skip-winners per-list* — onto the Svelte 5 branch. Main's own plan is `tasks/list-edit-wizard.md`
on `main`; this document records what the port keeps, what it drops because the Svelte
architecture already solved it, and the two places it deliberately departs.

## The two requirements, unchanged

1. **The gear on a list card opens the five-step wizard, pre-filled from the list**, instead of a
   three-field dialog (`ListSettingsDialog.svelte`: name + the two winner toggles).
2. **`skipExistingWinners` becomes per-list.** The global setting is only the default a *new*
   list starts from; each list owns its value from import onwards, and lists imported before this
   existed fall back to the global.

## What the Svelte branch already has

| Piece | On `main` (Alpine) | Here |
|---|---|---|
| Wizard | `#importWizard`, inline on the Lists tab, driven by global element ids | `ImportWizard.svelte`, a native `<dialog>`, all state local |
| Edit UI | `#editListConfigModal` + `Lists.saveListConfig` | `ListSettingsDialog.svelte` + `saveList` |
| Winner toggles | duplicated markup in wizard and modal | `WinnerBehaviourFields.svelte`, shared |
| Per-list settings | `metadata.listSettings` | same, typed as `ListSettings` |
| Sync | `syncList` in `lists.js` | `syncListFromMp` in `services/lists.ts` |
| Global settings | `Alpine.$persist` + `settings.js` field maps | `DEFAULT_SETTINGS` + `SettingCheck` |

### What that removes from the port

Most of main's complexity is Alpine bookkeeping that has no counterpart here, and porting it
would be porting the workaround rather than the fix:

- **`list-config.js` in full.** `readWizardConfig` / `applyWizardConfig` / `setWizardMode` exist
  because the wizard is one DOM instance addressed by global ids, so both flows have to read and
  write the same controls. Here the wizard is a component with local state: the edit flow passes
  a list in and the component seeds its own fields. There is nothing to read back out of the DOM
  and nothing to reset.
- **Mode restoration on cancel.** Main must hand the wizard back in import mode or the next CSV
  upload opens a wizard still locked to the list that was edited. Closing this dialog destroys
  the component; `{#key}` on the parent builds a fresh one per target.
- **`step = 1` on open, `#dataPreviewCard` hiding, duplicate-id renaming
  (`listSkipExistingWinners`), `dispatchEvent(new Event('change'))` to notify Alpine.** All are
  consequences of a shared DOM instance and a shared id namespace.
- **`scrollIntoView` + `focus({ preventScroll: true })`.** The wizard is inline on main, several
  cards below the gear that opened it. Here it is a modal dialog in the top layer, and
  `Dialog.focusInitial` already puts focus on the first field.

What is left is the substance: an edit mode, a read-only record ID step, a per-list setting, a
sync that honours it, and a Settings control for the default.

## Design

### One component, two targets

`ImportWizard.svelte` takes a discriminated union rather than a bare `ImportSource`:

```ts
export type WizardTarget =
  | { mode: 'import'; source: ImportSource }
  | { mode: 'edit'; list: List };
```

The union is what makes the invariant unbreakable: there is no state where a list is supplied
but the wizard behaves as an import, or the reverse. Internally the edit branch turns its list
into the same `ImportSource` the import branch supplies (`listAsImportSource`), so every existing
derivation — `headers`, `firstRow`, `previewRows`, the chips, the previews — is untouched.

The file keeps its name. It is still the import wizard; editing is the second flow it serves, and
its header comment says so, exactly as main's `list-config.js` does. Renaming it would rewrite
the "the import wizard's …" references in `services/lists.ts` and `eligibility.ts` for no
behavioural gain.

### Step 1 is read-only when editing

Carried verbatim from main, including the reasoning, because it is a data-integrity constraint
rather than a UI choice. Changing `idConfig` on a list that already has entries fails one of two
ways:

1. **Leave the entry ids alone** → new synced records are keyed by the new column,
   `knownIds.has(entryId)` (`services/lists.ts`) stops matching, and the next sync re-adds
   everyone already in the list as duplicates.
2. **Re-key the entries** → every `winners.entryId` pointing at this list dangles, and both
   `preventsSamePrize` and the sync's winner exclusion silently stop working for past winners.

So the step stays *visible* — an operator has to be able to see what the list is keyed by — with
its radios and its `<select>` disabled, an explanatory note, and `aria-describedby` on each
control pointing at that note so the reason is announced rather than the controls being silently
unreachable. Picking the wrong ID column is fixed by re-importing, not by editing settings.

Two details that follow from it:

- The stored column may no longer be among the list's fields (an MP query that dropped it). The
  `<select>` is disabled, so without an extra option the one thing the step exists to show would
  render blank for exactly the lists where it matters most. It gets an option labelled
  `<column> (no longer in this list)`.
- The "Auto-selected" badge is suppressed in edit mode: the column is the list's own, not a guess.

### `skipExistingWinners` per list

| | Today | After |
|---|---|---|
| Stored | `settings.skipExistingWinners`, global | `metadata.listSettings.skipExistingWinners`, per list |
| Written by | the wizard checkbox, via `settings.set` | nothing but the list itself |
| Read at import | `ImportWizard.runImport` | unchanged |
| Read at sync | never | `syncListFromMp` |
| Settings screen | absent | present, labelled as the default for new lists |

1. **`ListSettings.skipExistingWinners?: boolean`** — optional, because a list imported before
   this change genuinely has no value, and typing it as present would be a lie the fallback then
   has to work around.
2. **The wizard stops writing the global.** `setSkipExistingWinners` is deleted; the checkbox
   becomes ordinary local state seeded from the global on import and from the list on edit.
3. **The Settings screen gains the control.** Deleting the only writer of the global would
   otherwise make the default unreachable — a regression, so this is required, not optional.
4. **The sync honours it.** Without this, editing the setting after import would change nothing
   and the edit UI would be lying about what it does.

`removeWinnersFromList` and `skipExistingWinners` answer different questions and stay separate:
the first keeps someone who won **from this list** from being re-added (this is what makes a
removal survive a sync), the second keeps out anyone who has won **anywhere**.

The draw is deliberately not involved. `skipExistingWinners` filters what enters a list; who may
be *drawn* from it is `buildEligibility`'s job, and conflating the two would silently change
every existing list's draw behaviour.

## Changes

### `src/lib/types/index.ts`
- `ListSettings` gains optional `skipExistingWinners`, documented as "absent on a list imported
  before this existed — read it through `skipsExistingWinners`".

### `src/lib/services/lists.ts`
- **`skipsExistingWinners(list, globalDefault)`** — the single resolution of the per-list value
  and its fallback, so the wizard cannot show one answer while the sync applies another. Pure,
  with the global passed in, matching `buildEligibility(…, globalPreventSamePrize)`.
- **`listAsImportSource(list)`** — an existing list as the wizard's input: `rows` from
  `entry.data`, `headers` from `fieldNames(rows)` (the union of a sample, so a record missing a
  field cannot hide a column), `listName` from the metadata, `mpSource` carried through.
- **`syncExclusionIds(listId, winners, { excludeWinnersOfThisList, excludeAllWinners })`** — pure,
  and the one piece of new sync behaviour, so it is unit-testable without the API. Reuses
  `existingWinnerIds` for the "won anywhere" set, which also picks up the legacy records that
  used `winnerId` as the record id.
- **`saveListConfig(list, config)`** — writes `name`, `nameConfig`, `infoConfig` and
  `listSettings` and nothing else. Entries are untouched by construction (the list is spread),
  and so are `idConfig`, `mpSource`, `lastSyncAt`, `syncCount`, `entryCount`, `originalFilename`
  and `timestamp`.
- **`syncListFromMp`** — the exclusion set now comes from `syncExclusionIds`.

`removeWinnersFromList !== false` in the sync is left as it is, rather than routed through
`removesWinners(list)`, which falls back to the global `preventDuplicates`. The difference is
unobservable — a list that never removed its winners still holds them, so they are already in
`knownIds` — and changing the default direction here would risk re-adding removed winners.

### `src/lib/components/lists/ImportWizard.svelte`
- `target: WizardTarget` replaces `source: ImportSource`; every field seeds from the list in edit
  mode, falling back to the same detection the import path uses when a legacy list has no
  `nameConfig`/`infoConfig` — a list saved before a field existed must inherit the detected
  default, not an empty control.
- Dialog title names the list; the list-name help text stops talking about the CSV filename.
- Step 1 read-only, per above. Step 2 keeps main's new copy, including that the rule also applies
  to Ministry Platform syncs.
- The commit button becomes "Save Changes", the skip-ahead button "Save Now", and the confirm
  path calls `saveListConfig` instead of `buildList`/`saveList`. It carries the same spinner and
  disabled state the import path has, which `ListSettingsDialog` also had — a save that writes to
  the server must say it is running.
- The locked note precedes the controls it describes in DOM order, so it is read before them. A
  disabled control is out of the tab order, so the visible alert, not `aria-describedby` alone,
  is what has to carry the reason.
- `preventSamePrize` seeds from the **stored** value, which is what `ListSettingsDialog` already
  does here and what main's `applyWizardConfig` could not do (Alpine owned that checkbox through
  a one-way `:checked` binding, so restoring it would have made the saved value depend on which
  list had been opened previously).

### `src/lib/components/lists/ListSettingsDialog.svelte`
- Deleted. Its two behaviours the wizard now carries; git preserves it.

### `src/lib/components/lists/WinnerBehaviourFields.svelte`
- `noticeVariant` is dropped. It existed to give the deleted dialog an `info` alert where the
  wizard has a `warning` one; with one caller left it is a dead branch.

### `src/routes/(app)/(console)/lists/+page.svelte`
- The gear opens the wizard in edit mode. `ListSettingsDialog` goes with its import.

### `src/routes/(app)/(console)/settings/+page.svelte`
- A `SettingCheck` for `skipExistingWinners` in General Settings, labelled and tooltipped as the
  default new lists start from.

### `src/lib/services/lists.test.ts` (new)
- `syncExclusionIds`: neither rule excludes anything; this-list only; anywhere only; both.
- `skipsExistingWinners`: the list's own `true`/`false` wins; a list with no value falls back to
  the global, in both directions.
- `listAsImportSource`: headers are the union across entries, not the keys of the first one.

## Two deliberate departures from `main`

1. **A list with no entries still opens.** Main refuses with a toast, because its wizard is built
   by populating a DOM that would otherwise be empty. Refusing here would *remove* a capability
   this branch has — `ListSettingsDialog` renames any list, entries or not — so the wizard opens
   and the two field-dependent areas (the data preview, the chip rows) render an empty state
   saying the list has no fields, instead of an empty box. Name, winner behaviour and the skip
   setting stay editable.
2. **No `aria-describedby` gymnastics or focus management beyond the dialog's own.** Handled by
   `Dialog`, as above.

## Third requirement: an unsaved-changes guard

Escape, a backdrop click, the × and Cancel all discarded whatever was on screen without asking.
That was true of `ListSettingsDialog` too, but a five-step wizard holds considerably more unsaved
work than three fields did — and the edit flow now puts the operator in front of one for a list
that already exists, where "I lost my changes" and "I lost an import I had not run yet" are both
real.

- **Dirtiness is computed from what would be *written*, not from the controls.** Unticking
  "remove winners" forces `preventWinningSamePrize` on, so a save would store something different
  even though that second checkbox was never touched. The comparison is over one object holding
  every editable value, so a field added to the wizard later cannot be left out of it.
- **The guard sits on the one path every dismissal takes.** `Dialog` writes its `open` prop, so
  binding a setter (`bind:open={() => open, (value) => …}` — the shape `ConfirmDialog` already
  uses) intercepts Escape, the backdrop and the × together, and Cancel is pointed at the same
  function. The import and save paths assign `open` directly and are deliberately never asked.
- **A write in flight refuses to close at all.** Cancel is disabled while one runs; Escape must
  not be the way around that.
- Prompt copy differs per mode: an edit has "unsaved changes" and leaves the list as it is, an
  import has "nothing has been imported yet" and names what is being thrown away.

## Verification plan

Baseline before any change: 8 test files, 101 tests, green — and a probe confirmed the node test
project can import `services/lists.ts` with its state imports, so the new tests need no module
mocking and the helpers can stay in the service that owns them.

Unit tests for the pure helpers, `pnpm check`, `pnpm lint`, `pnpm test`, then a live walkthrough
against a running instance — the only thing that proves the feature, per this branch's own bar.
Every check falsified first against the unfixed code.

- Gear on a list card → the wizard opens, titled with the list's name, pre-filled with that
  list's stored templates rather than detected defaults.
- Step 1 shows the list's real ID column and every control in it is disabled.
- Change the name template and an info template → Save → reopen → persisted; and the change shows
  up in an actual draw.
- **`entries` byte-identical across a save** — the point of the no-re-keying decision.
- Set the global default in Settings → start a **new** import → the checkbox reflects it. That is
  the only state a new import is ever met in.
- Toggle it during import → import → reopen the gear → the list kept its own value, and the
  global is **unchanged** — the specific regression that deleting `setSkipExistingWinners`
  prevents.
- Two lists set to opposite values → each reopens with its own.
- A list saved before this change (no key) → falls back to the global rather than showing false.
- MP sync on a list with it enabled → a prior winner from **another** list is not added; with it
  off, the same record is added.
- Escape with a changed field → the discard prompt; "Keep Editing" leaves the wizard open with
  the change intact. Escape with nothing changed → closes straight away.
