<script lang="ts">
  import { fly } from 'svelte/transition';
  import { toasts, type ToastVariant } from '$lib/state/toasts.svelte';

  const ICONS: Record<ToastVariant, string> = {
    success: 'bi-check-circle-fill',
    error: 'bi-x-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    info: 'bi-info-circle-fill'
  };

  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<!--
  A live region rather than a pile of divs: a toast that only appears visually is invisible to
  anyone using a screen reader, which is most of what the old Toastify setup amounted to.
  `polite` so it never interrupts, and the container is always in the DOM so the region is
  registered before the first message arrives.
-->
<div class="app-toasts" role="status" aria-live="polite" aria-atomic="false">
  {#each toasts.items as toast (toast.id)}
    <div
      class="app-toast app-toast-{toast.variant}"
      transition:fly={{ y: reduceMotion ? 0 : 12, duration: reduceMotion ? 0 : 160 }}
    >
      <i class="bi {ICONS[toast.variant]} app-toast-icon" aria-hidden="true"></i>
      <span class="app-toast-message">{toast.message}</span>

      {#if toast.action}
        <button
          type="button"
          class="btn btn-sm btn-light app-toast-action"
          onclick={() => {
            void toast.action?.run();
            toasts.dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      {/if}

      <button
        type="button"
        class="btn-close btn-close-white app-toast-close"
        aria-label="Dismiss notification"
        onclick={() => toasts.dismiss(toast.id)}
      ></button>
    </div>
  {/each}
</div>
