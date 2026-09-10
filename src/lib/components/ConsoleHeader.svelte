<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import Dialog from './Dialog.svelte';
  import Dropdown from './Dropdown.svelte';
  import * as backups from '$lib/services/export';
  import type { Backup } from '$lib/types';
  import { data } from '$lib/state/data.svelte';
  import { draw } from '$lib/state/draw.svelte';
  import { session } from '$lib/state/session.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { formatDateTime } from '$lib/utils/format';

  let restoreInput = $state<HTMLInputElement>();

  let backupNameOpen = $state(false);
  let backupName = $state('');

  let restoreOnlineOpen = $state(false);
  let onlineBackups = $state<Backup[]>([]);
  let loadingBackups = $state(false);

  async function undoLastDraw() {
    if (!draw.canUndo) {
      toasts.warning('There is nothing to undo.');
      return;
    }
    const confirmed = await ui.confirm({
      title: 'Undo last selection',
      message:
        'This deletes the winners from the last draw, restores the prize quantity, and puts the entries back.',
      confirmText: 'Undo',
      variant: 'danger'
    });
    if (confirmed) await draw.undo();
  }

  async function backupLocal() {
    try {
      // Any setting still waiting on its debounce would otherwise be missing from the file.
      await settings.flush();
      await ui.withProgress('Backing up', 'Collecting data…', async () => {
        await backups.downloadBackup();
      });
      toasts.success('Backup downloaded.');
    } catch (error) {
      toasts.fromError(error, 'Could not create the backup.');
    }
  }

  async function restoreLocal(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const confirmed = await ui.confirm({
      title: 'Restore from file',
      // "Restore" reads as "put it back how it was", and it does not do that: the write is all
      // upserts and never deletes, so a draw run after the backup was taken survives it. Saying
      // so here is the difference between a safe operation and a surprising one.
      message: `Restore everything from "${file.name}"? Records with the same id are overwritten. This merges rather than rolls back — anything created since the backup was taken is kept.`,
      confirmText: 'Restore',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      await ui.withProgress('Restoring', 'Reading the backup…', async (report) => {
        const payload = await backups.readBackupFile(file);
        report(40, 'Writing records…');
        const summary = await backups.restoreBackup(payload);
        report(80, 'Reloading…');
        await data.loadAll();
        await settings.load();
        toasts.success(
          `Restored ${summary.lists} lists, ${summary.prizes} prizes, ${summary.winners} winners.`
        );
      });
    } catch (error) {
      toasts.fromError(error, 'Could not restore that backup.');
    }
  }

  function openBackupOnline() {
    backupName = new Date().toISOString().replace('T', ' ').substring(0, 19);
    backupNameOpen = true;
  }

  async function saveOnlineBackup() {
    const name = backupName.trim();
    if (!name) {
      toasts.warning('Please give the backup a name.');
      return;
    }
    backupNameOpen = false;
    try {
      await settings.flush();
      await ui.withProgress('Backing up', 'Collecting data…', async () => {
        await backups.createOnlineBackup(name);
      });
      toasts.success('Backup saved to the server.');
    } catch (error) {
      toasts.fromError(error, 'Could not save the backup.');
    }
  }

  async function openRestoreOnline() {
    restoreOnlineOpen = true;
    loadingBackups = true;
    try {
      onlineBackups = await backups.listOnlineBackups();
    } catch (error) {
      toasts.fromError(error, 'Could not list the saved backups.');
      restoreOnlineOpen = false;
    } finally {
      loadingBackups = false;
    }
  }

  async function restoreOnline(backup: Backup) {
    const confirmed = await ui.confirm({
      title: 'Restore backup',
      // Same semantics as the from-file restore above, and the same reason for spelling them out.
      message: `Restore "${backup.name}"? Records with the same id are overwritten. This merges rather than rolls back — anything created since the backup was taken is kept.`,
      confirmText: 'Restore',
      variant: 'danger'
    });
    if (!confirmed) return;

    restoreOnlineOpen = false;
    try {
      await ui.withProgress('Restoring', 'Writing records…', async (report) => {
        const summary = await backups.restoreOnlineBackup(backup.backupId);
        report(80, 'Reloading…');
        await data.loadAll();
        await settings.load();
        toasts.success(
          `Restored ${summary.lists} lists, ${summary.prizes} prizes, ${summary.winners} winners.`
        );
      });
    } catch (error) {
      toasts.fromError(error, 'Could not restore that backup.');
    }
  }

  async function deleteOnline(backup: Backup) {
    const confirmed = await ui.confirm({
      title: 'Delete backup',
      message: `Delete "${backup.name}" permanently?`,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      await backups.deleteOnlineBackup(backup.backupId);
      onlineBackups = onlineBackups.filter((item) => item.backupId !== backup.backupId);
      toasts.success('Backup deleted.');
    } catch (error) {
      toasts.fromError(error, 'Could not delete that backup.');
    }
  }
</script>

<header class="management-header py-3 border-bottom">
  <h3 class="mb-0"><i class="bi bi-gear me-2" aria-hidden="true"></i>Management</h3>

  <div class="management-header-actions">
    <button
      type="button"
      class="btn btn-outline-secondary"
      title="Toggle theme"
      aria-label="Toggle theme"
      onclick={() => settings.toggleTheme()}
    >
      <i class="bi {settings.theme === 'dark' ? 'bi-sun-fill' : 'bi-moon-fill'}" aria-hidden="true"></i>
    </button>

    <Dropdown label="" icon="bi-gear" ariaLabel="Account and data actions">
      {#snippet children(close)}
        <li>
          <h6 class="dropdown-header">{session.label ? `Signed in as ${session.label}` : 'Signed in'}</h6>
        </li>
        <li>
          <button
            type="button"
            class="dropdown-item"
            role="menuitem"
            onclick={() => {
              close();
              void session.signOut();
            }}
          >
            <i class="bi bi-box-arrow-right me-2" aria-hidden="true"></i>Sign Out
          </button>
        </li>

        <li><hr class="dropdown-divider" /></li>
        <li>
          <a class="dropdown-item" role="menuitem" href={resolve('/scan')} target="_blank" rel="noopener">
            <i class="bi bi-qr-code-scan me-2" aria-hidden="true"></i>Prize Pickup Scanner
          </a>
        </li>

        <li><hr class="dropdown-divider" /></li>
        <li>
          <button
            type="button"
            class="dropdown-item"
            role="menuitem"
            disabled={!draw.canUndo}
            onclick={() => {
              close();
              void undoLastDraw();
            }}
          >
            <i class="bi bi-arrow-counterclockwise me-2" aria-hidden="true"></i>Undo Last Selection
          </button>
        </li>

        <li><hr class="dropdown-divider" /></li>
        <li>
          <button
            type="button"
            class="dropdown-item"
            role="menuitem"
            onclick={() => {
              close();
              void backupLocal();
            }}
          >
            <i class="bi bi-download me-2" aria-hidden="true"></i>Backup Local
          </button>
        </li>
        <li>
          <button
            type="button"
            class="dropdown-item"
            role="menuitem"
            onclick={() => {
              close();
              restoreInput?.click();
            }}
          >
            <i class="bi bi-upload me-2" aria-hidden="true"></i>Restore Local
          </button>
        </li>

        <li><hr class="dropdown-divider" /></li>
        <li>
          <button
            type="button"
            class="dropdown-item"
            role="menuitem"
            onclick={() => {
              close();
              openBackupOnline();
            }}
          >
            <i class="bi bi-cloud-upload me-2" aria-hidden="true"></i>Backup Online
          </button>
        </li>
        <li>
          <button
            type="button"
            class="dropdown-item"
            role="menuitem"
            onclick={() => {
              close();
              void openRestoreOnline();
            }}
          >
            <i class="bi bi-cloud-download me-2" aria-hidden="true"></i>Restore Online
          </button>
        </li>
      {/snippet}
    </Dropdown>

    <button type="button" class="btn btn-primary" onclick={() => goto(resolve('/present'))}>
      <i class="bi bi-eye me-2" aria-hidden="true"></i>Public View
    </button>
  </div>
</header>

<input
  bind:this={restoreInput}
  type="file"
  accept="application/json,.json"
  class="visually-hidden"
  aria-hidden="true"
  tabindex="-1"
  onchange={restoreLocal}
/>

<Dialog bind:open={backupNameOpen} title="Backup to the server" size="modal-sm">
  <label class="form-label" for="backup-name">Backup name</label>
  <input id="backup-name" class="form-control" bind:value={backupName} />
  <div class="form-text">Stored on the server alongside the app's data.</div>

  {#snippet footer()}
    <button type="button" class="btn btn-secondary" onclick={() => (backupNameOpen = false)}> Cancel </button>
    <button type="button" class="btn btn-primary" onclick={() => void saveOnlineBackup()}>
      <i class="bi bi-cloud-upload me-2" aria-hidden="true"></i>Save Backup
    </button>
  {/snippet}
</Dialog>

<Dialog bind:open={restoreOnlineOpen} title="Restore from the server" size="modal-lg">
  {#if loadingBackups}
    <div class="text-center py-4">
      <div class="spinner-border text-primary" aria-hidden="true"></div>
      <p class="mt-3 mb-0 text-muted">Loading backups…</p>
    </div>
  {:else if onlineBackups.length === 0}
    <p class="text-muted mb-0">There are no backups on the server yet.</p>
  {:else}
    <ul class="list-group">
      {#each onlineBackups as backup (backup.backupId)}
        <li class="list-group-item d-flex flex-wrap gap-2 align-items-center">
          <div class="flex-grow-1 min-w-0">
            <strong class="d-block text-truncate">{backup.name}</strong>
            <small class="text-muted">
              {formatDateTime(backup.timestamp)} · {backups.backupSize(backup)}
            </small>
          </div>
          <button type="button" class="btn btn-sm btn-primary" onclick={() => void restoreOnline(backup)}>
            Restore
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline-danger"
            aria-label="Delete backup {backup.name}"
            onclick={() => void deleteOnline(backup)}
          >
            <i class="bi bi-trash" aria-hidden="true"></i>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#snippet footer()}
    <button type="button" class="btn btn-secondary" onclick={() => (restoreOnlineOpen = false)}>
      Close
    </button>
  {/snippet}
</Dialog>
