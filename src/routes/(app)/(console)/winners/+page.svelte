<script lang="ts">
  import WinnersFilters from '$lib/components/winners/WinnersFilters.svelte';
  import WinnersTable from '$lib/components/winners/WinnersTable.svelte';
  import WinnersToolbar from '$lib/components/winners/WinnersToolbar.svelte';
</script>

<svelte:head><title>Winners · River Winner</title></svelte:head>

<h1 class="visually-hidden">All winners</h1>

<!--
  A failed load is not rendered here: the console layout owns that, and shows the error in place
  of every screen. "No winners match the current filters" is a lie when the truth is that the
  server is unreachable, and it invites an operator to go looking for a filter that is not set.
-->
<div class="card">
  <div class="card-body">
    <WinnersToolbar />
    <WinnersFilters />
    <WinnersTable />
  </div>
</div>
