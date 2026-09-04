<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    /** Bootstrap button classes for the trigger. */
    buttonClass?: string;
    icon?: string;
    /** Hide the label text below `md`, leaving the icon. */
    labelClass?: string;
    align?: 'start' | 'end';
    ariaLabel?: string;
    disabled?: boolean;
    /**
     * Extra classes for the menu, e.g. `dropdown-menu-match-trigger` to size it to the trigger.
     * A percentage width would resolve against the viewport — see the note on that class below.
     */
    menuClass?: string;
    /**
     * Extra classes on the `.dropdown` wrapper itself.
     *
     * Needed because several layout rules select the wrapper as a direct child — responsive.css
     * §5 sizes `.section-toolbar > .dropdown` — so wrapping this component in another element to
     * carry those classes would silently drop the rule.
     */
    class?: string;
    /** Replaces the label and icon, for triggers that show a summary of the selection. */
    trigger?: Snippet;
    /** Menu contents. Call `close()` from an item's handler to dismiss the menu. */
    children: Snippet<[() => void]>;
  }

  let {
    label,
    buttonClass = 'btn btn-outline-secondary',
    icon,
    labelClass = '',
    align = 'end',
    ariaLabel,
    disabled = false,
    menuClass = '',
    class: wrapperClass = '',
    trigger: triggerContent,
    children
  }: Props = $props();

  /** Space between the trigger and the menu. */
  const TRIGGER_GAP = 4;
  /** Smallest gap kept between the menu and the edge of the viewport. */
  const VIEWPORT_MARGIN = 8;
  /** The menu never collapses below this in a cramped viewport — it scrolls instead. */
  const MIN_MENU_HEIGHT = 120;

  const menuId = $props.id();

  let open = $state(false);
  let container = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let menu = $state<HTMLUListElement>();

  function close(returnFocus = false) {
    open = false;
    if (returnFocus) trigger?.focus();
  }

  function items(): HTMLElement[] {
    return [
      ...(container?.querySelectorAll<HTMLElement>('.dropdown-menu .dropdown-item:not([disabled])') ?? [])
    ];
  }

  function focusItem(index: number) {
    const all = items();
    if (all.length === 0) return;
    const wrapped = ((index % all.length) + all.length) % all.length;
    all[wrapped]?.focus();
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open = true;
    // Wait for the menu to exist before moving focus into it.
    queueMicrotask(() => focusItem(event.key === 'ArrowDown' ? 0 : -1));
  }

  function handleMenuKeydown(event: KeyboardEvent) {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      case 'ArrowDown':
        event.preventDefault();
        focusItem(index + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(index - 1);
        return;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        return;
      case 'End':
        event.preventDefault();
        focusItem(-1);
        return;
      case 'Tab':
        // Tabbing out of a menu closes it, without stealing the key.
        close();
        return;
    }
  }

  /**
   * Place the menu under its trigger, without measuring it.
   *
   * The menu is a top-layer popover, so its containing block is the viewport and every offset
   * here is a viewport coordinate. Anchoring an end-aligned menu by its `right` edge (and a
   * start-aligned one by its `left`) needs no width, which is what lets this run while the
   * popover is still hidden — so the menu never paints in the centre of the screen where the
   * user-agent's default `inset: 0; margin: auto` would otherwise put it for a frame.
   */
  function anchor() {
    if (!trigger || !menu) return;

    const rect = trigger.getBoundingClientRect();
    const style = menu.style;

    style.setProperty('--dropdown-trigger-width', `${rect.width}px`);
    style.top = `${rect.bottom + TRIGGER_GAP}px`;
    style.bottom = 'auto';
    style.maxHeight = `${Math.max(
      window.innerHeight - rect.bottom - TRIGGER_GAP - VIEWPORT_MARGIN,
      MIN_MENU_HEIGHT
    )}px`;

    if (align === 'end') {
      style.left = 'auto';
      style.right = `${Math.max(window.innerWidth - rect.right, VIEWPORT_MARGIN)}px`;
    } else {
      style.right = 'auto';
      style.left = `${Math.max(rect.left, VIEWPORT_MARGIN)}px`;
    }
  }

  /**
   * Second pass, once the menu is showing and can be measured: drop it above the trigger when it
   * does not fit below, and pull it back inside the viewport when it is wider than the room on
   * its preferred side.
   */
  function fit() {
    if (!trigger || !menu) return;

    const anchorRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const style = menu.style;

    const below = window.innerHeight - anchorRect.bottom - TRIGGER_GAP - VIEWPORT_MARGIN;
    const above = anchorRect.top - TRIGGER_GAP - VIEWPORT_MARGIN;
    if (menuRect.height > below && above > below) {
      style.top = 'auto';
      style.bottom = `${window.innerHeight - anchorRect.top + TRIGGER_GAP}px`;
      style.maxHeight = `${Math.max(above, MIN_MENU_HEIGHT)}px`;
    }

    if (menuRect.left < VIEWPORT_MARGIN) {
      style.right = 'auto';
      style.left = `${VIEWPORT_MARGIN}px`;
    } else if (menuRect.right > window.innerWidth - VIEWPORT_MARGIN) {
      style.left = 'auto';
      style.right = `${VIEWPORT_MARGIN}px`;
    }
  }

  /**
   * Show the menu in the top layer, and keep it under its trigger while it is there.
   *
   * The top layer is the only placement no ancestor can clip. Every one of these triggers sits
   * inside a `.card`, which is `overflow: hidden` so its gradient header stays inside the card's
   * rounded corners — an absolutely positioned menu was simply cut off at the card's edge, and
   * dropping the card's `overflow` would only have moved the problem to the next ancestor that
   * needed one. Anchoring runs before the popover is shown and the refit immediately after, both
   * inside this effect, so the menu is in its final place before the browser paints it.
   */
  $effect(() => {
    if (!open) return;
    const element = menu;
    if (!element) return;

    anchor();
    element.showPopover();
    fit();

    const reposition = () => {
      const rect = trigger?.getBoundingClientRect();
      // A menu anchored to a trigger that has scrolled out of sight is just litter on the screen.
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) {
        open = false;
        return;
      }
      anchor();
      fit();
    };

    // Captured, because the scroll may happen in any ancestor and scroll events do not bubble.
    window.addEventListener('scroll', reposition, { capture: true, passive: true });
    window.addEventListener('resize', reposition);

    return () => {
      window.removeEventListener('scroll', reposition, { capture: true });
      window.removeEventListener('resize', reposition);
      if (element.matches(':popover-open')) element.hidePopover();
    };
  });

  /**
   * Close on any click outside. Registered only while the menu is open, and torn down by the
   * effect's own cleanup — the old app added window listeners it never removed.
   *
   * A popover stays where it is in the DOM and only renders elsewhere, so the menu is still a
   * descendant of `container` and clicks inside it are correctly treated as inside.
   */
  $effect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!container?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  });
</script>

<div class="dropdown {wrapperClass}" bind:this={container}>
  <button
    bind:this={trigger}
    type="button"
    class="{buttonClass} dropdown-toggle"
    aria-expanded={open}
    aria-haspopup="menu"
    aria-controls={open ? menuId : undefined}
    aria-label={ariaLabel}
    {disabled}
    onclick={() => (open = !open)}
    onkeydown={handleTriggerKeydown}
  >
    {#if triggerContent}
      {@render triggerContent()}
    {:else}
      {#if icon}<i class="bi {icon}" class:me-2={!!label} aria-hidden="true"></i>{/if}
      {#if label}<span class={labelClass}>{label}</span>{/if}
    {/if}
  </button>

  {#if open}
    <!-- Keyboard handling lives on the menu container rather than on each item, so one handler
         serves arrow keys, Home/End and Escape for the whole menu.

         `popover="manual"`: the light dismiss and Escape handling an auto popover brings would
         duplicate what this component already does, and its dismiss-on-pointerdown would fight
         the trigger's own click — closing the menu on the way down and reopening it on the
         way up, so the trigger could never close what it had opened. -->
    <ul
      bind:this={menu}
      id={menuId}
      popover="manual"
      class="dropdown-menu show {menuClass}"
      role="menu"
      onkeydown={handleMenuKeydown}
    >
      {@render children(close)}
    </ul>
  {/if}
</div>

<style>
  /* The script above positions the menu against the viewport, which only holds if the menu is
     actually fixed. Bootstrap's `.dropdown-menu` is `position: absolute`, and the user agent's
     `:popover-open { position: fixed }` loses to it — an author rule beats the UA sheet whatever
     its specificity — so it has to be restated here, where Svelte's scoping class outweighs
     Bootstrap. Every inset is set inline, which likewise overrides the UA's `inset: 0`. */
  .dropdown-menu[popover] {
    position: fixed;
    margin: 0;
    /* Paired with the max-height the script sets: a menu taller than the space it has scrolls
       rather than running off the screen. */
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* Sizes the menu to its trigger. A top-layer element's containing block is the viewport, so
     `width: 100%` would stretch the menu across the whole screen; the script publishes the
     trigger's measured width instead. responsive.css §5 uses the same custom property to widen
     toolbar menus on mobile, where the trigger owns its row. */
  .dropdown-menu[popover].dropdown-menu-match-trigger {
    width: var(--dropdown-trigger-width, auto);
  }
</style>
