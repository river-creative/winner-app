<script lang="ts">
  import type { Template } from '$lib/types';

  interface Props {
    template: Template;
    onedit: () => void;
    ondelete: () => void;
    onsetdefault: () => void;
  }

  let { template, onedit, ondelete, onsetdefault }: Props = $props();
</script>

<!--
  The old Templates tab built this card as an HTML string and assigned it with `innerHTML`,
  interpolating the operator-supplied name and message straight into the markup — stored XSS:
  a template named `<img onerror=…>` ran on every visit to the tab. Here both are text nodes,
  escaped by the compiler. Do not reintroduce `{@html}` to get the line breaks back; that is
  what `white-space: pre-wrap` below is for.
-->
<div class="card h-100" class:border-primary={template.isDefault}>
  <div class="card-header d-flex justify-content-between align-items-center gap-2">
    <h6 class="mb-0 text-truncate" title={template.name}>{template.name}</h6>
    {#if template.isDefault}
      <span class="badge bg-success flex-shrink-0">
        <i class="bi bi-star" aria-hidden="true"></i> Default
      </span>
    {/if}
  </div>

  <div class="card-body d-flex flex-column">
    <p class="card-text small text-muted template-message">{template.message}</p>

    <div class="d-flex justify-content-between align-items-center gap-2 mt-auto pt-3">
      {#if template.isDefault}
        <!-- Keeps the action pair right-aligned on every card, default or not. -->
        <span></span>
      {:else}
        <button
          type="button"
          class="btn btn-sm btn-outline-info"
          aria-label="Set {template.name} as the default template"
          onclick={onsetdefault}
        >
          <i class="bi bi-star" aria-hidden="true"></i> Set as default
        </button>
      {/if}

      <div class="btn-group btn-group-sm flex-shrink-0">
        <button
          type="button"
          class="btn btn-outline-primary"
          title="Edit template"
          aria-label="Edit {template.name}"
          onclick={onedit}
        >
          <i class="bi bi-pencil" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="btn btn-outline-danger"
          title="Delete template"
          aria-label="Delete {template.name}"
          onclick={ondelete}
        >
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  /*
    Message bodies are multi-line and hold `{placeholder}` tokens that must not be broken up.
    `pre-wrap` keeps the operator's line breaks without any markup being generated from them.
  */
  .template-message {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin-bottom: 0;
  }
</style>
