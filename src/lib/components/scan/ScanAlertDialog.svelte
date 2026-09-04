<script lang="ts">
  import Dialog from '$lib/components/Dialog.svelte';

  /**
   * The scanner's two dead-end answers: a code that matches no winner, and a search that matches
   * nobody. Both quote back what was scanned or typed, because the first thing a volunteer does
   * is check they read it right.
   *
   * A real `<dialog>`, not the old `.alert-overlay` div: that one carried `role="button"`, so a
   * screen reader announced the whole message as a button, and Escape did nothing.
   */
  interface Props {
    title: string;
    message: string;
    /** Picks the `.alert-icon` gradient — red for a miss, grey for an empty search. */
    variant: 'error' | 'search';
    icon: string;
    /** The code or term to quote back, already labelled. */
    detail: string;
    onclose: () => void;
  }

  let { title, message, variant, icon, detail, onclose }: Props = $props();
</script>

<Dialog
  bind:open={
    () => true,
    (value) => {
      // Escape, the close button and a backdrop click all arrive here as "not open". The parent
      // unmounts this component in response, so there is no second pass through here.
      if (!value) onclose();
    }
  }
  {title}
  size="modal-sm"
>
  <div class="text-center">
    <div class="alert-icon alert-icon-{variant}" aria-hidden="true">
      <i class="bi {icon}"></i>
    </div>
    <p class="alert-message">{message}</p>
    <p class="alert-code mb-0">{detail}</p>
  </div>

  {#snippet footer()}
    <button type="button" class="btn btn-primary" onclick={onclose}>
      <i class="bi bi-arrow-left" aria-hidden="true"></i>
      <span class="ms-2">Back</span>
    </button>
  {/snippet}
</Dialog>
