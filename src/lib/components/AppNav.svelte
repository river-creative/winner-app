<script lang="ts">
  import { page } from '$app/state';
  import { base, resolve } from '$app/paths';

  /**
   * `resolve()` rather than `` `${base}${path}` ``: it applies the base path and is checked
   * against the real route tree, so a link to a route that does not exist is a compile error
   * rather than a 404 nobody notices until an operator clicks it.
   */
  const ITEMS = [
    { href: '/', label: 'Setup', icon: 'bi-play-circle' },
    { href: '/lists', label: 'Lists', icon: 'bi-list-ul' },
    { href: '/prizes', label: 'Prizes', icon: 'bi-gift' },
    { href: '/templates', label: 'Templates', icon: 'bi-chat-text' },
    { href: '/winners', label: 'Winners', icon: 'bi-trophy' },
    { href: '/history', label: 'History', icon: 'bi-clock-history' },
    { href: '/queries', label: 'Queries', icon: 'bi-database' },
    { href: '/settings', label: 'Settings', icon: 'bi-sliders' }
  ] as const;

  const currentPath = $derived(page.url.pathname.replace(base, '') || '/');

  let strip = $state<HTMLUListElement>();

  function isActive(href: string): boolean {
    return href === '/' ? currentPath === '/' : currentPath.startsWith(href);
  }

  /**
   * Below `md` the strip is a one-row horizontal scroller (responsive.css §4). Without this the
   * active tab can sit off-screen after a reload or a deep link, leaving the strip showing
   * "Setup" while the page shows Settings.
   */
  $effect(() => {
    void currentPath;
    const active = strip?.querySelector<HTMLElement>('.nav-link.active');
    active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  });

  /**
   * Left/Right move between sections, Home/End jump to the ends — the movement the Bootstrap
   * tablist used to provide. These are links, not tabs, so they keep their natural tab order;
   * the arrows are an addition, not a replacement for Tab.
   */
  function handleKeydown(event: KeyboardEvent) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const links = [...(strip?.querySelectorAll<HTMLAnchorElement>('.nav-link') ?? [])];
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (index === -1) return;

    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? links.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + links.length) % links.length;

    links[next]?.focus();
  }
</script>

<nav aria-label="Management sections">
  <ul bind:this={strip} class="nav nav-tabs mt-3">
    {#each ITEMS as item (item.href)}
      {@const active = isActive(item.href)}
      <li class="nav-item">
        <a
          class="nav-link"
          class:active
          href={resolve(item.href)}
          aria-current={active ? 'page' : undefined}
          onkeydown={handleKeydown}
        >
          <i class="bi {item.icon} me-1" aria-hidden="true"></i>{item.label}
        </a>
      </li>
    {/each}
  </ul>
</nav>
