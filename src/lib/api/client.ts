/**
 * The one way this app talks to the Express backend.
 *
 * Three rules, each of which exists because breaking it caused a real incident:
 *
 *  1. **Relative base.** `./api`, never `/api`. The same router is mounted at `/` and at `/win`,
 *     and an absolute path silently only works at the root mount.
 *  2. **Errors throw.** The module this replaces returned `[]` when a read failed — including
 *     for single-document reads, so `if (!winner)` passed on an empty array and the caller wrote
 *     `{...[], ...patch}` back over a real record. Commits a9c6872 and 2ab423a fixed exactly
 *     that class of bug in the old client; nothing here is allowed to reintroduce it.
 *  3. **A 401 is a session expiry, never empty data.** It is surfaced as a typed error so the
 *     shell can send the operator to /login instead of rendering an empty screen.
 */

import type {
  ArchivedList,
  AuthConfig,
  BatchRequest,
  BatchSaveOperation,
  Collection,
  HistoryEntry,
  List,
  Prize,
  Session,
  SettingRecord,
  Template,
  Winner
} from '$lib/types';

const API_BASE = './api';

/** Thrown for any non-2xx response, carrying the status so callers can branch on it. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  /**
   * The request was cut off by its own deadline, not refused.
   *
   * The distinction matters for writes and nothing else: a refused write did not happen, while a
   * write that timed out may well have been applied. A caller that reports "nothing was saved"
   * for both is lying half the time.
   */
  readonly timedOut: boolean;

  constructor(message: string, status: number, body: unknown, timedOut = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.timedOut = timedOut;
  }

  /** The session cookie is gone or expired. The caller must not treat this as "no data". */
  get isSessionExpired(): boolean {
    return this.status === 401;
  }
}

/**
 * There is no error-handling middleware in the backend, so a thrown error (a multer rejection,
 * a CORS rejection) comes back as Express's default **HTML** 500. Never assume JSON.
 */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const { error } = body as { error?: unknown };
    if (typeof error === 'string' && error) return error;
  }
  if (status >= 500) return 'The server had a problem. Please try again.';
  return `Request failed (${status}).`;
}

type SessionExpiredHandler = () => void;
let sessionExpiredHandler: SessionExpiredHandler | null = null;

/**
 * Register the one place that reacts to an expired session.
 *
 * Every 401 has to become "sign in again", never "there is no data" — rendering an empty screen
 * for an expired cookie is indistinguishable from a wiped database to the person looking at it.
 */
export function onSessionExpired(handler: SessionExpiredHandler): void {
  sessionExpiredHandler = handler;
}

/** `/auth/session` reports its own 401 as an answer, so it opts out of the global handler. */
const SILENT_401_PATHS = new Set(['/auth/session']);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  let body: unknown;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers
      }
    });

    // Reading the body sits inside the same `try` as the fetch deliberately.
    //
    // A deadline can fire at either point, and which one it lands on depends on timing the
    // caller has no control over: abort the request and `fetch` rejects; abort while the
    // response body is still streaming and it is *this* line that rejects. With only the fetch
    // guarded, the second case escaped as a raw DOMException and reached the operator as
    // "The draw failed. The user aborted a request." — the plainly wrong message, on a draw the
    // server had in fact saved in full. Measured, not theorised.
    body = await readBody(response);
  } catch (cause) {
    // `AbortSignal.timeout()` sets the signal's reason to a DOMException named `TimeoutError`,
    // which is what `fetch` rejects with — but a body read cancelled by that same signal rejects
    // with a plain `AbortError`. Both mean the deadline, so both are classified as one.
    const name = cause instanceof Error ? cause.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ApiError(
        'The server did not answer in time.',
        0,
        cause instanceof Error ? cause.message : String(cause),
        true
      );
    }

    throw new ApiError(
      'Cannot reach the server. Please check your connection.',
      0,
      cause instanceof Error ? cause.message : String(cause)
    );
  }

  if (!response.ok) {
    if (response.status === 401 && !SILENT_401_PATHS.has(path)) sessionExpiredHandler?.();
    throw new ApiError(messageFrom(body, response.status), response.status, body);
  }
  return body as T;
}

function json(payload: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(payload) };
}

// ---------------------------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------------------------

/** Maps a collection name to the record type it holds, so `getAll('winners')` is `Winner[]`. */
export interface CollectionTypes {
  lists: List;
  winners: Winner;
  prizes: Prize;
  history: HistoryEntry;
  settings: SettingRecord;
  backups: Record<string, unknown>;
  templates: Template;
  archive: ArchivedList;
}

export async function getAll<C extends Collection>(collection: C): Promise<CollectionTypes[C][]> {
  return request<CollectionTypes[C][]>(`/${collection}`);
}

/** Returns `null` for a 404 — the one case where "not found" is an answer, not a failure. */
export async function getOne<C extends Collection>(
  collection: C,
  id: string
): Promise<CollectionTypes[C] | null> {
  try {
    return await request<CollectionTypes[C]>(`/${collection}/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Upsert. Note this REPLACES the stored document (except for `settings`, which the backend
 * merges), so `item` must be the whole record.
 */
export async function save<C extends Collection>(collection: C, item: CollectionTypes[C]): Promise<string> {
  const result = await request<{ success: true; id: string }>(`/${collection}`, json(item));
  return result.id;
}

/** Merges `patch` into the stored document. Use this, not `save`, for a partial update. */
export async function update<C extends Collection>(
  collection: C,
  id: string,
  patch: Partial<CollectionTypes[C]>
): Promise<CollectionTypes[C]> {
  const result = await request<{ success: true; data: CollectionTypes[C] }>(
    `/${collection}/${encodeURIComponent(id)}`,
    { method: 'PUT', body: JSON.stringify(patch) }
  );
  return result.data;
}

export async function remove(collection: Collection, id: string): Promise<void> {
  await request<{ success: true }>(`/${collection}/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

// ---------------------------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------------------------

/**
 * `POST /api/batch` answers 200 with a map whose values are either the data or an
 * `{error}` object — a failed read does not fail the request. Callers must handle both, so the
 * per-key error is surfaced rather than flattened into an empty array (which is how lists used
 * to vanish mid-draw).
 */
export type BatchValue<T> = T | { error: string };

export function isBatchError<T>(value: BatchValue<T> | undefined): value is { error: string } {
  return !!value && typeof value === 'object' && 'error' in value;
}

export async function batchFetch(requests: BatchRequest[]): Promise<Record<string, BatchValue<unknown>>> {
  return request<Record<string, BatchValue<unknown>>>('/batch', json({ requests }));
}

export interface BatchSaveResult {
  results: Array<{
    success: boolean;
    id: string;
    collection: Collection;
    /**
     * The list's entry count after an entry-level operation.
     *
     * Returned rather than recomputed on both sides: the client also updates its own copy so the
     * screen does not wait for a reload, and two independent subtractions silently disagree the
     * moment the server's copy of the list differs from this page's — which is exactly the
     * concurrent-edit case entry-level operations exist to survive.
     */
    entryCount?: number;
  }>;
  writeResults: Partial<Record<Collection, boolean>>;
}

/**
 * The only safe way to write more than one document to the same collection.
 *
 * The store has no locking: two separate POSTs to `winners` both read the old array and both
 * write it back whole, so the second silently drops the first. One batched call reads once.
 */
export async function batchSave(
  operations: BatchSaveOperation[],
  timeoutMs?: number
): Promise<BatchSaveResult> {
  const init = json({ operations });
  return request<BatchSaveResult>(
    '/batch-save',
    timeoutMs ? { ...init, signal: AbortSignal.timeout(timeoutMs) } : init
  );
}

// ---------------------------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------------------------

export async function getAuthConfig(): Promise<AuthConfig> {
  return request<AuthConfig>('/auth/config');
}

export async function signInWithGoogle(credential: string): Promise<void> {
  await request<{ success: true }>('/auth/google', json({ credential }));
}

export async function signInWithPassword(username: string, password: string): Promise<void> {
  await request<{ success: true }>('/auth/login', json({ username, password }));
}

export async function signOut(): Promise<void> {
  // A failure here must not strand the operator on a page they cannot leave.
  try {
    await request<{ success: true }>('/auth/logout', { method: 'POST' });
  } catch {
    /* the redirect below is what actually signs them out of this browser */
  }
}

/** `null` when not signed in. This endpoint answers 401 with `{authenticated:false}`. */
export async function getSession(): Promise<Session | null> {
  try {
    return await request<Session>('/auth/session');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------------------------

export interface UploadedImage {
  filename: string;
  path: string;
  url: string;
}

export async function getUploadedImages(): Promise<UploadedImage[]> {
  return request<UploadedImage[]>('/uploaded-images');
}

export interface UploadedSound {
  filename: string;
  url: string;
  size: number;
}

/**
 * Sound files an operator uploaded.
 *
 * They live in `data/uploads`, the persisted volume, so they survive a deploy — unlike
 * `public/sounds`, which is baked into the container image. The old "upload sound" button
 * downloaded the file to the operator's own machine and asked them to copy it into the source
 * tree, then wrote metadata to a collection the backend does not accept, so it always failed.
 */
export async function getUploadedSounds(): Promise<UploadedSound[]> {
  return request<UploadedSound[]>('/uploaded-sounds');
}

export async function uploadSound(file: File): Promise<UploadedSound> {
  const form = new FormData();
  form.append('sound', file);

  const response = await fetch(`${API_BASE}/upload-sound`, { method: 'POST', body: form });
  const body = await readBody(response);
  if (!response.ok) throw new ApiError(messageFrom(body, response.status), response.status, body);
  return body as UploadedSound;
}

export async function deleteUploadedSound(filename: string): Promise<void> {
  await request<{ success: true }>(`/uploaded-sounds/${encodeURIComponent(filename)}`, {
    method: 'DELETE'
  });
}

/**
 * Multipart, so it bypasses `request()`'s JSON headers.
 *
 * The response `imagePath` is absolute (`/uploads/x.png`), which is wrong under the `/win`
 * mount — only the filename is kept, and `uploadUrl()` rebuilds a relative URL from it.
 */
export async function uploadBackgroundImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);

  const response = await fetch(`${API_BASE}/upload-background`, { method: 'POST', body: form });
  const body = await readBody(response);
  if (!response.ok) throw new ApiError(messageFrom(body, response.status), response.status, body);

  const { imagePath } = body as { imagePath: string };
  return imagePath;
}

/** Turns any stored upload path or bare filename into a URL that works under any mount. */
export function uploadUrl(pathOrFilename: string): string {
  const filename = pathOrFilename.split('/').pop() ?? pathOrFilename;
  return `./uploads/${filename}`;
}

// ---------------------------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------------------------

export async function checkHealth(): Promise<void> {
  await request<{ status: string; timestamp: string }>('/health');
}

// ---------------------------------------------------------------------------------------------
// Ministry Platform
// ---------------------------------------------------------------------------------------------

export async function mpGetQueries(): Promise<import('$lib/types').MpQuery[]> {
  const result = await request<{ success: true; queries: import('$lib/types').MpQuery[] }>('/mp/queries');
  return result.queries;
}

export async function mpCreateQuery(
  query: import('$lib/types').MpQuery
): Promise<import('$lib/types').MpQuery> {
  const result = await request<{ success: true; query: import('$lib/types').MpQuery }>(
    '/mp/queries',
    json(query)
  );
  return result.query;
}

export async function mpUpdateQuery(
  id: string,
  patch: Partial<import('$lib/types').MpQuery>
): Promise<import('$lib/types').MpQuery> {
  const result = await request<{ success: true; query: import('$lib/types').MpQuery }>(
    `/mp/queries/${encodeURIComponent(id)}`,
    { method: 'PUT', body: JSON.stringify(patch) }
  );
  return result.query;
}

export async function mpDeleteQuery(id: string): Promise<void> {
  await request<{ success: true }>(`/mp/queries/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface MpEventSearch {
  searchTerm?: string;
  daysPast?: number;
  daysFuture?: number;
}

export async function mpSearchEvents(search: MpEventSearch): Promise<import('$lib/types').MpEvent[]> {
  const result = await request<{ success: true; events: import('$lib/types').MpEvent[] }>(
    '/mp/events',
    json(search)
  );
  return result.events;
}

export async function mpExecuteQuery(
  queryId: string,
  params: Record<string, string>
): Promise<import('$lib/types').MpRecord[]> {
  const result = await request<{ success: true; data: import('$lib/types').MpRecord[] }>(
    '/mp/execute',
    json({ queryId, params })
  );
  return result.data;
}

export interface MpFamilyResult {
  familyIdCards: string[];
  householdId?: number;
  scannedContactId?: number;
  message?: string;
}

export async function mpFindFamilyMembers(idCard: string): Promise<MpFamilyResult> {
  return request<MpFamilyResult & { success: true }>('/mp/family-members', json({ idCard }));
}

// ---------------------------------------------------------------------------------------------
// Texting
// ---------------------------------------------------------------------------------------------

/**
 * One action-dispatch endpoint. Note the backend answers **500** for client mistakes too
 * (unknown action, missing fields), so an `ApiError` here is not necessarily a server fault.
 */
async function texting<T>(action: string, data?: Record<string, unknown>): Promise<T> {
  return request<T>('/texting', json({ action, data: data ?? {} }));
}

export interface QueuedTextingJob {
  jobId: string;
  winnerId: string;
  messageId: string | null;
  status: string;
  error: string | null;
}

export async function sendQueuedText(
  winnerId: string,
  phoneNumber: string,
  message: string
): Promise<QueuedTextingJob> {
  return texting<QueuedTextingJob>('queueAndSend', { winnerId, phoneNumber, message });
}

export async function processTextingQueue(): Promise<number> {
  const result = await texting<{ processed: number }>('processQueue');
  return result.processed;
}

export async function getTextingJobStats(): Promise<import('$lib/types').TextingJobStats> {
  return texting<import('$lib/types').TextingJobStats>('getJobStats');
}

// ---------------------------------------------------------------------------------------------
// Giveaway reports (Pretix)
// ---------------------------------------------------------------------------------------------

/**
 * Credentials for the reports host. Carried over verbatim from src/js/modules/reports.js:10-14.
 *
 * SECURITY, unchanged not endorsed: these sit in the client bundle, so anyone who can open the
 * app can read them. The right fix is for /api/reports-proxy to attach its own credentials from
 * the environment and stop forwarding the caller's header — a backend change that needs two new
 * required .env keys on the server, which would refuse to boot without them. Doing that blind,
 * outside this migration, would break the next deploy. Tracked in tasks/svelte5-migration-plan.md.
 */
const REPORTS_AUTH = 'Basic ' + btoa('admin:revival');

/**
 * Proxied server-side to dodge CORS. The upstream returns CSV as text, and the proxy passes the
 * status and content type straight through, so this reads text rather than JSON.
 */
export async function fetchReportCsv(reportType: string, params: Record<string, string>): Promise<string> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(
    `${API_BASE}/reports-proxy/execute/${encodeURIComponent(reportType)}?${query}`,
    {
      headers: {
        Accept: 'text/csv,application/csv,text/plain',
        Authorization: REPORTS_AUTH
      }
    }
  );

  if (!response.ok) {
    throw new ApiError(
      `Failed to fetch report (${response.status}).`,
      response.status,
      await response.text()
    );
  }
  return response.text();
}
