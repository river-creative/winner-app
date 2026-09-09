import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  formatDisplayName,
  formatInfoTemplate,
  getEntryId,
  orderIdOf,
  toEpoch,
  winnerCardLines
} from './format';
import type { ListEntry, Winner } from '$lib/types';

function entry(data: Record<string, string>): ListEntry {
  return { id: 'e1', data };
}

function winner(overrides: Partial<Winner> = {}): Winner {
  return {
    winnerId: 'w1',
    entryId: 'e1',
    displayName: 'Ada Lovelace',
    prize: 'Bicycle',
    timestamp: 1_700_000_000_000,
    listId: 'l1',
    listName: 'Main',
    historyId: 'h1',
    pickedUp: false,
    pickupTimestamp: null,
    position: 1,
    data: {},
    ...overrides
  };
}

describe('applyTemplate', () => {
  it('fills known fields and empties unknown ones', () => {
    expect(applyTemplate('{a}-{b}', { a: 'x' })).toBe('x-');
  });
});

describe('formatDisplayName', () => {
  it('uses the list template when there is one', () => {
    expect(
      formatDisplayName(entry({ firstName: 'Ada', lastName: 'Lovelace' }), '{firstName} {lastName}')
    ).toBe('Ada Lovelace');
  });

  it('falls back to a common name column for a list imported before templates existed', () => {
    expect(formatDisplayName(entry({ ref: '7', name: 'Ada' }), undefined)).toBe('Ada');
  });

  it('falls back to the first column when there is no name-like column at all', () => {
    expect(formatDisplayName(entry({ ref: '7' }), undefined)).toBe('7');
  });

  it('says Unknown rather than rendering an empty card', () => {
    expect(formatDisplayName(entry({}), undefined)).toBe('Unknown');
    expect(formatDisplayName(entry({ firstName: '' }), '{firstName}')).toBe('Unknown');
  });
});

describe('formatInfoTemplate', () => {
  it('reads a field off the winner before its data', () => {
    expect(formatInfoTemplate('{displayName}', winner())).toBe('Ada Lovelace');
  });

  it('reads a field out of the entry data', () => {
    expect(formatInfoTemplate('{email}', winner({ data: { email: 'ada@example.com' } }))).toBe(
      'ada@example.com'
    );
  });

  it('renders nothing for a lone dash, which is what an empty CSV cell often holds', () => {
    expect(formatInfoTemplate('{missing}', winner())).toBe('');
    expect(formatInfoTemplate('{note}', winner({ data: { note: '-' } }))).toBe('');
  });
});

describe('winnerCardLines', () => {
  it('uses the list configuration when there is one', () => {
    const lines = winnerCardLines(winner({ data: { dept: 'Analytical' } }), {
      info1: '{displayName}',
      info2: '{dept}',
      info3: ''
    });
    expect(lines).toEqual(['Ada Lovelace', 'Analytical', '']);
  });

  it('falls back to the display name for the first line', () => {
    expect(winnerCardLines(winner(), undefined)[0]).toBe('Ada Lovelace');
  });
});

describe('getEntryId', () => {
  it('prefers the entry id, then the two ticket-code spellings', () => {
    expect(getEntryId({ id: 'a', data: {} })).toBe('a');
    expect(getEntryId({ id: '', data: { 'Ticket Code': 'b' } })).toBe('b');
    expect(getEntryId({ id: '', data: { ticketCode: 'c' } })).toBe('c');
    expect(getEntryId({ id: '', data: {} })).toBeUndefined();
  });
});

describe('toEpoch', () => {
  it('reads both the number a draw writes and the ISO string the old pickup toggle wrote', () => {
    expect(toEpoch(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toEpoch('2023-11-14T22:13:20.000Z')).toBe(Date.parse('2023-11-14T22:13:20.000Z'));
  });

  it('is null for anything that is not a time', () => {
    expect(toEpoch(null)).toBeNull();
    expect(toEpoch(undefined)).toBeNull();
    expect(toEpoch('')).toBeNull();
    expect(toEpoch('not a date')).toBeNull();
  });
});

describe('orderIdOf', () => {
  it('walks the id candidates in order', () => {
    expect(orderIdOf(winner({ data: { idCard: 'A-123456' }, entryId: '' }))).toBe('A-123456');
    expect(orderIdOf(winner())).toBe('e1');
    expect(orderIdOf(winner({ entryId: '', data: {} }))).toBe('N/A');
  });
});
