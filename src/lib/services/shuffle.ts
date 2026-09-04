import type { ListEntry } from '$lib/types';

/**
 * The draw itself: which entries win.
 *
 * Kept free of any worker or DOM API so it can be tested directly and used as the main-thread
 * fallback when a worker cannot be constructed. `selection.worker.ts` is a thin message wrapper
 * around this.
 */

/**
 * A uniform integer in `[0, bound)`.
 *
 * Rejection sampling rather than a plain modulo: the 32-bit range does not divide evenly by most
 * bounds, and keeping the remainder would over-represent the first few entries. In a fair draw
 * that is the one thing that must not happen.
 */
function secureRandomBelow(bound: number): number {
  const limit = Math.floor(0x100000000 / bound) * bound;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0] as number;
  } while (value >= limit);
  return value % bound;
}

/** Fisher-Yates, in place. Every permutation equally likely, O(n). */
function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = secureRandomBelow(i + 1);
    const a = items[i] as T;
    const b = items[j] as T;
    items[i] = b;
    items[j] = a;
  }
  return items;
}

/** Fisher-Yates on a copy, for callers that must not have their input reordered. */
export function shuffle<T>(items: T[]): T[] {
  return shuffleInPlace([...items]);
}

/**
 * Pick `numWinners` positions out of a pool of `poolSize`, in reveal order.
 *
 * Positions rather than the entries themselves, because this runs in a worker and the entries on
 * the calling side are Svelte `$state` proxies — a Proxy cannot be structured-cloned, so posting
 * them throws "could not be cloned". Sending a count and getting indices back also means a draw
 * from twenty thousand entries copies twenty thousand integers instead of twenty thousand
 * objects, and the caller keeps the original object identities it needs to map winners to lists.
 *
 * The triple shuffle is kept exactly as it was. One Fisher-Yates pass is already uniform, so the
 * second is mathematically redundant — but the third is not: it randomises the order the winners
 * are *revealed* in, independently of the order they were drawn. The second pass stays because
 * this is the algorithm that fixed the "families keep winning together" complaint the app was
 * rebuilt over, and re-deriving it under a live event is not a trade worth making.
 */
export function selectIndices(poolSize: number, numWinners: number): number[] {
  const indices = Array.from({ length: Math.max(0, poolSize) }, (_, index) => index);

  shuffleInPlace(indices);
  shuffleInPlace(indices);

  const selected = indices.slice(0, Math.max(0, Math.min(numWinners, indices.length)));
  return shuffleInPlace(selected);
}

/** The same draw, expressed over the entries themselves. Used by the tests and by nothing else. */
export function selectWinners(entries: ListEntry[], numWinners: number): ListEntry[] {
  return selectIndices(entries.length, numWinners).map((index) => entries[index] as ListEntry);
}
