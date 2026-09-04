<script lang="ts">
  import { ui } from '$lib/state/ui.svelte';
</script>

<!--
  Reuses the existing .progress-overlay styling. `aria-live` and the progressbar role are new:
  an import of twenty thousand rows was previously silent to anyone not watching the bar.

  The container is always in the DOM, hidden by class rather than by `{#if}`, for two reasons:
  the `aria-live` region has to be registered before it is filled, and `$lib/state/layers.ts`
  moves this element into an open dialog as that dialog opens — an element that only appears
  later would be created back in `<body>`, behind the top layer, and never seen.
-->
<div
  class="progress-overlay"
  class:is-visible={ui.progressVisible}
  role="status"
  aria-live="polite"
  aria-hidden={!ui.progressVisible}
>
  {#if ui.progressVisible}
    <div class="progress-content">
      <h5>{ui.progressTitle}</h5>
      <div
        class="progress-bar-custom"
        role="progressbar"
        aria-valuenow={Math.round(ui.progressPercent)}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label={ui.progressTitle}
      >
        <div class="progress-fill" style:width="{ui.progressPercent}%"></div>
      </div>
      <p>{ui.progressText}</p>
    </div>
  {/if}
</div>
