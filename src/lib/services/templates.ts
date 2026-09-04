import type { List, Template } from '$lib/types';

/**
 * SMS message templates: the placeholders a message may use, and the invariants the collection
 * has to keep.
 *
 * This lives outside the Templates screen because the SMS sender needs the same two answers —
 * which placeholders are legal, and which template is the default. The old app computed the
 * placeholder set twice (templates.js and the Alpine `formModal`), from two slightly different
 * pieces of code, so the hint under the message box could list fields the sender would not fill.
 */

/**
 * Placeholders that resolve for every list, because they come from the winner record rather
 * than from an imported column.
 */
const FIXED_PLACEHOLDERS = ['name', 'prize', 'ticketCode', 'eventName'] as const;

/** The id of the template seeded into an empty collection. Stable, so re-seeding cannot duplicate it. */
export const DEFAULT_TEMPLATE_ID = 'tmpl_default';

/**
 * Every placeholder name a template may reference, sorted for display.
 *
 * The column names come from the *first* entry of each list — one row is enough, because a CSV
 * import gives every row the same keys. Only the lists currently selected for the draw are
 * consulted, since those are the rows the next send will actually run against; with nothing
 * selected there is no such hint, so every list contributes.
 *
 * Pass `setup.validSelectedIds` rather than the raw selection: an id left behind by a deleted
 * list would otherwise narrow the source lists to none and silently hide every column.
 */
export function availablePlaceholders(lists: List[], selectedListIds: readonly string[]): string[] {
  const fields = new Set<string>(FIXED_PLACEHOLDERS);

  const selected = lists.filter((list) => selectedListIds.includes(list.listId));
  const source = selected.length > 0 ? selected : lists;

  for (const list of source) {
    const first = list.entries[0];
    if (!first) continue;
    for (const key of Object.keys(first.data)) fields.add(key);
  }

  return [...fields].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * The record seeded when the collection is empty, byte-for-byte what the Alpine app wrote.
 *
 * `{contactId}` is deliberate and not a typo for `{ticketCode}`: existing deployments have this
 * exact message stored, and changing the seed would make a fresh install send something
 * different from every install already running.
 */
export function defaultTemplateSeed(): Template {
  return {
    templateId: DEFAULT_TEMPLATE_ID,
    name: 'Default Winner Notification',
    message: 'Congratulations {name}! You won {prize}. Your code: {contactId}',
    isDefault: true,
    createdAt: new Date().toISOString()
  };
}

/**
 * The complete set of records to write when saving `template`: the template itself, plus every
 * other template that must give up `isDefault`.
 *
 * "Exactly one default" is an invariant over the whole collection, so it cannot be maintained by
 * writing one document. The old code wrote each demoted template with its own request, which is
 * a read-modify-write of the same JSON array per request — the last response wins and the
 * earlier demotions are silently lost. The caller commits this list in one batch instead.
 */
export function writesForSave(templates: Template[], template: Template): Template[] {
  if (!template.isDefault) return [template];

  const demoted = templates
    .filter((other) => other.templateId !== template.templateId && other.isDefault)
    .map((other) => ({ ...other, isDefault: false }));

  return [template, ...demoted];
}
