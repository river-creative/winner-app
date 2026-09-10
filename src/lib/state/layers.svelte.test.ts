/// <reference types="@testing-library/jest-dom/vitest" />
import { render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Handing the overlays back when a dialog closes.
 *
 * `layers.ts` moves the toast stack and the progress overlay *into* an open modal, because
 * nothing outside the browser's top layer can paint above one. Getting them back out is the
 * half that broke.
 *
 * The bug this covers, measured on a live instance: clicking **Cancel** on any confirmation
 * orphaned the toast stack for the life of the page. `releaseOverlays` re-found the element
 * with `document.querySelector`, but Svelte's `{#if}` detaches the dialog subtree *before* the
 * effect cleanup runs — so the lookup returned `null`, the move silently did nothing, and the
 * node stayed parented to a dead `<dialog>`. Svelte kept rendering toasts into it, which is why
 * nothing threw and the only symptom was an absence: "Could not restore that backup." simply
 * never appeared.
 *
 * So the ordering below is the point. A test that calls `releaseOverlays` while the dialog is
 * still attached passes against the broken code and proves nothing.
 */

const { adoptOverlays, releaseOverlays } = await import('./layers');
const { default: Toasts } = await import('$lib/components/Toasts.svelte');
const { toasts } = await import('./toasts.svelte');

/** The stack is a module singleton, so a leftover dialog would leak into the next test. */
let openDialogs: HTMLDialogElement[] = [];

function openDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  document.body.appendChild(dialog);
  adoptOverlays(dialog);
  openDialogs.push(dialog);
  return dialog;
}

/** What Svelte actually does: detach the subtree, *then* run the effect cleanup. */
function destroyDialog(dialog: HTMLDialogElement): void {
  dialog.remove();
  releaseOverlays(dialog);
  openDialogs = openDialogs.filter((d) => d !== dialog);
}

const stack = () => document.querySelector('.app-toasts');

beforeEach(() => {
  for (const dialog of [...openDialogs]) destroyDialog(dialog);
  openDialogs = [];
  toasts.clear();
});

describe('releaseOverlays', () => {
  it('moves the toast stack into a dialog as it opens', () => {
    render(Toasts);
    const dialog = openDialog();

    expect(stack()?.parentElement).toBe(dialog);
  });

  // The one that was failing. Cancel on any confirmation was enough to reach it.
  it('hands the stack back even though the dialog is already detached', () => {
    render(Toasts);
    const dialog = openDialog();
    destroyDialog(dialog);

    expect(stack()).not.toBeNull();
    expect(document.contains(stack())).toBe(true);
  });

  // A confirmation opened from inside another dialog is a real flow — restore is exactly this.
  it('hands the stack down to the dialog still open beneath', () => {
    render(Toasts);
    const outer = openDialog();
    const inner = openDialog();
    expect(stack()?.parentElement).toBe(inner);

    destroyDialog(inner);
    expect(stack()?.parentElement).toBe(outer);

    destroyDialog(outer);
    expect(document.contains(stack())).toBe(true);
  });

  // The failure is invisible from the store's side: the toast fires either way. What breaks is
  // whether anyone can see it, so that is what gets asserted.
  it('shows a toast fired after a dialog has been through its whole lifecycle', async () => {
    render(Toasts);
    destroyDialog(openDialog());

    toasts.error('Could not restore that backup.');
    await Promise.resolve();

    const visible = [...document.querySelectorAll('.app-toast')].filter((node) => document.contains(node));
    expect(visible.map((n) => n.textContent?.trim())).toContain('Could not restore that backup.');
  });
});
