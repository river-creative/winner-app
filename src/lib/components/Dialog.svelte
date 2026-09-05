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
      if (!dialog.open) {
        dialog.showModal();
        focusInitial(dialog);
      }
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
   * Where the keyboard lands when a dialog opens.
   *
   * `showModal()` focuses the first focusable descendant, and in this frame that is always the
   * close button — so every dialog opened with its × ringed and Enter dismissed it instead of
   * submitting. An explicit `autofocus` still wins, since `showModal()` has already honoured it.
   * Otherwise focus goes to the first field the operator opened the dialog to fill in, and to
   * the panel itself when there is none — a confirmation, say — which leaves a screen reader
   * announcing the dialog rather than its close button.
   */
  function focusInitial(dialog: HTMLDialogElement) {
    if (dialog.querySelector('[autofocus]')) return;

    const field = dialog.querySelector<HTMLElement>(
      '.modal-body input:not([type="hidden"]):not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])'
    );
    (field ?? dialog.querySelector<HTMLElement>('.modal-content'))?.focus();
  }

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

<!--
  `modal` is carried purely for Bootstrap's `--bs-modal-*` variables, which it declares on that
  class and which `.modal-content`, `.modal-header`, `.modal-body` and `.modal-footer` all read.
  Without it every one of them is unset, and `max-width: var(--bs-modal-width)` is then invalid
  at computed-value time and resolves to `none` — which is why this rendered as a full-viewport
  form with no panel, no background and no padding around it. Everything `.modal` does beyond
  the variables is layout this element supplies itself, and styles.css overrides it there.
-->
<dialog
  bind:this={element}
  class="app-dialog modal"
  aria-label={title}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
>
  <div
    class="modal-dialog modal-dialog-centered modal-dialog-scrollable {size} {fullscreenOnMobile
      ? 'modal-fullscreen-sm-down'
      : ''}"
  >
    <!-- `tabindex="-1"` so focusInitial can land here when the dialog has no field of its own.
         It is not a tab stop: only script reaches it. -->
    <div class="modal-content" tabindex="-1">
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
