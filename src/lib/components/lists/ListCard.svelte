<script lang="ts">
  import { setup } from '$lib/state/setup.svelte';
  import type { List } from '$lib/types';
  import { formatDate, formatNumber } from '$lib/utils/format';

  interface Props {
    list: List;
    onview: () => void;
    onedit: () => void;
    onarchive: () => void;
    ondelete: () => void;
    onsync: () => void;
    /** True while this card's Ministry Platform sync is running. */
    syncing?: boolean;
  }

  let { list, onview, onedit, onarchive, ondelete, onsync, syncing = false }: Props = $props();

  /**
   * The drawer is per-card, so it is local state rather than "which card is open" on the page:
   * two cards may legitimately be open at once, and a page-level id would also re-render every
   * other card each time one drawer toggles.
   *
   * Below `md` responsive.css §6 abolishes the drawer and shows all five actions in one row, so
   * this flag has no effect there. The classes stay put either way.
   */
  let drawerOpen = $state(false);

  const selected = $derived(setup.isListSelected(list.listId));
  const mpSource = $derived(list.metadata.mpSource);

  /**
   * A list that has never synced stores `lastSyncAt: null` — but restored backups and lists
   * written before the field existed can hold `0`, which `new Date(0)` renders as 12/31/1969.
   * The year test is what keeps that line off a never-synced card.
   */
  const syncedAt = $derived.by(() => {
    const lastSyncAt = list.metadata.lastSyncAt;
    if (!lastSyncAt) return null;
    return new Date(lastSyncAt).getFullYear() > 1970 ? lastSyncAt : null;
  });
</script>

<div class="card h-100 list-card-selectable" class:border-selected={selected}>
  <div class="card-header">
    <div class="d-flex justify-content-between align-items-center">
      <h6 class="card-title mb-0 text-truncate" title={list.metadata.name}>{list.metadata.name}</h6>
      <div>
        {#if mpSource}
          <span class="badge bg-info me-1" title="Syncable from Ministry Platform">
            <i class="bi bi-cloud-arrow-down" aria-hidden="true"></i>
            <span class="visually-hidden">Syncable from Ministry Platform</span>
          </span>
        {/if}
        {#if selected}
          <span class="badge badge-selection me-1">
            <i class="bi bi-check-circle-fill" aria-hidden="true"></i>
            <span class="visually-hidden">Selected for the next draw</span>
          </span>
        {/if}
        <span class="badge bg-secondary">
          {formatNumber(list.entries.length)}
          <span class="visually-hidden">entries</span>
        </span>
      </div>
    </div>
  </div>

  <div class="card-body d-flex flex-column">
    <p class="card-text text-muted small mb-2">
      Uploaded {formatDate(list.metadata.timestamp)}
      {#if syncedAt}
        <span class="d-block">
          <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
          Synced {formatDate(syncedAt)}
        </span>
      {/if}
    </p>

    <div class="mt-auto pt-2">
      <div class="d-flex justify-content-between align-items-center">
        <button
          type="button"
          class="btn btn-sm"
          class:btn-selection={selected}
          class:btn-outline-selection={!selected}
          aria-pressed={selected}
          onclick={() => setup.toggleList(list.listId)}
        >
          <i
            class="bi"
            class:bi-check-circle-fill={selected}
            class:bi-check-circle={!selected}
            aria-hidden="true"
          ></i>
          <span>{selected ? 'Selected' : 'Select'}</span>
        </button>

        <div class="list-card-actions">
          <div class="list-card-drawer" class:open={drawerOpen}>
            <div class="btn-group btn-group-sm">
              <button
                type="button"
                class="btn btn-outline-secondary"
                title="Edit list settings"
                aria-label="Edit settings for {list.metadata.name}"
                onclick={onedit}
              >
                <i class="bi bi-gear" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="btn btn-outline-secondary"
                title="Archive list"
                aria-label="Archive {list.metadata.name}"
                onclick={onarchive}
              >
                <i class="bi bi-archive" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="btn btn-outline-danger"
                title="Delete list"
                aria-label="Delete {list.metadata.name}"
                onclick={ondelete}
              >
                <i class="bi bi-trash" aria-hidden="true"></i>
              </button>
            </div>
          </div>

          <div class="btn-group btn-group-sm">
            <button
              type="button"
              class="btn btn-outline-secondary list-card-toggle"
              class:radius-right={drawerOpen}
              aria-expanded={drawerOpen}
              title={drawerOpen ? 'Hide actions' : 'More actions'}
              aria-label={drawerOpen
                ? `Hide more actions for ${list.metadata.name}`
                : `More actions for ${list.metadata.name}`}
              onclick={() => (drawerOpen = !drawerOpen)}
            >
              <i
                class="bi"
                class:bi-chevron-right={drawerOpen}
                class:bi-chevron-left={!drawerOpen}
                aria-hidden="true"
              ></i>
            </button>

            {#if mpSource}
              <button
                type="button"
                class="btn btn-outline-info list-card-sync"
                class:hidden={drawerOpen}
                title="Sync from Ministry Platform"
                aria-label="Sync {list.metadata.name} from Ministry Platform"
                tabindex={drawerOpen ? -1 : 0}
                disabled={syncing}
                onclick={onsync}
              >
                {#if syncing}
                  <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
                {:else}
                  <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
                {/if}
              </button>
            {/if}

            <button
              type="button"
              class="btn btn-outline-primary list-card-view"
              class:hidden={drawerOpen}
              title="View entries"
              aria-label="View entries in {list.metadata.name}"
              tabindex={drawerOpen ? -1 : 0}
              onclick={onview}
            >
              <i class="bi bi-eye" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
