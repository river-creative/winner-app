<script lang="ts">
  /**
   * The ticket-code / name search box, used on the scanner screen and again to refine a result
   * list. One component so the two can never drift — the `.btn-label` span in particular, which
   * responsive.css hides below `md` to keep the row on one line on a phone.
   */
  interface Props {
    value: string;
    placeholder: string;
    /** There is no visible label in this design, so the field carries its name itself. */
    label: string;
    disabled?: boolean;
    onsearch: () => void;
  }

  let { value = $bindable(), placeholder, label, disabled = false, onsearch }: Props = $props();

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    // Stops the browser treating this as an implicit form submit if it is ever put in a form.
    event.preventDefault();
    onsearch();
  }
</script>

<div class="input-group search-input-group">
  <input
    type="text"
    class="form-control"
    aria-label={label}
    {placeholder}
    {disabled}
    bind:value
    onkeydown={handleKeydown}
  />
  <button type="button" class="btn btn-outline-secondary" {disabled} onclick={onsearch}>
    <i class="bi bi-search" aria-hidden="true"></i><span class="btn-label"> Search</span>
  </button>
</div>
