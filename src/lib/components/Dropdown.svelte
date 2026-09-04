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
    /** Extra classes for the menu, e.g. `w-100` to match the trigger's width. */
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

  let open = $state(false);
  let container = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();

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
   * Close on any click outside. Registered only while the menu is open, and torn down by the
   * effect's own cleanup — the old app added window listeners it never removed.
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
         serves arrow keys, Home/End and Escape for the whole menu. -->
    <ul
      class="dropdown-menu show {menuClass}"
      class:dropdown-menu-end={align === 'end'}
      role="menu"
      onkeydown={handleMenuKeydown}
    >
      {@render children(close)}
    </ul>
  {/if}
</div>
