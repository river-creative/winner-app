import { Persisted } from '$lib/utils/persisted.svelte';

/** The page sizes offered in the pager. The smallest is also the size below which no pager shows. */
export const PAGE_SIZES = [25, 50, 100, 250] as const;

const DEFAULT_PAGE_SIZE = 50;

/**
 * Page-at-a-time slicing for the console's data tables.
 *
 * **Why paging and not a virtualised body.** Both bound the DOM, which is the point: the app is
 * specified to 20 000 entries and a single draw can produce hundreds of winners, so rendering
 * every row builds a DOM the size of the dataset and makes every filter keystroke re-layout it.
 * Below the `md` breakpoint, though, responsive.css §7 turns each row into a card whose height
 * depends on its content, so a window calculated from a fixed row height is wrong there *by
 * construction*, and a measured one re-measures on every resize and every content change. Paging
 * needs no height model at all and keeps the `<thead>` a real, unscrolled table header.
 *
 * **Ctrl+F.** The browser's find bar only sees what is in the DOM, so it searches the current
 * page and nothing else. That is why the page size is the operator's to choose and why the
 * visible range is stated above the pager — finding a name across the whole set is what the
 * filters above the table are for, and they narrow the data rather than the rendering.
 *
 * Everything below is a plain getter over reactive reads rather than a `$derived` field: the
 * rows arrive as a function, so a field initialiser would close over it before the constructor
 * had assigned it. The reads are cheap (a `slice` of at most one page) and each is consumed once
 * per render, where Svelte's own tracking memoises it.
 */
export class Pagination<T> {
  #rows: () => T[];
  #resetKey: () => string;
  #size: Persisted<number>;

  /**
   * The chosen page, tagged with the filter state it was chosen under.
   *
   * Comparing that tag in `page` below is what snaps back to page 1 when the filters change,
   * without an `$effect` writing state: the page number is never copied from one place to
   * another, it is recomputed. An effect would also fire a frame late, which is long enough to
   * render page 7 of a result that now has two pages.
   */
  #anchor = $state<{ key: string; page: number }>({ key: '', page: 1 });

  /**
   * @param rows       the already filtered and sorted rows, read lazily so reads stay tracked
   * @param resetKey   a string that changes whenever the result set answers a different question
   * @param storageKey localStorage key for the operator's page-size choice
   */
  constructor(rows: () => T[], resetKey: () => string, storageKey: string) {
    this.#rows = rows;
    this.#resetKey = resetKey;
    this.#size = new Persisted<number>(storageKey, DEFAULT_PAGE_SIZE);
  }

  /**
   * A stored size is untrusted input — another build's value, a hand-edited key, a half-written
   * string — so anything not on the menu falls back rather than producing a NaN page count.
   */
  get size(): number {
    const stored = this.#size.current;
    return (PAGE_SIZES as readonly number[]).includes(stored) ? stored : DEFAULT_PAGE_SIZE;
  }

  set size(value: number) {
    this.#size.current = value;
    // Row 3 000 is not on page 1 of a 250-row page and page 1 of a 25-row page. Go to the top.
    this.#anchor = { key: this.#resetKey(), page: 1 };
  }

  get total(): number {
    return this.#rows().length;
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.total / this.size));
  }

  get page(): number {
    if (this.#anchor.key !== this.#resetKey()) return 1;
    return Math.min(this.#anchor.page, this.pageCount);
  }

  get visible(): T[] {
    const start = (this.page - 1) * this.size;
    return this.#rows().slice(start, start + this.size);
  }

  /** 1-based index of the first visible row, or 0 when there are none. */
  get firstIndex(): number {
    return this.total === 0 ? 0 : (this.page - 1) * this.size + 1;
  }

  get lastIndex(): number {
    return Math.min(this.page * this.size, this.total);
  }

  /** A table that fits in the smallest page has nothing to page through. */
  get needed(): boolean {
    return this.total > PAGE_SIZES[0];
  }

  goto(page: number): void {
    this.#anchor = {
      key: this.#resetKey(),
      page: Math.max(1, Math.min(Math.trunc(page), this.pageCount))
    };
  }
}
