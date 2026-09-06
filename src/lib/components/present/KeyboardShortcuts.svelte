<script lang="ts">
  import Dialog from '$lib/components/Dialog.svelte';
  import { ui } from '$lib/state/ui.svelte';

  interface Props {
    onplay: () => void;
    ontext: () => void;
    onundo: () => void;
    onfullscreen: () => void;
    onnew: () => void;
    /** Leave the public view for the console. */
    onmanage: () => void;
  }

  let { onplay, ontext, onundo, onfullscreen, onnew, onmanage }: Props = $props();

  interface Shortcut {
    key: string;
    label: string;
    run: () => void;
  }

  /**
   * The arrow wrappers matter: props are live getters in runes mode, so calling through them at
   * keypress time uses the current handler rather than the one captured when this array was
   * built.
   *
   * `v` was the old view-toggle key. Now that the console is a route rather than a hidden div,
   * toggling away from the public view *is* opening the console, so it shares `m`'s handler
   * instead of being dropped — an operator's muscle memory keeps working.
   */
  const SHORTCUTS: Shortcut[] = [
    { key: 'p', label: 'Play / start selection', run: () => onplay() },
    { key: 't', label: 'Send text messages', run: () => ontext() },
    { key: 'u', label: 'Undo last selection', run: () => onundo() },
    { key: 'f', label: 'Toggle fullscreen', run: () => onfullscreen() },
    { key: 'n', label: 'New selection', run: () => onnew() },
    { key: 'm', label: 'Open management', run: () => onmanage() },
    { key: 'v', label: 'Back to the console', run: () => onmanage() }
  ];

  let tooltipOpen = $state(false);

  /**
   * The chip that confirms a shortcut fired.
   *
   * The public display has no other acknowledgement — most of these keys act on a screen the
   * operator is not looking at, so without it a press that did nothing and a press that worked
   * are indistinguishable. `flash` is bumped on every press so the element is replaced and the
   * CSS animation restarts; re-pressing the same key otherwise showed nothing at all, because
   * the text had not changed.
   */
  const FEEDBACK_MS = 600;

  let feedbackKey = $state<string | null>(null);
  let flash = $state(0);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  function showFeedback(key: string): void {
    clearTimeout(feedbackTimer);
    feedbackKey = key.toUpperCase();
    flash += 1;
    // Matches the animation's own length, so the element leaves as it finishes fading out.
    feedbackTimer = setTimeout(() => (feedbackKey = null), FEEDBACK_MS);
  }

  $effect(() => () => clearTimeout(feedbackTimer));

  /**
   * Never steal a keystroke from something the operator is typing into.
   *
   * Checked on both the event target and the active element: a keystroke normally targets the
   * focused node, but a handler that only looked at one of the two is how the old module let
   * `n` start a new selection while a name was being typed into the scanner prompt.
   */
  function isTypingTarget(node: EventTarget | null): boolean {
    if (!(node instanceof HTMLElement)) return false;
    const tag = node.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable;
  }

  function handleKeydown(event: KeyboardEvent): void {
    // Modified keystrokes belong to the browser, and a composition is mid-word in an IME.
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;

    if (event.key === 'Escape') {
      if (!ui.shortcutsOpen) return;
      event.preventDefault();
      ui.shortcutsOpen = false;
      return;
    }

    if (event.key === '?') {
      event.preventDefault();
      ui.shortcutsOpen = !ui.shortcutsOpen;
      return;
    }

    // The help dialog is modal: the screen behind it is inert, and its shortcuts have to be too.
    if (ui.shortcutsOpen) return;

    const shortcut = SHORTCUTS.find((candidate) => candidate.key === event.key.toLowerCase());
    if (!shortcut) return;

    event.preventDefault();
    shortcut.run();
    showFeedback(shortcut.key);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- `aria-hidden`: the shortcut's own effect is what a screen-reader user hears, and announcing
     the letter they just pressed on top of it is noise. `{#key}` remounts on every press so the
     animation replays. -->
{#if feedbackKey}
  {#key flash}
    <div class="keyboard-feedback" aria-hidden="true">{feedbackKey}</div>
  {/key}
{/if}

<!--
  The corner affordance the old app injected from JavaScript, using the CSS that was already
  written for it. Hover reveals the summary; click opens the same list as a real dialog, which is
  what makes it reachable without a mouse.
-->
<div class="keyboard-help-indicator">
  <!-- The hover/focus handlers sit on the button rather than the wrapper: the tooltip is a
       decorative duplicate of the dialog, so there is nothing in it to move the pointer into. -->
  <button
    type="button"
    class="btn btn-sm btn-outline-secondary"
    title="Keyboard shortcuts"
    aria-label="Keyboard shortcuts"
    aria-haspopup="dialog"
    onmouseenter={() => (tooltipOpen = true)}
    onmouseleave={() => (tooltipOpen = false)}
    onfocus={() => (tooltipOpen = true)}
    onblur={() => (tooltipOpen = false)}
    onclick={() => (ui.shortcutsOpen = true)}
  >
    <i class="bi bi-keyboard" aria-hidden="true"></i>
  </button>

  <!-- A visual duplicate of the dialog's content, so it is hidden from assistive technology. -->
  <div class="keyboard-help-tooltip" style:display={tooltipOpen ? 'block' : null} aria-hidden="true">
    <div class="help-title">Keyboard Shortcuts</div>
    <div class="help-shortcuts">
      {#each SHORTCUTS as shortcut (shortcut.key)}
        <div><kbd>{shortcut.key.toUpperCase()}</kbd> {shortcut.label}</div>
      {/each}
      <div><kbd>?</kbd> Show this help</div>
    </div>
  </div>
</div>

<Dialog
  bind:open={() => ui.shortcutsOpen, (value) => (ui.shortcutsOpen = value)}
  title="Keyboard shortcuts"
  size="modal-sm"
>
  <dl class="row mb-0">
    {#each SHORTCUTS as shortcut (shortcut.key)}
      <dt class="col-3"><kbd>{shortcut.key.toUpperCase()}</kbd></dt>
      <dd class="col-9">{shortcut.label}</dd>
    {/each}
    <dt class="col-3"><kbd>?</kbd></dt>
    <dd class="col-9 mb-0">Show this help</dd>
  </dl>

  {#snippet footer()}
    <button type="button" class="btn btn-secondary" onclick={() => (ui.shortcutsOpen = false)}>
      Close
    </button>
  {/snippet}
</Dialog>
