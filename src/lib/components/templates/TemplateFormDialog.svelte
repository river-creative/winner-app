<script lang="ts">
  import { untrack } from 'svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import type { Template } from '$lib/types';
  import { generateId } from '$lib/utils/id';

  interface Props {
    /**
     * The template being edited, or `null` to add one.
     *
     * Read once, when the component is created — the Templates screen mounts this dialog only
     * while it is open, so there is no effect copying the record into the field state.
     */
    template: Template | null;
    /** The placeholder names the message may use, already resolved by the screen. */
    placeholders: string[];
    /** Persist the complete record. Resolving `false` leaves the dialog open with the input intact. */
    onsave: (template: Template) => Promise<boolean>;
    onclose: () => void;
  }

  let { template, placeholders, onsave, onclose }: Props = $props();

  /**
   * The record this dialog was opened for, captured once at construction.
   *
   * `untrack` states that intent rather than leaving it implied: the fields below are the
   * operator's working copy from here on, and must not be rewritten underneath them if the
   * stored record changes while the dialog is open.
   */
  const initial = untrack(() => template);

  const editing = initial !== null;
  const formId = $props.id();

  let open = $state(true);
  let saving = $state(false);

  let name = $state(initial?.name ?? '');
  let message = $state(initial?.message ?? '');
  let isDefault = $state(initial?.isDefault ?? false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;

    const trimmedName = name.trim();
    const trimmedMessage = message.trim();

    if (!trimmedName) {
      toasts.warning('Please enter a template name');
      return;
    }

    if (!trimmedMessage) {
      toasts.warning('Please enter a message');
      return;
    }

    const now = new Date().toISOString();

    const record: Template = {
      // `tmpl_` marks a template id at a glance, as it always has. The timestamp that used to
      // follow it is replaced by a random id: two templates created in the same millisecond
      // would otherwise share an id, and the second would overwrite the first.
      templateId: initial?.templateId ?? `tmpl_${generateId()}`,
      name: trimmedName,
      message: trimmedMessage,
      isDefault,
      // The old form wrote `createdAt` on add and `updatedAt` on edit — never both. Since
      // `POST /api/templates` replaces the document, the first edit erased the creation date of
      // every template. Both are written here, and `createdAt` is carried over.
      createdAt: initial?.createdAt ?? now,
      updatedAt: editing ? now : undefined
    };

    saving = true;
    try {
      if (await onsave(record)) open = false;
    } finally {
      saving = false;
    }
  }
</script>

<Dialog bind:open title={editing ? 'Edit SMS Template' : 'Add SMS Template'} {onclose}>
  <form id={formId} onsubmit={handleSubmit}>
    <div class="mb-3">
      <label for="{formId}-name" class="form-label">
        Template Name <span class="text-danger" aria-hidden="true">*</span>
      </label>
      <input
        id="{formId}-name"
        type="text"
        class="form-control"
        placeholder="Enter template name"
        required
        bind:value={name}
      />
    </div>

    <div>
      <label for="{formId}-message" class="form-label">
        Message <span class="text-danger" aria-hidden="true">*</span>
      </label>
      <textarea
        id="{formId}-message"
        class="form-control"
        rows="8"
        required
        aria-describedby="{formId}-placeholders"
        bind:value={message}></textarea>
      <div id="{formId}-placeholders" class="form-text">
        <strong>Available placeholders:</strong><br />
        {#each placeholders as placeholder (placeholder)}
          <code class="me-1">{`{${placeholder}}`}</code>
        {/each}
      </div>
    </div>

    <div class="form-check mt-3">
      <input id="{formId}-default" class="form-check-input" type="checkbox" bind:checked={isDefault} />
      <label class="form-check-label" for="{formId}-default">Set as default template</label>
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
      {editing ? 'Save Changes' : 'Save Template'}
    </button>
  {/snippet}
</Dialog>
