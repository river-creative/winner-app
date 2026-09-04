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
 * at all. There is no reactivity here to get into that argument with: `Dialog.svelte` calls these
 * two functions directly, and the overlays never know it happened.
 */

/** Open dialogs, oldest first. A confirmation opened from inside a form is a real flow. */
const stack: HTMLDialogElement[] = [];

/** The overlays that must follow the top of the stack. Both are always in the DOM. */
const OVERLAY_SELECTORS = ['.app-toasts', '.progress-overlay'];

function moveOverlaysTo(target: HTMLElement): void {
  for (const selector of OVERLAY_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);
    // `position: fixed` survives the move: its containing block is the viewport, and nothing
    // here establishes another one, so the overlay stays put and is not clipped by the dialog's
    // own scrolling.
    if (element && element.parentElement !== target) target.appendChild(element);
  }
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

  const next = stack[stack.length - 1];
  moveOverlaysTo(next ?? document.body);
}
