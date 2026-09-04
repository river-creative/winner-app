import { describe, expect, it } from 'vitest';
import {
  camelize,
  csvField,
  detectIdColumn,
  detectNameTemplate,
  parseCsv,
  parseCsvRows,
  toCsv,
  validateColumnIds
} from './csv';

describe('camelize', () => {
  it('produces the keys existing lists templates already refer to', () => {
    expect(camelize('Ticket Code')).toBe('ticketCode');
    expect(camelize('ID_Card')).toBe('idCard');
    expect(camelize('First Name')).toBe('firstName');
    expect(camelize('Contact_ID')).toBe('contactId');
  });

  it('strips diacritics rather than dropping the letters', () => {
    expect(camelize('Prénom')).toBe('prenom');
    expect(camelize('Región')).toBe('region');
  });

  it('keeps a leading underscore prefix, which some report exports use as a marker', () => {
    expect(camelize('_internal id')).toBe('_internalId');
    expect(camelize('__raw')).toBe('__raw');
  });
});

describe('parseCsvRows', () => {
  it('keeps a comma inside quotes in one field', () => {
    expect(parseCsvRows('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
  });

  it('keeps a newline inside quotes in one field', () => {
    // This is the case the old line-splitting parser could not handle: one address column with
    // a line break shifted every subsequent column by one, silently.
    expect(parseCsvRows('name,address\n"Ada","12 Vine St\nApt 4"')).toEqual([
      ['name', 'address'],
      ['Ada', '12 Vine St\nApt 4']
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsvRows('a,"say ""hi""",b')).toEqual([['a', 'say "hi"', 'b']]);
  });

  it('handles CRLF without leaving a stray carriage return', () => {
    expect(parseCsvRows('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ]);
  });

  it('does not invent a row for a trailing newline', () => {
    expect(parseCsvRows('a,b\n')).toEqual([['a', 'b']]);
  });
});

describe('parseCsv', () => {
  it('camelises the headers and trims the values', () => {
    const result = parseCsv('First Name, Last Name\n Ada , Lovelace ');
    expect(result.headers).toEqual(['firstName', 'lastName']);
    expect(result.data).toEqual([{ firstName: 'Ada', lastName: 'Lovelace' }]);
    expect(result.errors).toEqual([]);
  });

  it('reports a ragged row instead of silently dropping or misaligning it', () => {
    const result = parseCsv('a,b\n1,2\n3');
    expect(result.data).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Row 3');
  });

  it('reports an empty file rather than throwing', () => {
    expect(parseCsv('').errors).toEqual(['The file is empty.']);
  });
});

describe('toCsv', () => {
  it('quotes only what needs quoting, and escapes embedded quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('has,comma')).toBe('"has,comma"');
    expect(csvField('has"quote')).toBe('"has""quote"');
    expect(csvField(null)).toBe('');
  });

  it('round-trips through the parser', () => {
    const headers = ['name', 'note'];
    const rows = [['Ada, the first', 'said "hello"\nthen left']];
    const parsed = parseCsvRows(toCsv(headers, rows));
    expect(parsed).toEqual([headers, rows[0]]);
  });
});

describe('detectNameTemplate', () => {
  it('prefers a first and last name pair', () => {
    expect(detectNameTemplate(['id', 'firstName', 'lastName'])).toBe('{firstName} {lastName}');
  });

  it('falls back to a single full-name column', () => {
    expect(detectNameTemplate(['id', 'fullName'])).toBe('{fullName}');
  });

  it('falls back to any header containing "name"', () => {
    expect(detectNameTemplate(['id', 'displayNameValue'])).toBe('{displayNameValue}');
  });

  it('falls back to email before giving up', () => {
    expect(detectNameTemplate(['email'])).toBe('{email}');
  });

  it('skips column 0 in the last resort, because it is almost always an id', () => {
    expect(detectNameTemplate(['ref', 'alpha', 'beta'])).toBe('{alpha} {beta}');
  });
});

describe('detectIdColumn', () => {
  it('prefers the most specific candidate present', () => {
    expect(detectIdColumn(['id', 'ticketCode', 'idCard'])).toBe('idCard');
    expect(detectIdColumn(['id', 'ticketCode'])).toBe('ticketCode');
    expect(detectIdColumn(['reference'])).toBeUndefined();
  });
});

describe('validateColumnIds', () => {
  it('accepts a column whose values are all present and unique', () => {
    expect(validateColumnIds([{ id: 'a' }, { id: 'b' }], 'id')).toEqual({ valid: true });
  });

  it('reports empty values by their spreadsheet row number', () => {
    const result = validateColumnIds([{ id: 'a' }, { id: '' }], 'id');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('rows: 3');
  });

  it('reports duplicates', () => {
    const result = validateColumnIds([{ id: 'a' }, { id: 'a' }], 'id');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('"a" (row 3)');
  });
});
