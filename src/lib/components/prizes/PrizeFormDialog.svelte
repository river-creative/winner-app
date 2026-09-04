<script lang="ts">
  import { untrack } from 'svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import { data } from '$lib/state/data.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import type { Prize } from '$lib/types';
  import { generateId } from '$lib/utils/id';

  interface Props {
    /**
     * The prize being edited, or `null` to add one.
     *
     * Read once, when the component is created. The Prizes screen therefore mounts this dialog
     * only while it is open, so opening it for a different prize builds a fresh form — rather
     * than an `$effect` copying the prop into the field state, which would fight the operator
     * mid-edit every time the underlying record changed.
     */
    prize: Prize | null;
    /**
     * Persist the complete record. Resolving `false` keeps the dialog open with the operator's
     * input intact, so a failed write is never also a lost form.
     */
    onsave: (prize: Prize) => Promise<boolean>;
    onclose: () => void;
  }

  let { prize, onsave, onclose }: Props = $props();

  /**
   * The record this dialog was opened for, captured once at construction.
   *
   * `untrack` states that intent rather than leaving it implied: the fields below are the
   * operator's working copy from here on, and must not be rewritten underneath them if the
   * stored record changes while the dialog is open.
   */
  const initial = untrack(() => prize);

  const editing = initial !== null;
  const formId = $props.id();

  let open = $state(true);
  let saving = $state(false);

  let name = $state(initial?.name ?? '');
  let quantity = $state<number | null>(initial?.quantity ?? 1);
  let winnersCount = $state<number | null>(initial?.winnersCount ?? 1);
  let description = $state(initial?.description ?? '');

  /**
   * A template can be deleted while a prize still points at it. Falling back to "use default"
   * shows what the sender will actually do, instead of rendering a blank select that silently
   * still holds a dead id.
   */
  let templateId = $state(
    initial?.templateId && data.templateById(initial.templateId) ? initial.templateId : ''
  );

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;

    // Validation reports through toasts rather than `alert()`, which blocked the whole page and
    // could not be styled, read by a screen reader in context, or dismissed with the keyboard.
    const trimmedName = name.trim();
    if (!trimmedName) {
      toasts.warning('Please enter a prize name');
      return;
    }

    if (quantity === null || !Number.isInteger(quantity) || quantity < 0) {
      toasts.warning('Quantity must be a whole number of 0 or more');
      return;
    }

    if (winnersCount === null || !Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > 100) {
      toasts.warning('Winners count must be between 1 and 100');
      return;
    }

    /**
     * The one place a prize record is built.
     *
     * The Alpine app had two writers: this form, which wrote `winnersCount` and `templateId`,
     * and `Prizes.handleAddPrize()`, which built the record without either field. Because
     * `POST /api/prizes` replaces the document wholesale, saving through the second path erased
     * both fields from an existing prize — the default winner count and the prize's own SMS
     * template just vanished. There is now exactly one writer, and it always writes the
     * complete record.
     */
    const record: Prize = {
      prizeId: initial?.prizeId ?? generateId(),
      name: trimmedName,
      quantity,
      winnersCount,
      description: description.trim(),
      // '' is the "use the default template" option. The field is left absent rather than
      // written empty, so such a prize reads identically to one saved before templates existed.
      templateId: templateId || undefined,
      // Carried over when editing: the card labels this "Added" and the date sort reads it, so
      // stamping `Date.now()` on every edit would both misdate the prize and reorder the grid.
      timestamp: initial?.timestamp ?? Date.now()
    };

    saving = true;
    try {
      if (await onsave(record)) open = false;
    } finally {
      saving = false;
    }
  }
</script>

<Dialog bind:open title={editing ? 'Edit Prize' : 'Add New Prize'} {onclose}>
  <form id={formId} onsubmit={handleSubmit}>
    <div class="mb-3">
      <label for="{formId}-name" class="form-label">
        Prize Name <span class="text-danger" aria-hidden="true">*</span>
      </label>
      <input
        id="{formId}-name"
        type="text"
        class="form-control"
        placeholder="Enter prize name"
        required
        bind:value={name}
      />
    </div>

    <div class="mb-3">
      <label for="{formId}-quantity" class="form-label">
        Quantity <span class="text-danger" aria-hidden="true">*</span>
      </label>
      <input
        id="{formId}-quantity"
        type="number"
        class="form-control"
        min="0"
        step="1"
        required
        bind:value={quantity}
      />
    </div>

    <div class="mb-3">
      <label for="{formId}-winners" class="form-label">Default Winners Count</label>
      <small id="{formId}-winners-help" class="d-block text-muted">
        Number of winners to select when this prize is chosen
      </small>
      <input
        id="{formId}-winners"
        type="number"
        class="form-control"
        min="1"
        max="100"
        step="1"
        required
        aria-describedby="{formId}-winners-help"
        bind:value={winnersCount}
      />
    </div>

    <div class="mb-3">
      <label for="{formId}-description" class="form-label">Description (Optional)</label>
      <textarea
        id="{formId}-description"
        class="form-control"
        rows="3"
        placeholder="Enter prize description"
        bind:value={description}></textarea>
    </div>

    <div>
      <label for="{formId}-template" class="form-label">SMS Template</label>
      <select id="{formId}-template" class="form-select" bind:value={templateId}>
        <option value="">Use default template</option>
        {#each data.templates as template (template.templateId)}
          <option value={template.templateId}>
            {template.name}{template.isDefault ? ' (Default)' : ''}
          </option>
        {/each}
      </select>
    </div>
  </form>

  {#snippet footer()}
    <button type="button" class="btn btn-secondary" disabled={saving} onclick={() => (open = false)}>
      Cancel
    </button>
    <!-- Outside the <form>, so it is associated by id — which keeps Enter-to-submit working. -->
    <button type="submit" form={formId} class="btn btn-primary" disabled={saving}>
      {#if saving}
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      {/if}
      {editing ? 'Save Changes' : 'Add Prize'}
    </button>
  {/snippet}
</Dialog>
