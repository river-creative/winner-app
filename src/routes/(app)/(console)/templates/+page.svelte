<script lang="ts">
  import EmptyState from '$lib/components/EmptyState.svelte';
  import TemplateCard from '$lib/components/templates/TemplateCard.svelte';
  import TemplateFormDialog from '$lib/components/templates/TemplateFormDialog.svelte';
  import { availablePlaceholders, writesForSave } from '$lib/services/templates';
  import { data } from '$lib/state/data.svelte';
  import { setup } from '$lib/state/setup.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import type { Template } from '$lib/types';
  import { pluralise } from '$lib/utils/format';

  let formOpen = $state(false);
  let editingTemplate = $state<Template | null>(null);

  /**
   * Resolved once for the screen and handed to the dialog, so the hint under the message box and
   * the list below the grid can never disagree — they did in the Alpine app, which computed the
   * same set twice from two copies of the code.
   */
  const placeholders = $derived(availablePlaceholders(data.lists, setup.validSelectedIds));

  /**
   * Seeding the empty collection happens in `$lib/state/boot.svelte.ts`, not here.
   *
   * The legacy module did it when this tab first opened, which meant an operator who never
   * visited the tab had no default template — and the SMS sender falls back to exactly that,
   * so sending refused with "No SMS templates found" on a fresh install.
   */

  /**
   * The screen's single write path for a template.
   *
   * "Exactly one default" is an invariant over the whole collection, so saving a template that
   * claims the flag also has to clear it everywhere else — and all of it goes in ONE
   * `data.commit`. The old code wrote each demotion as its own request, and since every write is
   * a read-modify-write of the same JSON array with no locking, the responses raced and
   * demotions were silently lost, leaving two defaults.
   */
  async function persistTemplate(template: Template): Promise<boolean> {
    const writes = writesForSave(data.templates, template);
    const previous = [...data.templates];

    for (const record of writes) data.upsertTemplate(record);

    try {
      await data.commit(
        writes.map((record) => ({
          collection: 'templates' as const,
          data: record as unknown as Record<string, unknown>
        }))
      );
      return true;
    } catch (error) {
      // Put back exactly what each written record looked like before — or remove it, if it did
      // not exist yet.
      for (const record of writes) {
        const before = previous.find((item) => item.templateId === record.templateId);
        if (before) data.upsertTemplate(before);
        else data.removeTemplate(record.templateId);
      }
      data.reportWriteFailure(error, 'the template');
      return false;
    }
  }

  function openAdd(): void {
    editingTemplate = null;
    formOpen = true;
  }

  function openEdit(template: Template): void {
    editingTemplate = template;
    formOpen = true;
  }

  async function saveTemplate(template: Template): Promise<boolean> {
    const existed = data.templateById(template.templateId) !== undefined;
    const saved = await persistTemplate(template);
    if (saved) toasts.success(existed ? 'Template updated' : 'Template added');
    return saved;
  }

  async function setDefault(template: Template): Promise<void> {
    if (template.isDefault) return;
    if (await persistTemplate({ ...template, isDefault: true })) {
      toasts.success(`"${template.name}" is now the default template`);
    }
  }

  async function deleteTemplate(template: Template): Promise<void> {
    const details: string[] = [];

    if (template.isDefault) {
      details.push(
        'This is the default template. Until another one is set as the default, winners with no prize-specific template have no message to fall back on.'
      );
    }

    // Prizes reference a template by id; the prize form already treats a dangling reference as
    // "use the default", so this warns rather than blocks.
    const usedBy = data.prizes.filter((prize) => prize.templateId === template.templateId).length;
    if (usedBy > 0) {
      details.push(
        `${usedBy} ${pluralise(usedBy, 'prize uses', 'prizes use')} this template and will fall back to the default.`
      );
    }

    const confirmed = await ui.confirm({
      title: 'Delete Template',
      message: `Delete "${template.name}"?`,
      details: details.length > 0 ? details : undefined,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    data.removeTemplate(template.templateId);

    try {
      await data.commit([{ collection: 'templates', operation: 'delete', id: template.templateId }]);
      toasts.success(`Template "${template.name}" deleted`, {
        label: 'Undo',
        run: () => restoreTemplate(template)
      });
    } catch (error) {
      data.upsertTemplate(template);
      data.reportWriteFailure(error, 'the template');
    }
  }

  /** Undo for the delete above. Goes through the same writer, so restoring the default demotes
      whichever template took its place in the meantime. */
  async function restoreTemplate(template: Template): Promise<void> {
    if (await persistTemplate(template)) {
      toasts.success(`Template "${template.name}" restored`);
    }
  }
</script>

<svelte:head><title>Templates · River Winner</title></svelte:head>

<h1 class="visually-hidden">SMS template management</h1>

<!--
  A failed load is rendered by the console layout, which shows the error instead of this page —
  so the empty state below is only ever reached after a load that actually succeeded.
-->
<div class="card">
  <div class="card-body">
    <div class="section-toolbar">
      <h5 class="card-title section-toolbar-title">SMS Templates</h5>
      <button type="button" class="btn btn-primary" onclick={openAdd}>
        <i class="bi bi-plus-circle me-2" aria-hidden="true"></i>Add Template
      </button>
    </div>

    {#if data.loading}
      <div class="row g-3 mb-4">
        <span class="visually-hidden" role="status">Loading templates…</span>
        {#each [0, 1, 2] as slot (slot)}
          <div class="col-md-6 col-lg-4" aria-hidden="true">
            <div class="card h-100 placeholder-glow">
              <div class="card-header"><span class="placeholder col-6"></span></div>
              <div class="card-body">
                <span class="placeholder col-12"></span>
                <span class="placeholder col-10"></span>
                <span class="placeholder col-8"></span>
                <span class="placeholder col-5 mt-3"></span>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else if data.templates.length === 0}
      <EmptyState icon="bi-chat-text" title="No templates yet">
        {#snippet action()}
          <button type="button" class="btn btn-primary" onclick={openAdd}>
            <i class="bi bi-plus-circle me-2" aria-hidden="true"></i>Add your first template
          </button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="row g-3 mb-4">
        {#each data.templates as template (template.templateId)}
          <div class="col-md-6 col-lg-4">
            <TemplateCard
              {template}
              onedit={() => openEdit(template)}
              ondelete={() => void deleteTemplate(template)}
              onsetdefault={() => void setDefault(template)}
            />
          </div>
        {/each}
      </div>
    {/if}

    <div class="alert alert-info mb-0">
      <i class="bi bi-info-circle me-2" aria-hidden="true"></i>
      <strong>Available placeholders:</strong>
      {#each placeholders as placeholder (placeholder)}
        <code class="me-1">{`{${placeholder}}`}</code>
      {/each}
    </div>
  </div>
</div>

<!--
  Mounted only while open, so each opening builds its fields from the record it was given rather
  than needing an effect to copy the record into form state.
-->
{#if formOpen}
  <TemplateFormDialog
    template={editingTemplate}
    {placeholders}
    onsave={saveTemplate}
    onclose={() => (formOpen = false)}
  />
{/if}
