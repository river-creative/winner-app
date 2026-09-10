import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the setup store does with a selected list that has gone missing.
 *
 * The persisted selection is a list of ids, and an id can outlive its list — deleted in another
 * tab, on the operator's phone, or by a write that bypasses the service layer. (`deleteList` and
 * `archiveList` both deselect as they go, so this does not arise from normal use in one tab.)
 *
 * Two properties are load-bearing and pull in opposite directions, which is why they are pinned
 * together here: everything the app *reads* must ignore the stale id, and nothing may *delete*
 * it from storage on the strength of `data.lists` not containing it. `loadAll` leaves the lists
 * untouched when the request fails and boot swallows that failure, so an empty `data.lists` can
 * mean "the network is down" — pruning against it would wipe an operator's setup mid-event.
 */

/**
 * `$state`, not a plain array: the store reads this through `$derived`, and a plain variable
 * would never invalidate it — the "load failed" test below would then pass against a memoised
 * value and prove nothing.
 */
let lists = $state<Array<{ listId: string; metadata: Record<string, unknown>; entries: unknown[] }>>([]);

vi.mock('./data.svelte', () => ({
  data: {
    get lists() {
      return lists;
    },
    get winners() {
      return [];
    },
    listById: (id: string) => lists.find((l) => l.listId === id),
    prizeById: () => undefined
  }
}));

vi.mock('./settings.svelte', () => ({
  settings: { current: { preventSamePrize: false, preventDuplicates: false } }
}));

const { setup } = await import('./setup.svelte');

const list = (listId: string) => ({
  listId,
  metadata: { listId, name: listId, entryCount: 1 },
  entries: [{ id: `${listId}-e1`, data: {} }]
});

beforeEach(() => {
  lists = [list('real-a'), list('real-b')];
  setup.reset();
});

describe('a selected list that no longer exists', () => {
  it('is ignored by everything the app reads', () => {
    setup.selectList('real-a');
    setup.selectList('gone');

    expect(setup.validSelectedIds).toEqual(['real-a']);
    expect(setup.validSelectedCount).toBe(1);
    expect(setup.selectedLists.map((l) => l.listId)).toEqual(['real-a']);
    expect(setup.listDisplayText).toBe('real-a');
  });

  // Otherwise one stale id makes "everything is selected" true with a list left unchecked.
  it('cannot make allListsSelected true on its own', () => {
    setup.selectList('real-a');
    setup.selectList('gone');
    expect(setup.allListsSelected).toBe(false);

    setup.selectList('real-b');
    expect(setup.allListsSelected).toBe(true);
  });

  // The whole reason the stale id is tolerated rather than pruned. `loadAll` leaves the lists
  // untouched when the request fails and boot swallows that failure, so this state is reachable
  // by a transient blip — and it is exactly when erasing the operator's setup would hurt most.
  it('survives data.lists being empty, because empty can mean "the load failed"', () => {
    setup.selectList('real-a');
    setup.selectList('real-b');

    lists = [];
    expect(setup.validSelectedIds).toEqual([]);

    // Nothing was thrown away: the moment the retry succeeds, the selection is back.
    lists = [list('real-a'), list('real-b')];
    expect(setup.validSelectedIds).toEqual(['real-a', 'real-b']);
  });

  it('is dropped by Select All, which rewrites the selection from what exists', () => {
    setup.selectList('gone');
    setup.selectAllLists();

    expect(setup.validSelectedIds).toEqual(['real-a', 'real-b']);
    expect(setup.isListSelected('gone')).toBe(false);
  });

  it('is removed by deselecting it, which is what deleteList and archiveList call', () => {
    setup.selectList('real-a');
    setup.selectList('gone');
    setup.deselectList('gone');

    expect(setup.isListSelected('gone')).toBe(false);
    expect(setup.validSelectedIds).toEqual(['real-a']);
  });
});
