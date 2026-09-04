<script lang="ts">
  import type { SortDirection } from '$lib/types';

  interface Props {
    label: string;
    /** Which icon pair the column sorts with. Chevrons only make sense next to what they sort. */
    kind?: 'text' | 'number' | 'date';
    active: boolean;
    /** The current direction. Only meaningful while `active`. */
    direction: SortDirection;
    onsort: () => void;
  }

  let { label, kind = 'text', active, direction, onsort }: Props = $props();

  /** The chevrons the Alpine markup used, kept per column type. */
  const ICONS = {
    text: { asc: 'bi-sort-alpha-down', desc: 'bi-sort-alpha-up' },
    number: { asc: 'bi-sort-numeric-down', desc: 'bi-sort-numeric-up' },
    date: { asc: 'bi-sort-down', desc: 'bi-sort-up' }
  } as const;

  const icon = $derived(active ? ICONS[kind][direction] : 'bi-chevron-expand');

  const ariaSort = $derived<'ascending' | 'descending' | 'none'>(
    active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
  );
</script>

<!--
  `aria-sort` belongs on the header cell, the control belongs in a real <button>.

  The old markup hung `@click` on the bare `<th>`: sorting a table was mouse-only, and nothing
  announced which column was sorted or in which direction. The button is transparent, so the
  cell keeps Bootstrap's header styling and the `.sortable-header` hover it always had.
-->
<th scope="col" class="sortable-header" aria-sort={ariaSort}>
  <button type="button" class="table-sort" onclick={onsort}>
    <span>{label}</span>
    <i class="bi {icon}" aria-hidden="true"></i>
  </button>
</th>
