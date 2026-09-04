<script lang="ts">
  import Dialog from './Dialog.svelte';
  import { ui } from '$lib/state/ui.svelte';

  const request = $derived(ui.confirmRequest);
  const open = $derived(request !== null);

  const confirmClass = $derived(
    request?.variant === 'primary'
      ? 'btn-primary'
      : request?.variant === 'warning'
        ? 'btn-warning'
        : 'btn-danger'
  );
</script>

<!--
  One confirmation dialog for the whole app, driven by `ui.confirm()`'s promise. The old app had
  a Bootstrap modal that callers reached into by id and handed a callback, which is why its
  delete paths ended up with their cleanup split across two functions.
-->
{#if request}
  <Dialog
    bind:open={
      () => open,
      (value) => {
        // Escape, the close button and a backdrop click all arrive here as "not open".
        if (!value) ui.resolveConfirm(false);
      }
    }
    title={request.title}
    size="modal-sm"
  >
    <p class="mb-0">{request.message}</p>

    {#if request.details && request.details.length > 0}
      <ul class="mt-3 mb-0 ps-3 text-muted small">
        {#each request.details as detail (detail)}
          <li>{detail}</li>
        {/each}
      </ul>
    {/if}

    {#snippet footer()}
      <button type="button" class="btn btn-secondary" onclick={() => ui.resolveConfirm(false)}>
        {request.cancelText ?? 'Cancel'}
      </button>
      <button type="button" class="btn {confirmClass}" onclick={() => ui.resolveConfirm(true)}>
        {request.confirmText ?? 'Confirm'}
      </button>
    {/snippet}
  </Dialog>
{/if}
