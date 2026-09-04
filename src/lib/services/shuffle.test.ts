import { describe, expect, it } from 'vitest';
import { selectWinners } from '$lib/services/shuffle';
import type { ListEntry } from '$lib/types';

function entries(count: number): ListEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    index,
    data: {}
  }));
}

describe('selectWinners', () => {
  it('returns exactly the number asked for', () => {
    expect(selectWinners(entries(100), 7)).toHaveLength(7);
  });

  it('never returns more than there are entries', () => {
    expect(selectWinners(entries(3), 10)).toHaveLength(3);
  });

  it('returns only entries that were in the pool, and never the same one twice', () => {
    const pool = entries(50);
    const winners = selectWinners(pool, 20);
    const ids = new Set(winners.map((winner) => winner.id));

    expect(ids.size).toBe(20);
    for (const winner of winners) expect(pool).toContain(winner);
  });

  it('does not modify the pool it was given', () => {
    const pool = entries(10);
    const before = pool.map((entry) => entry.id);
    selectWinners(pool, 5);
    expect(pool.map((entry) => entry.id)).toEqual(before);
  });

  it('gives every entry a comparable chance', () => {
    // The bug this algorithm was rewritten to fix was positional bias: adjacent rows in the CSV
    // — which is to say families — kept winning together. With 200 draws of 1 from 10, a fair
    // process puts roughly 20 in each bucket; a positional bias shows up as one bucket near zero.
    const pool = entries(10);
    const counts = new Map<string, number>();

    for (let round = 0; round < 200; round++) {
      const winner = selectWinners(pool, 1)[0];
      if (winner) counts.set(winner.id, (counts.get(winner.id) ?? 0) + 1);
    }

    expect(counts.size).toBe(10);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(2);
      expect(count).toBeLessThan(60);
    }
  });

  it('copes with an empty pool', () => {
    expect(selectWinners([], 5)).toEqual([]);
  });
});
