/**
 * The domain model, transcribed from the records the Express backend actually stores.
 *
 * `POST /api/<collection>` REPLACES a document wholesale (only `settings` merges), so every
 * field here is load-bearing: writing a partial object destroys the fields it omits. Where a
 * field exists only because older records have it, it is marked legacy and kept optional.
 */

// ---------------------------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------------------------

/** The eight collections the backend whitelists (backend/config.ts). */
export const COLLECTIONS = [
  'lists',
  'winners',
  'prizes',
  'history',
  'settings',
  'backups',
  'templates',
  'archive'
] as const;

export type Collection = (typeof COLLECTIONS)[number];

/** The id field each collection is keyed by (backend/config.ts `KeyFields`). */
export const KEY_FIELDS = {
  lists: 'listId',
  winners: 'winnerId',
  prizes: 'prizeId',
  history: 'historyId',
  settings: 'key',
  backups: 'backupId',
  templates: 'templateId',
  archive: 'listId'
} as const satisfies Record<Collection, string>;

// ---------------------------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------------------------

/**
 * One row of an imported list.
 *
 * `data` keys are the *camelised* CSV headers for CSV imports (`Ticket Code` → `ticketCode`)
 * but the raw Ministry Platform field names for MP imports. That split is deliberate and
 * preserved: camelising MP records would change the field names existing saved lists' name and
 * card templates refer to, breaking those lists on their next sync.
 */
export interface ListEntry {
  id: string;
  index: number;
  data: Record<string, string>;
  /** Set only while a draw is running, to remember which list an entry came from. Not persisted. */
  sourceListId?: string;
  sourceListName?: string;
}

/** Where a list came from, when it was imported from Ministry Platform. */
export interface MpSource {
  queryId: string;
  queryName: string;
  params: Record<string, string>;
  importedAt: number;
}

/** How a winner's display name and the three winner-card lines are built from `entry.data`. */
export interface InfoConfig {
  info1: string;
  info2: string;
  info3: string;
}

export interface IdConfig {
  source: 'auto' | 'column';
  column?: string;
}

/**
 * Per-list overrides of the two global duplicate rules.
 *
 * `preventWinningSamePrize` is forced true whenever `removeWinnersFromList` is false — a list
 * that keeps its winners has to have *some* rule stopping the same person winning the same
 * prize twice.
 */
export interface ListSettings {
  removeWinnersFromList: boolean;
  preventWinningSamePrize: boolean;
}

export interface ListMetadata {
  listId: string;
  name: string;
  timestamp: number;
  originalFilename?: string;
  entryCount: number;
  originalCount?: number;
  skippedWinners?: number;
  /** A `{field}` template, e.g. `{firstName} {lastName}`. Older lists may have none. */
  nameConfig?: string;
  infoConfig?: InfoConfig;
  idConfig?: IdConfig;
  mpSource?: MpSource | null;
  lastSyncAt?: number | null;
  syncCount?: number;
  listSettings?: ListSettings;
  /** Set only on the synthetic list a multi-list draw runs against. Never persisted. */
  isCombined?: boolean;
  sourceListIds?: string[];
}

export interface List {
  listId: string;
  metadata: ListMetadata;
  entries: ListEntry[];
}

/** An archived list keeps its metadata so winners can still name the list they came from. */
export interface ArchivedList {
  listId: string;
  metadata: ListMetadata;
  archivedAt: number;
}

// ---------------------------------------------------------------------------------------------
// Prizes
// ---------------------------------------------------------------------------------------------

export interface Prize {
  prizeId: string;
  name: string;
  quantity: number;
  /** How many winners to draw by default when this prize is picked. */
  winnersCount?: number;
  description: string;
  /** The SMS template to use for this prize; falls back to the default template. */
  templateId?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------------------------
// Winners
// ---------------------------------------------------------------------------------------------

export type SmsStatus =
  'pending' | 'sending' | 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'cancelled' | 'unknown';

/** Written onto a winner by the texting service — both here and, behind our back, server-side. */
export interface SmsInfo {
  status: SmsStatus;
  messageId?: string | null;
  sentAt?: number | null;
  lastChecked?: number | null;
  error?: string | null;
  message?: string;
  phoneNumber?: string;
  deliveredAt?: number;
  bouncedAt?: number;
  failedAt?: number;
  optedOut?: boolean;
  optedOutAt?: number;
  replied?: boolean;
  repliedAt?: number;
  /** Set by "mark untrackable as sent": the send happened but has no messageId to poll. */
  unverified?: boolean;
  note?: string;
}

export interface Winner {
  winnerId: string;
  /** The entry id — this is what a ticket QR code carries and what the scanner looks up. */
  entryId: string;
  displayName: string;
  /** The prize *name*, not its id. Historical, and what `preventSamePrize` matches on. */
  prize: string;
  timestamp: number;
  listId: string;
  listName: string;
  historyId: string;
  pickedUp: boolean;
  /** Epoch milliseconds. Older records may hold an ISO string; read through `toEpoch()`. */
  pickupTimestamp: number | string | null;
  pickupStation?: string | null;
  position: number;
  data: Record<string, string>;
  sms?: SmsInfo | null;
  /** Derived at load time, not persisted: the source list is gone but archived. */
  isArchivedList?: boolean;
}

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------

/** The slim winner projection a history entry stores — enough to name who won, nothing more. */
export interface HistoryWinner {
  winnerId: string;
  displayName: string;
}

export interface HistoryEntry {
  historyId: string;
  /**
   * The single source list, or the first of several. A multi-list draw used to write
   * `undefined` here; it now writes the first list's id and records the rest in `listIds`.
   */
  listId: string;
  /** Every source list of the draw. One entry for a single-list draw. */
  listIds?: string[];
  listName: string;
  prize: string;
  winners: HistoryWinner[];
  timestamp: number;
}

// ---------------------------------------------------------------------------------------------
// SMS templates
// ---------------------------------------------------------------------------------------------

export interface Template {
  templateId: string;
  name: string;
  message: string;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------------------------

export interface BackupPayload {
  version: string;
  timestamp: number;
  lists: List[];
  prizes: Prize[];
  winners: Winner[];
  history: HistoryEntry[];
  templates: Template[];
  settings: Settings;
}

export interface Backup {
  backupId: string;
  name: string;
  timestamp: number;
  description: string;
  data: BackupPayload;
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

export type SelectionMode = 'all-at-once' | 'sequential' | 'individual';
export type DisplayEffect = 'fade-in' | 'fly-in' | 'zoom-in' | 'slide-in' | 'bounce-in';
export type DelayVisualType =
  'none' | 'countdown' | 'animation' | 'swirl-animation' | 'christmas-snow' | 'time-machine';
export type CelebrationEffect = 'none' | 'confetti' | 'coins' | 'both';
export type BackgroundType = 'gradient' | 'solid' | 'image';
export type FontFamily = 'Open Sans' | 'Roboto' | 'Inter' | 'Lato' | 'Poppins';
export type DisplayRatio = 'fit' | '16:9' | '16:10' | '4:3' | '21:9' | '9:16' | '3:4' | '10:12';
export type DisplayFontSize = 'default' | 'large' | 'xlarge' | 'max';
export type Theme = 'light' | 'dark';

/**
 * Every persisted setting, in one place.
 *
 * The Alpine app split these across an `Alpine.store('settings')` (which had `stableGrid` but
 * not `skipExistingWinners`) and a plain object in settings.js (which had the reverse). The
 * split was the bug: `stableGrid` could never reach the server, and settings backup wrote
 * `undefined`. This interface is the whole set.
 */
export interface Settings {
  // General
  preventDuplicates: boolean;
  preventSamePrize: boolean;
  hideEntryCounts: boolean;
  enableDebugLogs: boolean;
  skipExistingWinners: boolean;

  // Webhook
  enableWebhook: boolean;
  webhookUrl: string;

  // Theme
  fontFamily: FontFamily;
  primaryColor: string;
  secondaryColor: string;
  selectionColor: string;
  backgroundType: BackgroundType;
  customBackgroundImage: string | null;

  // Public display
  displayRatio: DisplayRatio;
  displayFontSize: DisplayFontSize;

  // Reveal
  selectionMode: SelectionMode;
  displayEffect: DisplayEffect;
  displayDuration: number;
  stableGrid: boolean;

  // Delay
  preSelectionDelay: number;
  delayVisualType: DelayVisualType;

  // Sound
  soundDuringDelay: string;
  soundEndOfDelay: string;
  soundDuringReveal: string;

  // Celebration
  celebrationEffect: CelebrationEffect;
  celebrationDuration: number;
  celebrationAutoTrigger: boolean;
}

/** One row of the `settings` collection — the backend stores settings as `{key, value}` pairs. */
export interface SettingRecord {
  key: string;
  value: unknown;
}

// ---------------------------------------------------------------------------------------------
// Ministry Platform
// ---------------------------------------------------------------------------------------------

export interface MpQueryParam {
  type: 'number' | 'text';
  label: string;
  required: boolean;
  /** A hardcoded value; when present the parameter is never shown to the operator. */
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  description?: string;
  /** Presence of any of these three turns the parameter into an event picker. */
  searchTerm?: string;
  daysPast?: number;
  daysFuture?: number;
}

export interface MpQueryMetadata {
  category?: string;
  previewFields?: string[];
}

export interface MpQuery {
  id: string;
  name: string;
  description?: string;
  table?: string;
  select?: string;
  filter?: string;
  distinct?: boolean;
  fetchParentPhone?: boolean;
  /** Lifted from `metadata.category` by the backend; `metadata` is also returned whole. */
  category?: string;
  params?: Record<string, MpQueryParam>;
  metadata?: MpQueryMetadata;
}

export interface MpEvent {
  eventID: number;
  eventTitle: string;
  eventStartDate: string | null;
}

/** MP records come back camelCase from mp-js-api, in mixed casing for the id fields. */
export type MpRecord = Record<string, string | number | null | undefined>;

// ---------------------------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------------------------

export interface Session {
  authenticated: true;
  username: string;
  provider: 'google' | 'admin';
  email?: string;
  name?: string;
}

export interface AuthConfig {
  clientId: string;
  hostedDomain: string;
}

// ---------------------------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------------------------

export type DrawPhase = 'idle' | 'delaying' | 'selecting' | 'revealing' | 'revealed';

/**
 * Everything undo needs. Captured at the moment a draw is committed.
 *
 * `entriesRemoved` records whether the draw actually removed entries from their source lists,
 * because undo must only put them back if it did.
 */
export interface LastAction {
  type: 'selectWinners';
  winners: Winner[];
  removedEntries: ListEntry[];
  prizeId: string;
  prizeCount: number;
  historyId: string;
  entriesRemoved: boolean;
  /** Set once SMS has gone out — after which the draw can no longer be undone. */
  smsSent?: boolean;
  smsSentCount?: number;
  smsSentAt?: number;
}

// ---------------------------------------------------------------------------------------------
// Sorting and filtering
// ---------------------------------------------------------------------------------------------

export type SortDirection = 'asc' | 'desc';
export type ListSortField = 'name' | 'entries' | 'date';
export type PrizeSortField = 'name' | 'quantity' | 'date';
export type WinnerSortField = 'name' | 'prize' | 'date' | 'list' | 'pickup' | 'sms';
export type HistorySortField = 'date' | 'list' | 'prize' | 'count';

/** One option in the Lists/Prizes sort toolbar, including which chevron to show. */
export interface SortOption<TField extends string> {
  field: TField;
  label: string;
  asc: string;
  desc: string;
}

// ---------------------------------------------------------------------------------------------
// Batch API
// ---------------------------------------------------------------------------------------------

export interface BatchRequest {
  collection: Collection;
  id?: string;
}

export interface BatchSaveOperation {
  collection: Collection;
  operation?: 'delete';
  id?: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// Texting
// ---------------------------------------------------------------------------------------------

export interface TextingJobStats {
  total: number;
  pending: number;
  queued: number;
  delivered: number;
  failed: number;
  unknown: number;
}

export interface SmsRecipient {
  winner: Winner;
  phone: string;
  messageTemplate: string;
}

export interface SmsSendResults {
  total: number;
  sent: number;
  successful: Array<{ winner: Winner; phone: string }>;
  failed: Array<{ winner: Winner; error: string }>;
}
