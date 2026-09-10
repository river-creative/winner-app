/**
 * Keeping the toast stack and the progress overlay visible above an open modal.
 *
 * Modals are native `<dialog>` elements opened with `showModal()`, which promotes them to the
 * browser's top layer. Nothing outside the top layer can paint above them — not a larger
 * z-index, and (measured in Chrome, not assumed) not a popover shown afterwards either. So a
 * toast fired from inside a form — "could not save" above all, the one that matters most — would
 * simply never be seen.
 *
 * The fix is to move those two elements *into* the dialog while it is open, and hand them back
 * when it closes.
 *
 * Deliberately plain module state, with no runes and no effects. The first version kept the open
 * dialog in `$state` and had each overlay follow it from its own `$effect`; the two effects then
 * invalidated each other on every pass and Svelte aborted the update, so the dialog never opened
 * at all. There is no reactivity here to get into that argument with: `Dialog.svelte` calls
 * `adoptOverlays`/`releaseOverlays` directly, and each overlay calls `registerOverlay` once as
 * it mounts. Those registrations are the only thing the overlays do — they never track which
 * dialog is open, so the mutual invalidation cannot come back.
 */

/** Open dialogs, oldest first. A confirmation opened from inside a form is a real flow. */
const stack: HTMLDialogElement[] = [];

/**
 * The overlays that must follow the top of the stack, held by reference.
 *
 * **Not looked up by selector.** The previous version re-found them with
 * `document.querySelector` on every move, which is unsound in the one case that matters: this
 * module's own callers run from `Dialog.svelte`'s `$effect` cleanup, and Svelte detaches the
 * dialog subtree *before* that cleanup runs. With the overlay inside that subtree it is no
 * longer in the document, so the lookup returned `null`, the move silently did nothing, and the
 * node stayed parented to a dead `<dialog>` for the life of the page — with Svelte still
 * rendering toasts into it. Clicking Cancel on any confirmation was enough, and the only
 * symptom was that "Could not restore that backup." never appeared.
 *
 * A reference cannot go stale that way: there is nothing left to find.
 */
const overlays = new Set<HTMLElement>();

/**
 * The topmost dialog that is still in the document, or `<body>`.
 *
 * The `isConnected` check is the guard, not a formality. Appending an overlay into a node that
 * has already been detached is precisely how this module lost the toast stack for the life of
 * the page, and the stack is only as current as the last `releaseOverlays` call. Rather than
 * depend on every future caller unwinding it in the right order, the target is verified at the
 * moment of use — the one point where being wrong is unrecoverable.
 */
function currentTarget(): HTMLElement {
  for (let i = stack.length - 1; i >= 0; i--) {
    const dialog = stack[i];
    if (dialog?.isConnected) return dialog;
  }
  return document.body;
}

function moveOverlaysTo(target: HTMLElement): void {
  for (const element of overlays) {
    // `position: fixed` survives the move: its containing block is the viewport, and nothing
    // here establishes another one, so the overlay stays put and is not clipped by the dialog's
    // own scrolling.
    if (element.parentElement !== target) target.appendChild(element);
  }
}

/**
 * Called by each overlay as it mounts; the returned function unregisters it.
 *
 * It adopts immediately rather than waiting for the next dialog, because an overlay that mounts
 * while one is already open would otherwise sit in `<body>` — behind the top layer, which is
 * the whole problem this module exists to solve.
 */
export function registerOverlay(element: HTMLElement): () => void {
  overlays.add(element);
  moveOverlaysTo(currentTarget());
  return () => {
    overlays.delete(element);
  };
}

/** Called by a dialog as it opens. */
export function adoptOverlays(dialog: HTMLDialogElement): void {
  if (!stack.includes(dialog)) stack.push(dialog);
  moveOverlaysTo(dialog);
}

/** Called by a dialog as it closes, handing the overlays to whatever is still open beneath. */
export function releaseOverlays(dialog: HTMLDialogElement): void {
  const index = stack.indexOf(dialog);
  if (index !== -1) stack.splice(index, 1);

  moveOverlaysTo(currentTarget());
}
