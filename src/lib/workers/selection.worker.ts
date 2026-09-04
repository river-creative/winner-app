/**
 * Picks the winners, off the main thread.
 *
 * A real module worker rather than a Blob built from a template string. The old version created
 * an object URL and a `Worker` per draw and released neither, so a long event leaked one worker
 * per draw — and the code inside it was a string, so nothing type-checked it.
 *
 * The message carries a pool *size* and comes back with positions. Entries themselves never
 * cross the boundary: on the calling side they are Svelte `$state` proxies, and a Proxy cannot
 * be structured-cloned — posting one throws "could not be cloned" and the draw dies at the worst
 * possible moment. Integers also copy far more cheaply than twenty thousand objects.
 *
 * The algorithm lives in `$lib/services/shuffle` so it can be unit-tested and reused as the
 * main-thread fallback; this file is only the message plumbing.
 */

import { selectIndices } from '$lib/services/shuffle';

export interface SelectionRequest {
  poolSize: number;
  numWinners: number;
}

export type SelectionResponse = { type: 'complete'; indices: number[] } | { type: 'error'; error: string };

self.addEventListener('message', (event: MessageEvent<SelectionRequest>) => {
  try {
    const { poolSize, numWinners } = event.data;
    const response: SelectionResponse = {
      type: 'complete',
      indices: selectIndices(poolSize, numWinners)
    };
    self.postMessage(response);
  } catch (error) {
    const response: SelectionResponse = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    };
    self.postMessage(response);
  }
});
