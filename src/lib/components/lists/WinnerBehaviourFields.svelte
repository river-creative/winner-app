<script lang="ts">
  interface Props {
    /** Prefix for the two input ids, so the same fields can appear twice on one screen. */
    idPrefix: string;
    removeWinners: boolean;
    preventSamePrize: boolean;
  }

  let { idPrefix, removeWinners = $bindable(), preventSamePrize = $bindable() }: Props = $props();

  /**
   * A list that keeps its winners must have *some* rule stopping the same person winning the
   * same prize twice, so the flag is forced on and locked whenever winners are not removed.
   *
   * The forcing lives in the displayed value, not in the bound state: leaving `preventSamePrize`
   * alone means an operator who unticks "remove winners" and then re-ticks it gets their own
   * choice back rather than a silently rewritten one. Both callers apply the same
   * `removeWinners ? preventSamePrize : true` when they write the record.
   */
  const effectivePreventSamePrize = $derived(removeWinners ? preventSamePrize : true);
</script>

<div class="form-check mb-3">
  <input
    class="form-check-input"
    type="checkbox"
    id="{idPrefix}-remove-winners"
    bind:checked={removeWinners}
  />
  <label class="form-check-label" for="{idPrefix}-remove-winners">
    <strong>Remove winners from source list</strong>
  </label>
  <div class="form-text">When enabled, winners are removed from this list so they cannot win again.</div>
</div>

<div class="form-check mb-3">
  <input
    class="form-check-input"
    type="checkbox"
    id="{idPrefix}-prevent-same-prize"
    checked={effectivePreventSamePrize}
    disabled={!removeWinners}
    onchange={(event) => (preventSamePrize = event.currentTarget.checked)}
  />
  <label class="form-check-label" for="{idPrefix}-prevent-same-prize">
    <strong>Prevent winning same prize twice</strong>
  </label>
  <div class="form-text">
    Auto-enabled when keeping winners in list. Prevents the same person winning the same prize type twice.
  </div>
</div>

{#if !removeWinners}
  <div class="alert alert-warning py-2 mb-0" role="status">
    <i class="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>
    Winners will remain in list but cannot win the same prize twice.
  </div>
{/if}
