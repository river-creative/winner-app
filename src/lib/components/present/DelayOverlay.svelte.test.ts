/// <reference types="@testing-library/jest-dom/vitest" />
import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { List, Prize } from '$lib/types';

/**
 * What the room sees between the countdown ending and the winners appearing.
 *
 * The bug this covers: the spinner was shown on *every* draw the instant the countdown ended,
 * because the overlay inferred "still working" from `phase === 'delaying'` plus its own
 * `delayElapsed` flag — which cannot tell "the write is in flight" from "the write finished two
 * seconds ago". Measured against the operator's own data, the spinner mounted 1.8 s after the
 * winners were already saved.
 *
 * A `MutationObserver` rather than sampling: the spinner mounted for a single flush is still a
 * spinner the browser can paint, and polling would miss it. Every assertion here is "was this
 * node ever in the document", not "is it there now".
 */

const batchSave = vi.fn();

// Partial: `session.svelte.ts` registers `onSessionExpired` at module load, and the store under
// test reaches the client through `data.commit`, so only the write is stubbed.
vi.mock('$lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/api/client')>()),
  batchSave: (...args: unknown[]) => batchSave(...args),
  getAll: vi.fn(async () => []),
  batchFetch: vi.fn(async () => ({}))
}));

vi.mock('$lib/services/sounds', () => ({
  playSound: vi.fn(async () => {}),
  stopSound: vi.fn(),
  playBeep: vi.fn(),
  BUILT_IN_SOUNDS: []
}));

const { default: DelayOverlay } = await import('./DelayOverlay.svelte');
const { draw } = await import('$lib/state/draw.svelte');
const { data } = await import('$lib/state/data.svelte');
const { setup } = await import('$lib/state/setup.svelte');
const { settings } = await import('$lib/state/settings.svelte');

/** A promise whose resolution this test controls, standing in for the round trip to the server. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let listCounter = 0;

function seedDraw(): { list: List; prize: Prize } {
  listCounter += 1;
  const listId = `list-${listCounter}`;
  const prizeId = `prize-${listCounter}`;

  const list: List = {
    listId,
    metadata: {
      listId,
      name: `List ${listCounter}`,
      timestamp: Date.now(),
      entryCount: 3,
      nameConfig: '{name}',
      listSettings: { removeWinnersFromList: true, preventWinningSamePrize: false }
    },
    entries: [0, 1, 2].map((index) => ({
      id: `${listId}-entry-${index}`,
      index,
      data: { name: `Entry ${index}` }
    }))
  } as unknown as List;

  const prize: Prize = {
    prizeId,
    name: `Prize ${listCounter}`,
    quantity: 5,
    winnersCount: 1,
    description: '',
    timestamp: Date.now()
  } as unknown as Prize;

  data.upsertList(list);
  data.upsertPrize(prize);
  setup.clearSelectedLists();
  setup.selectList(listId);
  setup.selectPrize(prizeId);
  setup.winnersCount = 1;

  return { list, prize };
}

/**
 * Records every mount of the spinner, however brief.
 *
 * Registered for teardown rather than stopped inline: a failing assertion skips the rest of the
 * test, and an observer that outlives the jsdom document fires against a `document` that is no
 * longer defined — which buries the real failure under a callback error.
 */
let observers: MutationObserver[] = [];

function watchForSpinner(): { everShown: () => boolean } {
  let shown = !!document.querySelector('.delay-spinner');
  const observer = new MutationObserver(() => {
    if (document.querySelector('.delay-spinner')) shown = true;
  });
  observer.observe(document.body, { childList: true, subtree: true });
  observers.push(observer);
  return { everShown: () => shown };
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  batchSave.mockReset();
  draw.reset();
  settings.setMany({
    preSelectionDelay: 0.15,
    delayVisualType: 'countdown',
    selectionMode: 'all-at-once',
    soundDuringDelay: 'none',
    soundEndOfDelay: 'none',
    soundDuringReveal: 'none',
    enableWebhook: false
  });
});

afterEach(() => {
  for (const observer of observers) observer.disconnect();
  observers = [];
  draw.reset();
});

describe('DelayOverlay', () => {
  it('never shows the spinner when the winners are saved before the countdown ends', async () => {
    render(DelayOverlay);
    seedDraw();
    batchSave.mockResolvedValue({ results: [], writeResults: {} });

    const spinner = watchForSpinner();
    const phases: string[] = [];
    const poll = setInterval(() => {
      if (phases[phases.length - 1] !== draw.phase) phases.push(draw.phase);
    }, 5);

    await draw.start();
    clearInterval(poll);

    expect(batchSave).toHaveBeenCalledTimes(1);
    expect(draw.phase).toBe('revealed');
    expect(phases).not.toContain('selecting');
    expect(spinner.everShown()).toBe(false);
  });

  it('shows the spinner only while the write is genuinely still in flight', async () => {
    render(DelayOverlay);
    seedDraw();

    const commit = deferred<{ results: never[]; writeResults: object }>();
    batchSave.mockReturnValue(commit.promise);

    const spinner = watchForSpinner();
    const started = draw.start();

    // Past the 150 ms countdown, with the write still unanswered.
    await tick(300);
    expect(draw.phase).toBe('selecting');
    expect(spinner.everShown()).toBe(true);
    expect(document.querySelector('.delay-spinner')).toBeInTheDocument();

    commit.resolve({ results: [], writeResults: {} });
    await started;

    expect(draw.phase).toBe('revealed');
    expect(document.querySelector('.delay-spinner')).not.toBeInTheDocument();
  });

  it('leaves the stage empty through the end-of-delay sting rather than faking a load', async () => {
    // The sting buys a beat before the reveal: 100 ms of silence, the sound, then 500 ms for it
    // to land. Nothing is loading during it, so nothing may claim to be.
    settings.setMany({ soundEndOfDelay: 'sting-rimshot' });

    render(DelayOverlay);
    seedDraw();
    batchSave.mockResolvedValue({ results: [], writeResults: {} });

    const spinner = watchForSpinner();
    await draw.start();

    expect(draw.phase).toBe('revealed');
    expect(spinner.everShown()).toBe(false);
  });
});
