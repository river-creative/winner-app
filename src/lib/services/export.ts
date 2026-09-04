import * as api from '$lib/api/client';
import { mergeSettings } from '$lib/constants/settings';
import type { Backup, BackupPayload, Winner } from '$lib/types';
import { toCsv } from '$lib/utils/csv';
import { generateBackupId } from '$lib/utils/id';

const BACKUP_VERSION = '1.0';

function today(): string {
  return new Date().toISOString().split('T')[0] as string;
}

/** Hand the browser a file. Revoking on the next frame is enough for every current engine. */
function download(filename: string, contents: string, mimeType: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/**
 * Export exactly the winners passed in.
 *
 * The old exporter re-read the filter `<select>`s from the DOM and rebuilt its own predicate —
 * which ignored the date filter entirely, and matched list names against a map that did not
 * carry the " (Archived)" suffix the table shows, so exporting with an archived list selected
 * produced an empty file. Taking the rows as an argument makes "export what I am looking at"
 * true by construction.
 */
export function exportWinnersCsv(winners: Winner[]): void {
  const dataKeys = new Set<string>();
  for (const winner of winners) for (const key of Object.keys(winner.data)) dataKeys.add(key);
  const extraColumns = [...dataKeys];

  const headers = ['TicketID', 'Name', 'Prize', 'Timestamp', 'ListName', ...extraColumns];
  const rows = winners.map((winner) => [
    // The ticket carries a short code, not the full entry id.
    (winner.entryId || 'N/A').toString().slice(0, 5).toUpperCase(),
    winner.displayName,
    winner.prize,
    new Date(winner.timestamp).toISOString(),
    winner.listName,
    ...extraColumns.map((key) => winner.data[key] ?? '')
  ]);

  download(`winner-app-export-${today()}.csv`, toCsv(headers, rows), 'text/csv;charset=utf-8');
}

/** Everything needed to rebuild the app's state, settings included. */
export async function buildBackupPayload(): Promise<BackupPayload> {
  const [lists, prizes, winners, history, templates, settingRecords] = await Promise.all([
    api.getAll('lists'),
    api.getAll('prizes'),
    api.getAll('winners'),
    api.getAll('history'),
    api.getAll('templates'),
    api.getAll('settings')
  ]);

  // Rebuilt from the server's own `{key, value}` rows rather than read off a property that did
  // not exist — which is why every backup this app has ever taken contained no settings at all.
  // Starting from the defaults means a key the server has never seen still round-trips.
  const settings = mergeSettings(settingRecords.map((record) => [record.key, record.value]));

  return {
    version: BACKUP_VERSION,
    timestamp: Date.now(),
    lists,
    prizes,
    winners,
    history,
    templates,
    settings
  };
}

export async function downloadBackup(): Promise<void> {
  const payload = await buildBackupPayload();
  download(`winner-app-backup-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

export interface RestoreSummary {
  lists: number;
  prizes: number;
  winners: number;
  history: number;
  templates: number;
  settings: number;
}

function isBackupPayload(value: unknown): value is BackupPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    'version' in value &&
    typeof (value as { version: unknown }).version === 'string'
  );
}

/**
 * Write a backup back over the live collections.
 *
 * Everything goes in one `batch-save` per collection group so the store reads each file once.
 * `lastSyncAt` is normalised on the way in: a falsy or pre-1971 value used to render as
 * "Synced 12/31/1969" on every list that had never actually synced.
 */
export async function restoreBackup(payload: unknown): Promise<RestoreSummary> {
  if (!isBackupPayload(payload)) {
    throw new Error('That file is not a Winner App backup.');
  }

  const lists = (payload.lists ?? []).map((list) => ({
    ...list,
    metadata: {
      ...list.metadata,
      lastSyncAt:
        list.metadata.lastSyncAt && new Date(list.metadata.lastSyncAt).getFullYear() > 1970
          ? list.metadata.lastSyncAt
          : null
    }
  }));

  const operations = [
    ...lists.map((list) => ({
      collection: 'lists' as const,
      data: list as unknown as Record<string, unknown>
    })),
    ...(payload.prizes ?? []).map((prize) => ({
      collection: 'prizes' as const,
      data: prize as unknown as Record<string, unknown>
    })),
    ...(payload.winners ?? []).map((winner) => ({
      collection: 'winners' as const,
      data: winner as unknown as Record<string, unknown>
    })),
    ...(payload.history ?? []).map((entry) => ({
      collection: 'history' as const,
      data: entry as unknown as Record<string, unknown>
    })),
    ...(payload.templates ?? []).map((template) => ({
      collection: 'templates' as const,
      data: template as unknown as Record<string, unknown>
    })),
    ...Object.entries(payload.settings ?? {}).map(([key, value]) => ({
      collection: 'settings' as const,
      data: { key, value }
    }))
  ];

  await api.batchSave(operations);

  return {
    lists: lists.length,
    prizes: payload.prizes?.length ?? 0,
    winners: payload.winners?.length ?? 0,
    history: payload.history?.length ?? 0,
    templates: payload.templates?.length ?? 0,
    settings: Object.keys(payload.settings ?? {}).length
  };
}

export async function readBackupFile(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('That file is not valid JSON.');
  }
}

// ---------------------------------------------------------------------------------------------
// Server-side backups
// ---------------------------------------------------------------------------------------------

export async function createOnlineBackup(name: string): Promise<Backup> {
  const backup: Backup = {
    backupId: generateBackupId(),
    name,
    timestamp: Date.now(),
    description: `Backup created at ${new Date().toLocaleString()}`,
    data: await buildBackupPayload()
  };

  await api.save('backups', backup as unknown as never);
  return backup;
}

export async function listOnlineBackups(): Promise<Backup[]> {
  const backups = (await api.getAll('backups')) as unknown as Backup[];
  return [...backups].sort((a, b) => b.timestamp - a.timestamp);
}

export async function restoreOnlineBackup(backupId: string): Promise<RestoreSummary> {
  const backup = (await api.getOne('backups', backupId)) as unknown as Backup | null;
  if (!backup) throw new Error('That backup no longer exists.');
  return restoreBackup(backup.data);
}

export async function deleteOnlineBackup(backupId: string): Promise<void> {
  await api.remove('backups', backupId);
}

/** Approximate size of a stored backup, for the restore list. */
export function backupSize(backup: Backup): string {
  const bytes = JSON.stringify(backup.data ?? {}).length;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
