# The toast stack is orphaned by any confirm dialog — plan

**Status: root-caused and verified on a live instance. Not implemented — awaiting approval.**

This is a defect found while verifying something else (the restore click). It is outside the
scope that was asked for, which is why it is a plan rather than a commit.

## What breaks

Closing a confirmation dialog permanently disables the app's entire toast channel for the life
of the page. Every later toast still fires — it is rendered into a node that is no longer in the
document, so nobody ever sees it.

Clicking **Cancel** is enough. It does not need an error, an unusual sequence or a slow network.

## Root cause

`src/lib/state/layers.ts` moves `.app-toasts` and `.progress-overlay` *into* whichever `<dialog>`
is open. That part is right and the reasoning in its header is sound: nothing outside the
browser's top layer can paint above a modal, so a toast fired from inside a form would otherwise
never be seen.

The defect is in how the elements are found on the way back out:

```ts
function moveOverlaysTo(target: HTMLElement): void {
  for (const selector of OVERLAY_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);   // ← here
    if (element && element.parentElement !== target) target.appendChild(element);
  }
}
```

`releaseOverlays()` runs from `Dialog.svelte`'s `$effect` cleanup. By then Svelte's `{#if}` has
already detached the dialog subtree — and the overlay is inside it. `document.querySelector`
only searches the live document, so it returns `null`, the `if` guard swallows it, and the move
silently does nothing. The node stays parented to a dead `<dialog>` forever.

Svelte still holds its own reference and keeps rendering toasts into it. That is why the failure
is invisible: nothing throws, nothing logs, and the only symptom is an absence.

## Evidence

Measured on a live dev instance, unpatched, driving the real UI with real clicks. A reference to
the node was captured on load and followed through the flow:

| Step | `document.contains(node)` | `node.parentElement` |
| --- | --- | --- |
| fresh load | `true` | `BODY` |
| confirm dialog open | `true` | `DIALOG` (by design) |
| **after clicking Cancel** | **`false`** | `DIALOG` (detached) |

`document.querySelector('.app-toasts')` returns `null` from that point on.

Then, with the stack orphaned, Save Backup was clicked with an empty name — which must produce
`"Please give the backup a name."`:

- on screen: nothing
- inside the detached node: `["Please give the backup a name."]`

So the toast fired and was swallowed. The same happens to `"Could not restore that backup."` and
to every save error.

## Why it was never noticed

Both overlay components were written on the assumption that their container is permanent, and
both say so in their own comments — `Toasts.svelte`: *"the container is always in the DOM so the
region is registered before the first message arrives"*; `ProgressOverlay.svelte`: *"The
container is always in the DOM, hidden by class rather than by `{#if}`"*. That assumption is
correct about how they are rendered and wrong about what `layers.ts` then does to them.

Nothing in the test suite can see it: the suite is green, and the write behind every one of
these toasts succeeds. It took driving the real UI.

## The fix

Hold live references instead of re-querying a document the node has already left. Each overlay
registers itself as it mounts and unregisters as it unmounts, so `layers.ts` can always reach
them and re-parent them to `<body>` regardless of what has been detached.

```ts
// layers.ts
const overlays = new Set<HTMLElement>();

/** Called by each overlay as it mounts. The returned function unregisters it. */
export function registerOverlay(element: HTMLElement): () => void {
  overlays.add(element);
  // Adopt straight into whatever is already open — an overlay that mounts while a dialog is up
  // would otherwise sit in <body>, behind the top layer, which is the bug this module exists for.
  moveOverlaysTo(stack[stack.length - 1] ?? document.body);
  return () => overlays.delete(element);
}

function moveOverlaysTo(target: HTMLElement): void {
  for (const element of overlays) {
    if (element.parentElement !== target) target.appendChild(element);
  }
}
```

and in `Toasts.svelte` / `ProgressOverlay.svelte`:

```svelte
let element: HTMLDivElement;
$effect(() => registerOverlay(element));
...
<div class="app-toasts" bind:this={element} ...>
```

`OVERLAY_SELECTORS` goes away with the last `querySelector`.

### Why this shape

- **Correct by construction, not correct if remembered.** The node cannot be lost, because
  nothing has to find it again. That is the property the current code lacks, and it ranks above
  minimal-diff in `CLAUDE.md`'s precedence.
- **No new convention.** `bind:this` plus an `$effect` returning its cleanup is already the
  pattern in `Dialog.svelte` and `SessionExpiredOverlay.svelte`. Svelte 5.57 also offers
  `{@attach}`, which would be idiomatic in a greenfield file, but the codebase has no `{@attach}`
  or `use:` anywhere and introducing one here would earn nothing.
- **It fixes the class, not the instance.** Any future overlay registers the same way.

### Test

A component test that mounts the layout's overlays, opens and closes a dialog, and asserts
`document.querySelector('.app-toasts')` is still found — and that a toast fired afterwards is
visible in the document. It must be shown failing against the current `layers.ts` before it is
trusted.

## Also noticed, not part of this

`SessionExpiredOverlay` is mounted in the same layout but is not in `OVERLAY_SELECTORS`, so it
is not moved into an open dialog and would be painted behind one. Whether that matters depends
on whether a session can expire while a modal is up — worth a look, separately, and not bundled
into this fix.
