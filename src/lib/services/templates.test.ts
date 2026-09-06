import { describe, expect, it } from 'vitest';
import { availablePlaceholders, DEFAULT_TEMPLATE_ID, defaultTemplateSeed, writesForSave } from './templates';
import type { List, ListEntry, Template } from '$lib/types';

function entry(data: Record<string, string>): ListEntry {
  return { id: 'e1', index: 0, data };
}

function list(listId: string, entries: ListEntry[]): List {
  return {
    listId,
    entries,
    metadata: { listId, name: listId, timestamp: 0, entryCount: entries.length }
  };
}

function template(templateId: string, isDefault = false): Template {
  return {
    templateId,
    name: templateId,
    message: 'hi {name}',
    isDefault,
    createdAt: '2026-01-01T00:00:00.000Z'
  };
}

describe('availablePlaceholders', () => {
  const lists = [
    list('a', [entry({ firstName: 'Ada', idCard: 'A-1' })]),
    list('b', [entry({ department: 'Ops' })])
  ];

  it('always offers the placeholders that come from the winner record', () => {
    expect(availablePlaceholders([], [])).toEqual(['eventName', 'name', 'prize', 'ticketCode']);
  });

  it('adds the columns of the selected lists only', () => {
    const fields = availablePlaceholders(lists, ['a']);
    expect(fields).toContain('firstName');
    expect(fields).toContain('idCard');
    expect(fields).not.toContain('department');
  });

  it('falls back to every list when nothing is selected', () => {
    const fields = availablePlaceholders(lists, []);
    expect(fields).toContain('firstName');
    expect(fields).toContain('department');
  });

  /**
   * The reason the caller passes `validSelectedIds`: an id left behind by a deleted list would
   * otherwise narrow the source to no lists at all and silently hide every column.
   */
  it('falls back to every list when the selection names only lists that no longer exist', () => {
    const fields = availablePlaceholders(lists, ['deleted-list']);
    expect(fields).toContain('firstName');
    expect(fields).toContain('department');
  });

  it('is sorted case-insensitively and free of duplicates', () => {
    const withOverlap = [list('a', [entry({ Beta: '1', alpha: '2' })]), list('b', [entry({ alpha: '3' })])];
    const fields = availablePlaceholders(withOverlap, []);
    expect(fields.filter((f) => f === 'alpha')).toHaveLength(1);
    expect(fields.indexOf('alpha')).toBeLessThan(fields.indexOf('Beta'));
  });

  it('ignores a list with no entries rather than failing on it', () => {
    expect(() => availablePlaceholders([list('empty', [])], [])).not.toThrow();
  });
});

describe('defaultTemplateSeed', () => {
  it('keeps the stable id, so re-seeding cannot duplicate it', () => {
    expect(defaultTemplateSeed().templateId).toBe(DEFAULT_TEMPLATE_ID);
    expect(defaultTemplateSeed().isDefault).toBe(true);
  });

  /** Existing deployments hold this exact message; changing it would split old from new. */
  it('keeps the shipped message verbatim, {contactId} included', () => {
    expect(defaultTemplateSeed().message).toBe(
      'Congratulations {name}! You won {prize}. Your code: {contactId}'
    );
  });
});

describe('writesForSave', () => {
  it('writes only the template when it is not becoming the default', () => {
    const existing = [template('t1', true), template('t2')];
    expect(writesForSave(existing, template('t2'))).toEqual([template('t2')]);
  });

  it('demotes every other default in the same batch', () => {
    const existing = [template('t1', true), template('t2', true), template('t3')];
    const writes = writesForSave(existing, template('t4', true));

    expect(writes[0]?.templateId).toBe('t4');
    expect(
      writes
        .slice(1)
        .map((t) => t.templateId)
        .sort()
    ).toEqual(['t1', 't2']);
    expect(writes.slice(1).every((t) => t.isDefault === false)).toBe(true);
  });

  it('does not demote the template being saved', () => {
    const existing = [template('t1', true)];
    const writes = writesForSave(existing, template('t1', true));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.isDefault).toBe(true);
  });

  it('does not mutate the templates it was given', () => {
    const existing = [template('t1', true)];
    writesForSave(existing, template('t2', true));
    expect(existing[0]?.isDefault).toBe(true);
  });
});
