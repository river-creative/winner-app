/**
 * CSV import and export.
 *
 * The parser is a character-level state machine over the whole text rather than a line splitter.
 * The old one split on `\n` first, which broke any quoted field containing a newline — an
 * address column is enough to shift every subsequent column by one and corrupt the import
 * silently. The serialiser quotes properly for the same reason in the other direction.
 */

export interface ParseResult {
  /** One record per data row, keyed by the camelised header. */
  data: Array<Record<string, string>>;
  /** The camelised headers, in file order. */
  headers: string[];
  /** Rows whose column count did not match the header, reported rather than silently dropped. */
  errors: string[];
}

// ---------------------------------------------------------------------------------------------
// Key camelisation
// ---------------------------------------------------------------------------------------------

function capitalise(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * `Ticket Code` → `ticketCode`, `ID_Card` → `idCard`, `Prénom` → `prenom`.
 *
 * Every downstream field name — the display-name template, the three card lines, the id column,
 * `winner.data` keys and SMS placeholders — is the camelised key, so this has to stay
 * byte-identical to the old implementation or existing lists' templates stop resolving.
 * A leading underscore prefix is preserved because some report exports use it as a marker.
 */
export function camelize(key: string): string {
  const prefix = key.match(/^_{1,2}/)?.[0] ?? '';
  const rest = key.slice(prefix.length);

  if (rest === '' || /^\|+$/.test(rest)) return prefix;

  const cleaned = rest
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip the marks NFD just split off
    .replace(/[^\p{Alphabetic}\p{Number}]+/gu, '|')
    .replace(/(?<=[a-z0-9])([A-Z][A-Za-z]*[A-Za-z]\b)/, (match) => `|${match}`)
    .toLowerCase();

  const camelised = cleaned
    .split('|')
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : capitalise(part)))
    .join('');

  return prefix + camelised;
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

/**
 * Split CSV text into rows of raw fields, honouring RFC 4180 quoting.
 *
 * Handles `""` as an escaped quote, commas and newlines inside quotes, and both `\n` and `\r\n`
 * line endings. A trailing newline does not produce a phantom empty row.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAnyChar = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      sawAnyChar = true;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      sawAnyChar = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
      sawAnyChar = true;
    } else if (char === '\n' || char === '\r') {
      // Swallow the \n of a \r\n pair so it does not open an empty row.
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      field = '';
      if (sawAnyChar) rows.push(row);
      row = [];
      sawAnyChar = false;
    } else {
      field += char;
      sawAnyChar = true;
    }
  }

  if (sawAnyChar) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Parse CSV text into camel-keyed records. Blank rows are skipped, ragged rows are reported. */
export function parseCsv(text: string): ParseResult {
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim() !== ''));
  const headerRow = rows[0];

  if (!headerRow) return { data: [], headers: [], errors: ['The file is empty.'] };

  const headers = headerRow.map((header) => camelize(header.trim()));
  const errors: string[] = [];
  const data: Array<Record<string, string>> = [];

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index] as string[];

    if (row.length !== headers.length) {
      errors.push(
        `Row ${index + 1} has ${row.length} value${row.length === 1 ? '' : 's'} but the header has ${headers.length}.`
      );
      continue;
    }

    const record: Record<string, string> = {};
    headers.forEach((header, column) => {
      record[header] = (row[column] ?? '').trim();
    });
    data.push(record);
  }

  return { data, headers, errors };
}

// ---------------------------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------------------------

/** Quote a value only when it needs it, and escape embedded quotes by doubling them. */
export function csvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map(csvField).join(','));
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------------------------
// Import heuristics
// ---------------------------------------------------------------------------------------------

const FIRST_NAME_FIELDS = ['firstname', 'first_name', 'fname', 'givenname', 'given_name', 'first'];
const LAST_NAME_FIELDS = ['lastname', 'last_name', 'lname', 'surname', 'familyname', 'family_name', 'last'];
const FULL_NAME_FIELDS = [
  'fullname',
  'full_name',
  'name',
  'displayname',
  'display_name',
  'contactname',
  'contact_name',
  'customername',
  'customer_name'
];
const EMAIL_FIELDS = ['email', 'emailaddress', 'email_address', 'mail', 'e_mail'];

const normalise = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Guess the display-name template from the headers, in the same priority order as before:
 * first+last, then a single full-name column, then anything containing "name", then email.
 *
 * The last resort deliberately uses columns 1 and 2, not 0 — column 0 of these exports is
 * almost always an id.
 */
export function detectNameTemplate(headers: string[]): string {
  const byNormalised = new Map(headers.map((header) => [normalise(header), header]));

  const first = FIRST_NAME_FIELDS.map((f) => byNormalised.get(f)).find(Boolean);
  const last = LAST_NAME_FIELDS.map((f) => byNormalised.get(f)).find(Boolean);
  if (first && last) return `{${first}} {${last}}`;

  const full = FULL_NAME_FIELDS.map((f) => byNormalised.get(f)).find(Boolean);
  if (full) return `{${full}}`;

  const containsName = headers.find((header) => header.toLowerCase().includes('name'));
  if (containsName) return `{${containsName}}`;

  const email = EMAIL_FIELDS.map((f) => byNormalised.get(f)).find(Boolean);
  if (email) return `{${email}}`;

  if (headers.length > 2) return `{${headers[1]}} {${headers[2]}}`;
  if (headers.length > 0) return `{${headers[0]}}`;
  return '';
}

/**
 * The id-column candidates, most specific first. Matched case-insensitively against the
 * headers, so the many spellings the old list enumerated collapse to these stems.
 */
const ID_COLUMN_CANDIDATES = [
  'idcard',
  'contactid',
  'ticketcode',
  'userid',
  'personid',
  'participantid',
  'id',
  'code',
  'number',
  'barcode',
  'qrcode',
  'identifier'
];

export function detectIdColumn(headers: string[]): string | undefined {
  const byNormalised = new Map(headers.map((header) => [normalise(header), header]));
  for (const candidate of ID_COLUMN_CANDIDATES) {
    const match = byNormalised.get(candidate);
    if (match) return match;
  }
  return undefined;
}

export interface ColumnIdValidation {
  valid: boolean;
  error?: string;
}

/**
 * A column can only be the record id if every row has a value and no two rows share one.
 *
 * Uses a Set rather than the old `Array.includes`, which made this O(n²) — noticeable at the
 * 20 000 entries the app is specified to handle.
 */
export function validateColumnIds(rows: Array<Record<string, string>>, column: string): ColumnIdValidation {
  const empty: number[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const value = (row[column] ?? '').trim();
    if (!value) {
      empty.push(index + 2); // +2: one for the header row, one for 1-based numbering
      return;
    }
    if (seen.has(value)) {
      if (duplicates.length < 3) duplicates.push(`"${value}" (row ${index + 2})`);
      return;
    }
    seen.add(value);
  });

  if (empty.length > 0) {
    const shown = empty.slice(0, 5).join(', ');
    const more = empty.length > 5 ? ` and ${empty.length - 5} more` : '';
    return { valid: false, error: `Empty ID values found in rows: ${shown}${more}.` };
  }

  if (duplicates.length > 0) {
    return { valid: false, error: `Duplicate ID values found: ${duplicates.join(', ')}.` };
  }

  return { valid: true };
}

/** A CSV file has to be a .csv, non-empty, and under 10 MB — the same limits as before. */
export function validateCsvFile(file: File): { valid: boolean; error?: string } {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'csv') return { valid: false, error: 'Please choose a .csv file.' };
  if (file.size === 0) return { valid: false, error: 'That file is empty.' };
  if (file.size > 10 * 1024 * 1024) return { valid: false, error: 'Maximum file size is 10 MB.' };
  return { valid: true };
}
