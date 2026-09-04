<script lang="ts">
  import type { Snippet } from 'svelte';
  import AppNav from '$lib/components/AppNav.svelte';
  import ConsoleHeader from '$lib/components/ConsoleHeader.svelte';
  import { data } from '$lib/state/data.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="container-fluid management-tabs active">
  <a class="visually-hidden-focusable skip-link" href="#console-main">Skip to content</a>

  <ConsoleHeader />
  <AppNav />

  <main id="console-main" class="tab-content" tabindex="-1">
    {#if data.error}
      <!--
        A load failure must never render as an empty state: "No lists yet — import a CSV" is a
        lie when the truth is that the server is unreachable, and it invites an operator to
        re-import data that is already there.
      -->
      <div class="alert alert-danger d-flex flex-wrap gap-2 align-items-center mt-3" role="alert">
        <div class="flex-grow-1">
          <strong>Could not load data.</strong>
          <span class="d-block small">{data.error}</span>
        </div>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick={() => void data.loadAll()}>
          Retry
        </button>
      </div>
    {:else}
      {@render children()}
    {/if}
  </main>
</div>
