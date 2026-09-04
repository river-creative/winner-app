# Mobile responsiveness overhaul

**Reported:** "List and Prizes has buttons off the screen. make all pages mobile friendly."
**Date:** 2026-09-04

## What was actually wrong

Reproduced with a headless-Chrome sweep of every tab at 320 / 360 / 390 / 414 / 768 px
before touching anything. The reported symptom was the smallest of eight root causes.

| # | Root cause | Symptom |
|---|---|---|
| 1 | Tab headers were `d-flex justify-content-between` with **no wrap** — a title plus two or three control groups on one rigid row | Lists' *Add* button sat at x=477 on a 320px screen; Prizes' *Date* and *Add* likewise; the management header's *Public View* was clipped |
| 2 | `html { font-size: 11pt }` (≈14.7px) applied on phones too | Below the 16px readability floor, below the threshold at which iOS zooms on field focus, and the reason ~47 controls per tab fell under a 44px touch target |
| 3 | Winners / History / Queries / list-entries tables only "responsive" via a horizontal scrollbar | Pickup, SMS and every row action were off-screen behind a gesture with no affordance |
| 4 | `.history-stats` forced `repeat(2, 1fr)` and `.stat-number` at 2.5rem | A long prize name set a min-content width wider than half the card, so the grid overflowed |
| 5 | Public display locked to `height: 100vh; overflow: hidden` | On a 320×568 phone the big play button was clipped off the bottom and unreachable — you could not start a selection |
| 6 | The tab strip's mobile rule (`overflow-x: auto; white-space: nowrap`) never took effect, because Bootstrap's `.nav` sets `flex-wrap: wrap` | Eight tabs wrapped to three rows instead of scrolling |
| 7 | Seven of the eight `.tab-pane`s were **outside** `#managementTabContent`, sitting as direct children of a Bootstrap `.row` | They inherited `.row > *` padding and gutters, so every inner `.row` spilled 4–12px past the viewport |
| 8 | Hover transforms and glows applied unconditionally | On a touch screen they latch after a tap and stay |

## What changed

### New `src/css/responsive.css`
Every viewport-width rule in the app now lives in one file, loaded after `styles.css` in
`index.html` and `scan.html`. The five `@media (max-width: …)` blocks that were scattered
through `styles.css` were migrated into it (declarations that had turned out to be the
cause of a defect were dropped rather than left to be silently overridden). `styles.css`
keeps its container queries and its print rules and has no width media query left —
keeping the two apart is what let the tab-strip scroll rule sit dead for so long.

Breakpoints are Bootstrap 5's exactly (575.98 / 767.98 / 991.98) so utilities in the
markup and rules in the sheet always agree. Input-modality rules (`hover`, `pointer`) are
width-independent on purpose.

### Layout
- `.section-toolbar` / `.section-toolbar-group` component classes replace the same broken
  header row in five tabs; below md the title takes a row and each control group takes its own.
- **Sort controls collapse to a single dropdown below md** (Lists and Prizes) — three pills
  plus the other toolbar controls cannot share a phone row. Options come from a new
  `$store.sortOptions`, rendered twice (pills at md+, dropdown below) from one definition.
  Both now call the stores' existing `toggleSort()`, which the markup had been ignoring in
  favour of an inline expression that flipped direction when you switched field.
- `.management-header` wraps; the tab strip is a real one-row scroller — snap points, hidden
  scrollbar, faded edges with matching flex spacers, sticky under the header, and the newly
  active tab is scrolled into view.
- List and prize cards: the hidden action drawer is expanded inline on a phone (a hidden
  affordance is worse than one more visible button on touch), actions share one row, and the
  hardcoded `max-width` on card titles is gone.
- The tab panes were moved back inside `#managementTabContent`.

### Tables
`.table-stack` turns each row into a labelled card below md, driven by `data-label` on every
cell. Explicit `role="table|rowgroup|row|cell"` attributes keep the table semantics that
`display: block` would otherwise strip. Applied to Winners, History, Queries, the list-entries
modal and the CSV import preview (the last two bind their labels from the file's own columns).

### Public display
Scrolls on a phone instead of clipping, `100dvh`, safe-area insets, fluid play button, and a
landscape-phone layout. The winner grid halves its column count below sm, and each winner card
becomes its own container-query container: the `cqw` sizes in `styles.css` resolve against the
whole grid, so at two columns a name was sized for a box twice as wide as the one it had to fit,
and long surnames were split mid-word ("Mccutcheon" wanted 175px in a 159px column). Card-relative
sizing stays correct at any column count. Scoped to below sm — a desktop regression check
asserts the projector still gets 2/3/4 columns for 2/6/12 winners with the card container off.

### Touch and input
44px minimum on every control under `@media (pointer: coarse)`, 16px root font and 16px
fields below md (no more zoom-on-focus), hover effects behind `@media (hover: hover)` with a
press state in their place, and modals become full-height sheets via Bootstrap's own
`modal-fullscreen-sm-down` with a sticky footer.

## Defects found and fixed along the way

- **List cards always showed "Synced 12/31/1969".** The sync line used `x-show` on an element
  carrying Bootstrap's `.d-block`, whose `display: block !important` beats the inline
  `display: none` Alpine writes. Now an `x-if` template.
- **The scanner could not find people by surname.** `isTicketCode()` matches any 8–24
  character alphanumeric string, so "Whitmore", "Okonkwo" and "Delacroix" were looked up as
  ticket codes and reported as "No Winner Found". A ticket-code miss now falls through to a
  name search before giving up.
- **Toasts swallowed taps.** A Toastify toast has no click handler in this app but still sits
  above the UI and absorbs the tap — on a phone that meant the play button and every card's
  primary action. Now `pointer-events: none`, and toasts come from the top on a phone.
- **The CSV preview interpolated file content into `innerHTML`.** Column headers, cell values
  and the list name from an uploaded file were built into markup. Now DOM nodes via `SafeHTML`.
  (A parallel session fixed the same class of defect in the MP preview in `a71e834`.)
- `scan.html` blocked pinch-zoom (`maximum-scale=1.0, user-scalable=no`) — WCAG 1.4.4.

## Found by the review pass

Three things the layout sweep could not see, caught by inspecting the change itself:

- **The one `.form-switch` in the app** (Setup → Stable Grid) would have been squared off by
  the enlarged coarse-pointer checkbox sizing. It renders only in sequential/individual mode,
  so no happy path visits it. Fixed, and the walkthrough now switches modes and asserts the
  control is still a pill.
- **Wizard steps were clickable `div`s** — no keyboard access, no accessible name once their
  labels are hidden on a phone. Now `<button>`s with `aria-label` and `aria-current="step"`.
- **`role="columnheader"` was missing** from the stacked tables' headers, the one role the
  explicit-role approach had skipped.

## Verification

Four headless walkthroughs, each driving the real app against the real backend and starting
from the state a user starts in (public view → Manage), all re-run after the last change:

| Suite | Coverage | Result |
|---|---|---|
| Tab sweep | 8 tabs × 7 viewports (320 → 1920) | 63 captures, **0** layout issues, **0** touch-target misses on touch viewports, **0** dangling ARIA references, 0 console errors |
| Overlays | every modal, the 5-step CSV wizard, the Stable Grid switch, a real selection and its winner grid, at 320 and 390 | 28 captures, **0** findings |
| Other pages | login, conditions, scanner (operator prompt → search → results → winner) × 7 viewports | 49 captures, **0** layout issues; the only sub-44px target left on any touch viewport is the vendor Google button |
| Desktop grid | a real selection at 1280px for 2 / 6 / 12 winners | 2 / 3 / 4 columns as `styles.css` specifies, card container-type `normal` — the phone overrides do not reach it |

Checks that could actually fail: the mid-word-break detector was self-tested by forcing the
pre-fix three-column layout back on — it reports `Riverwalk: needs 124 has 99` there and
nothing with the fix. Every `aria-controls` / `aria-labelledby` / `aria-describedby` / `for`
is resolved against the live DOM on every capture. The frontend build was run and the bundled
CSS confirmed to keep `responsive.css` after `styles.css`.

Seed data used by the walkthroughs was removed afterwards; `data/` was diffed against a
pre-run backup to confirm nothing else changed.

## Known and accepted

- The Google Identity Services sign-in button renders at 40px tall. That is the tallest size
  GIS offers (`size: 'large'`); it clears WCAG 2.5.8's 24px minimum but not the 44px platform
  guideline. Changing it means abandoning the official button.
- The MP import preview table still scrolls horizontally rather than stacking. Its rows are
  built in `ministryplatform.js`, which a parallel session was editing; the same `data-label`
  treatment applies whenever that file is next touched.
