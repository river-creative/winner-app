<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** A bootstrap-icons class, e.g. `bi-gift`. */
    icon: string;
    title: string;
    /** The way out of the empty state — usually the button that creates the first record. */
    action?: Snippet;
  }

  let { icon, title, action }: Props = $props();
</script>

<div class="empty-state">
  <i class="bi {icon} empty-state-icon" aria-hidden="true"></i>
  <p class="empty-state-title">{title}</p>
  {#if action}
    {@render action()}
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 1rem;
    text-align: center;
  }

  /*
    Both tones are the body colour at reduced strength, so they follow whichever theme is active
    instead of needing a rule per theme. The three copies of this markup this component replaced
    used `.text-muted`, which did neither: Bootstrap resolved it to a light-mode near-black that
    sat at 1.05:1 against the dark cards, leaving the caption and the icon all but invisible.
  */
  .empty-state-icon {
    font-size: 3.5rem;
    line-height: 1;
    color: var(--bs-body-color);
    opacity: 0.35;
  }

  .empty-state-title {
    margin: 0;
    font-size: 1.05rem;
    color: var(--bs-body-color);
    opacity: 0.75;
  }
</style>
