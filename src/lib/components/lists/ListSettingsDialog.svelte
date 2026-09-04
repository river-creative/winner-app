<script lang="ts">
  import Dialog from '$lib/components/Dialog.svelte';
  import { saveList } from '$lib/services/lists';
  import { data } from '$lib/state/data.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import type { List } from '$lib/types';
  import WinnerBehaviourFields from './WinnerBehaviourFields.svelte';

  interface Props {
    /** The list to edit. Read once at creation — the parent re-creates this dialog per list. */
    list: List;
    onclose: () => void;
  }

  let { list, onclose }: Props = $props();

  let open = $state(true);
  let saving = $state(false);

  /*
   * Seeded from the record at creation, and read once on purpose: the parent keys this component
   * on the list id, so editing a different list builds a fresh instance rather than these being
   * re-copied out of the prop by an effect.
   *
   * Unlike the Alpine dialog, `preventSamePrize` starts from the *stored* value. That form always
   * opened it unchecked and then wrote whatever it found back, so opening the settings of a list
   * and pressing Save silently cleared the flag.
   */
  // svelte-ignore state_referenced_locally
  let name = $state(list.metadata.name);
  // svelte-ignore state_referenced_locally
  let removeWinners = $state(
    list.metadata.listSettings?.removeWinnersFromList ?? settings.current.preventDuplicates
  );
  // svelte-ignore state_referenced_locally
  let preventSamePrize = $state(
    list.metadata.listSettings?.preventWinningSamePrize ?? settings.current.preventSamePrize
  );

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toasts.warning('Please give the list a name.');
      return;
    }

    saving = true;
    try {
      await saveList({
        ...list,
        metadata: {
          ...list.metadata,
          name: trimmed,
          listSettings: {
            removeWinnersFromList: removeWinners,
            // Forced on for a list that keeps its winners — see WinnerBehaviourFields.
            preventWinningSamePrize: removeWinners ? preventSamePrize : true
          }
        }
      });

      toasts.success('List settings saved.');
      open = false;
    } catch (error) {
      data.reportWriteFailure(error, 'the list settings');
    } finally {
      saving = false;
    }
  }
</script>

<Dialog bind:open title="Edit List Settings" {onclose}>
  <div class="mb-3">
    <label class="form-label fw-bold" for="edit-list-name">List Name</label>
    <input id="edit-list-name" type="text" class="form-control" bind:value={name} />
  </div>

  <hr />

  <h6 class="text-muted mb-3">Winner Behavior Settings</h6>

  <WinnerBehaviourFields idPrefix="edit-list" bind:removeWinners bind:preventSamePrize noticeVariant="info" />

  {#snippet footer()}
    <button type="button" class="btn btn-secondary" onclick={() => (open = false)}>Cancel</button>
    <button type="button" class="btn btn-primary" disabled={saving} onclick={() => void save()}>
      {#if saving}
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      {:else}
        <i class="bi bi-check-lg me-2" aria-hidden="true"></i>
      {/if}
      Save Changes
    </button>
  {/snippet}
</Dialog>
