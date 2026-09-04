<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
</script>

<svelte:head><title>Something went wrong · River Winner</title></svelte:head>

<!--
  The router's own error page. Without one, a mistyped URL or a failed navigation renders
  SvelteKit's unstyled default, which looks like the app has crashed rather than that the address
  is wrong. Every path here is client-side, so "go back" is always a real option.
-->
<div class="app-boot">
  <div class="card" style="max-width: 32rem;">
    <div class="card-body">
      <h1 class="h4 card-title">
        {page.status === 404 ? 'That page does not exist' : 'Something went wrong'}
      </h1>

      <p class="text-muted">
        {page.error?.message ?? 'The page could not be loaded.'}
      </p>

      <div class="d-flex flex-wrap gap-2 justify-content-center">
        <a class="btn btn-primary" href={resolve('/')}>Back to Setup</a>
        <button type="button" class="btn btn-outline-secondary" onclick={() => history.back()}>
          Go back
        </button>
      </div>
    </div>
  </div>
</div>
