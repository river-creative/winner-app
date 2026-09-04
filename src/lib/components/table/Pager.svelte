<script lang="ts">
  import { PAGE_SIZES } from './pagination.svelte';
  import { formatNumber } from '$lib/utils/format';

  interface Props {
    page: number;
    pageCount: number;
    size: number;
    total: number;
    /** 1-based index of the first visible row. */
    firstIndex: number;
    lastIndex: number;
    /** Plural noun for the rows, e.g. `winners`. Used in the range text and the landmark label. */
    noun: string;
    onpage: (page: number) => void;
    onsize: (size: number) => void;
  }

  let { page, pageCount, size, total, firstIndex, lastIndex, noun, onpage, onsize }: Props = $props();

  const sizeId = $props.id();
</script>

<nav class="table-pager" aria-label="{noun} pages">
  <div class="table-pager-size">
    <label class="form-label mb-0" for={sizeId}>Rows per page</label>
    <select
      id={sizeId}
      class="form-select form-select-sm"
      value={size}
      onchange={(event) => onsize(Number(event.currentTarget.value))}
    >
      {#each PAGE_SIZES as option (option)}
        <option value={option}>{option}</option>
      {/each}
    </select>
  </div>

  <p class="table-pager-range text-muted mb-0">
    Showing {formatNumber(firstIndex)}–{formatNumber(lastIndex)} of {formatNumber(total)}
    {noun}
  </p>

  <div class="d-flex align-items-center gap-2">
    <span class="text-muted">Page {formatNumber(page)} of {formatNumber(pageCount)}</span>
    <div class="btn-group btn-group-sm" role="group" aria-label="{noun} page navigation">
      <button
        type="button"
        class="btn btn-outline-secondary"
        title="First page"
        aria-label="First page"
        disabled={page <= 1}
        onclick={() => onpage(1)}
      >
        <i class="bi bi-chevron-double-left" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="btn btn-outline-secondary"
        title="Previous page"
        aria-label="Previous page"
        disabled={page <= 1}
        onclick={() => onpage(page - 1)}
      >
        <i class="bi bi-chevron-left" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="btn btn-outline-secondary"
        title="Next page"
        aria-label="Next page"
        disabled={page >= pageCount}
        onclick={() => onpage(page + 1)}
      >
        <i class="bi bi-chevron-right" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="btn btn-outline-secondary"
        title="Last page"
        aria-label="Last page"
        disabled={page >= pageCount}
        onclick={() => onpage(pageCount)}
      >
        <i class="bi bi-chevron-double-right" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</nav>
