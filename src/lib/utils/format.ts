import type { InfoConfig, ListEntry, Winner } from '$lib/types';

const PLACEHOLDER = /\{([^}]+)\}/g;

/**
 * Fill `{field}` placeholders from a flat record. Unknown fields resolve to an empty string,
 * which is what makes a template like `{firstName} {lastName}` degrade gracefully on a list
 * that only has one of the two.
 */
export function applyTemplate(template: string, data: Record<string, string | undefined>): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => data[key.trim()] ?? '');
}

/**
 * The name shown on a winner card and in every table.
 *
 * `nameConfig` is a `{field}` template. Lists imported before templates existed have none, and
 * fall back to the common name columns and then to the first column — dropping that fallback
 * would turn every legacy list's winners into "Unknown".
 */
export function formatDisplayName(entry: ListEntry, nameConfig?: string): string {
  if (typeof nameConfig === 'string') {
    return applyTemplate(nameConfig, entry.data).trim() || 'Unknown';
  }

  for (const field of ['name', 'full_name', 'first_name', 'last_name']) {
    const value = entry.data[field];
    if (value) return value;
  }

  const firstKey = Object.keys(entry.data)[0];
  return (firstKey ? entry.data[firstKey] : undefined) || 'Unknown';
}

/** A winner record carrying the pre-template `contactInfo` shape some restored backups still have. */
type LegacyWinner = Winner & {
  contactInfo?: { phoneNumber?: string; orderId?: string; email?: string };
  [key: string]: unknown;
};

/**
 * Resolve one winner-card line.
 *
 * Lookup order, preserved exactly: a field on the winner itself, then the legacy `contactInfo`
 * aliases, then `winner.data`. A line that resolves to nothing — or to a bare dash, which is
 * what an empty CSV cell often holds — renders as empty so the card does not show a stray "-".
 */
export function formatInfoTemplate(template: string, winner: Winner): string {
  if (!template) return '';
  const record = winner as LegacyWinner;

  const result = template
    .replace(PLACEHOLDER, (_match, rawKey: string) => {
      const key = rawKey.trim();

      const direct = record[key];
      if (typeof direct === 'string' && direct) return direct;
      if (typeof direct === 'number') return String(direct);

      const contact = record.contactInfo;
      if (contact) {
        if ((key === 'phoneNumber' || key === 'phone') && contact.phoneNumber) return contact.phoneNumber;
        if ((key === 'orderId' || key === 'Order ID') && contact.orderId) return contact.orderId;
        if ((key === 'email' || key === 'orderEmail') && contact.email) return contact.email;
      }

      return winner.data[key] ?? '';
    })
    .trim();

  return result === '-' || result === '' ? '' : result;
}

/** The three lines of a winner card, with the same per-line fallbacks the old renderer used. */
export function winnerCardLines(winner: Winner, infoConfig?: InfoConfig): [string, string, string] {
  const record = winner as LegacyWinner;

  const line = (template: string | undefined, fallbackFields: string[], last: string): string => {
    if (template) return formatInfoTemplate(template, winner);
    for (const field of fallbackFields) {
      const value = record[field];
      if (typeof value === 'string' && value) return value;
    }
    return last;
  };

  return [
    infoConfig?.info1 ? formatInfoTemplate(infoConfig.info1, winner) : winner.displayName || '',
    line(infoConfig?.info2, ['email', 'department', 'title', 'position'], ''),
    line(infoConfig?.info3, ['phone', 'id', 'employee_id', 'member_id'], '')
  ];
}

/**
 * The entry id a draw, an import and the scanner all agree on.
 *
 * The same three-step fallback appeared in four places in the old code; one copy diverging is
 * how an entry can be deduplicated in one path and not in another.
 */
export function getEntryId(entry: ListEntry): string | undefined {
  return entry.id || entry.data['Ticket Code'] || entry.data['ticketCode'] || undefined;
}

/**
 * Epoch milliseconds from a timestamp that may be a number, an ISO string, or absent.
 *
 * `pickupTimestamp` is written as `null` at creation, as epoch ms by a draw, and used to be
 * written as an ISO string by the pickup toggle. Reads go through here so all three sort and
 * compare correctly.
 */
export function toEpoch(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatDate(value: number | string | null | undefined): string {
  const epoch = toEpoch(value);
  return epoch === null ? '' : new Date(epoch).toLocaleDateString();
}

export function formatDateTime(value: number | string | null | undefined): string {
  const epoch = toEpoch(value);
  if (epoch === null) return '';
  return new Date(epoch).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** `YYYY-MM-DD` in local time — what the date filters compare against. */
export function toDateInputValue(value: number | string | null | undefined): string {
  const epoch = toEpoch(value);
  if (epoch === null) return '';
  const date = new Date(epoch);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/**
 * The id shown in the winners table. Order preserved from the Alpine `winnerHelpers` helper —
 * a Pretix order code first, then the entry id, then the two Ministry Platform id shapes.
 */
export function orderIdOf(winner: Winner): string {
  const record = winner as LegacyWinner;
  const candidates = [
    record['orderId'],
    record['orderCode'],
    winner.entryId,
    winner.data['idCard'],
    winner.data['contactId']
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return 'N/A';
}
