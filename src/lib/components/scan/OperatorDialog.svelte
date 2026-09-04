<script lang="ts">
  import Dialog from '$lib/components/Dialog.svelte';
  import { scanner } from '$lib/state/scanner.svelte';

  const canContinue = $derived(scanner.operatorInput.trim().length > 0);

  function submit() {
    if (!canContinue) return;
    scanner.setOperatorName(scanner.operatorInput);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  }
</script>

<!--
  Not dismissible: the name entered here is stamped on every pickup as the station that handed
  the prize over, and a pickup with no station is a record nobody can follow up on. Escape and a
  backdrop click are therefore refused rather than silently leaving it unset.
-->
<Dialog bind:open={() => true, () => {}} title="Operator Setup" size="modal-sm" dismissible={false}>
  <div class="text-center">
    <div class="alert-icon alert-icon-info" aria-hidden="true">
      <i class="bi bi-person-badge"></i>
    </div>
    <p class="alert-message">Please enter your name to track prize pickups.</p>

    <div class="mb-3">
      <label class="visually-hidden" for="scan-operator-name">Your name</label>
      <!-- A mandatory dialog with exactly one field: focus belongs in it, so the usual
           objection to autofocus (stealing focus from the page) does not apply. -->
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="scan-operator-name"
        type="text"
        class="form-control form-control-lg text-center"
        placeholder="Enter your name"
        autocomplete="name"
        autofocus
        bind:value={scanner.operatorInput}
        onkeydown={handleKeydown}
      />
    </div>
  </div>

  {#snippet footer()}
    <button type="button" class="btn btn-primary" disabled={!canContinue} onclick={submit}>
      <i class="bi bi-check-circle" aria-hidden="true"></i>
      <span class="ms-2">Continue</span>
    </button>
  {/snippet}
</Dialog>
