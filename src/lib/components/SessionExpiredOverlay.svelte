<script lang="ts">
  import { session } from '$lib/state/session.svelte';

  let element = $state<HTMLDialogElement>();

  /**
   * A modal `<dialog>`, not a styled div.
   *
   * It has to sit above whatever the operator was doing — including an open dialog, which lives
   * in the top layer where no z-index can reach it — and it has to be genuinely blocking: an
   * expired cookie makes every read and every write fail, so a console that keeps accepting
   * input is lying about what it can save. `showModal()` gives the top layer, the inert page
   * behind, and the focus trap in one call.
   *
   * There is deliberately no `oncancel` handler and no close button: Escape must not dismiss it,
   * because there is nothing to go back to until the operator signs in again.
   */
  $effect(() => {
    const dialog = element;
    if (!dialog) return;
    if (session.expired && !dialog.open) dialog.showModal();
  });
</script>

{#if session.expired}
  <dialog
    bind:this={element}
    class="app-dialog session-expired"
    aria-labelledby="session-expired-title"
    oncancel={(event) => event.preventDefault()}
  >
    <div class="session-expired-card">
      <div class="session-expired-icon" aria-hidden="true">🔒</div>
      <h4 id="session-expired-title">Session expired</h4>
      <p>Please sign in again to continue.</p>
      <!-- `loginHref` is built with resolve() and carries the return path; the rule cannot see
           through the getter. -->
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a class="btn btn-primary" href={session.loginHref}>Sign in</a>
    </div>
  </dialog>
{/if}
