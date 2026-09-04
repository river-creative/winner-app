<script lang="ts">
  import type { Snippet } from 'svelte';
  import { adoptOverlays, releaseOverlays } from '$lib/state/layers';

  interface Props {
    open: boolean;
    title: string;
    /** Bootstrap modal-dialog size class, e.g. `modal-lg`. */
    size?: '' | 'modal-sm' | 'modal-lg' | 'modal-xl';
    /** Full-screen below the `sm` breakpoint, as every dialog in the old app was. */
    fullscreenOnMobile?: boolean;
    /** Set false for a dialog the operator must answer, such as the scanner's name prompt. */
    dismissible?: boolean;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  }

  let {
    open = $bindable(),
    title,
    size = '',
    fullscreenOnMobile = true,
    dismissible = true,
    onclose,
    children,
    footer
  }: Props = $props();

  let element = $state<HTMLDialogElement>();

  /**
   * What the DOM was last synced to. A plain variable, not `$state`: it exists to detect the
   * open→closed edge inside the effect, and making it reactive would re-trigger that effect.
   */
  let syncedOpen = false;

  /**
   * A native `<dialog>` rather than Bootstrap's modal.
   *
   * `showModal()` brings focus trapping, Escape, inertness of the page behind, and the top layer
   * — all of which the old markup lacked. It also removes the two workarounds Bootstrap's modal
   * forced on the app: the global `JSON.parse` monkeypatch and the `document.body.getAttribute`
   * wrapper that stopped `ScrollBarHelper` throwing on nested modals.
   *
   * **`onclose` is fired from here, not from the element's `close` event.** That event is not
   * dependable: a programmatic `dialog.close()` does not fire it in every engine — verified
   * against a bare `<dialog>` in Chrome, where it never arrived. Depending on it made every
   * dialog one-shot: it closed, the parent was never told, so the `{#if}` that mounted it stayed
   * true and the next open silently did nothing. `open` is the single source of truth, and this
   * effect is the one place that reconciles the DOM with it and reports the transition.
   */
  $effect(() => {
    const dialog = element;
    if (!dialog) return;

    // Written as "make the DOM match `open`", not "react to `open` changing". An effect re-runs
    // for reasons of its own, and a version that only acted inside the `open && !dialog.open`
    // branch dropped its bookkeeping on the next re-run and never got it back.
    if (open) {
      if (!dialog.open) dialog.showModal();
      // Nothing outside the top layer can paint above this, so the toast stack and the progress
      // overlay are moved inside it while it is open. See $lib/state/layers.ts.
      adoptOverlays(dialog);
    } else {
      if (dialog.open) dialog.close();
      releaseOverlays(dialog);
      // Only on the edge, so a re-run for an unrelated reason cannot notify twice.
      if (syncedOpen) onclose?.();
    }

    syncedOpen = open;

    return () => releaseOverlays(dialog);
  });

  /**
   * Escape. The browser would close the dialog itself, which would take the DOM out of step with
   * `open`; preventing the default and driving it through the state instead keeps one path.
   */
  function handleCancel(event: Event) {
    event.preventDefault();
    if (dismissible) open = false;
  }

  function handleBackdropClick(event: MouseEvent) {
    if (!dismissible) return;
    // A click lands on the <dialog> itself only when it hit the backdrop: the panel inside
    // covers everything else.
    if (event.target === element) open = false;
  }
</script>

<dialog
  bind:this={element}
  class="app-dialog"
  aria-label={title}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
>
  <div
    class="modal-dialog modal-dialog-centered modal-dialog-scrollable {size} {fullscreenOnMobile
      ? 'modal-fullscreen-sm-down'
      : ''}"
  >
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">{title}</h5>
        {#if dismissible}
          <button type="button" class="btn-close" aria-label="Close" onclick={() => (open = false)}></button>
        {/if}
      </div>

      <div class="modal-body">
        {@render children()}
      </div>

      {#if footer}
        <div class="modal-footer">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
</dialog>
