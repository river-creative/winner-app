<script lang="ts" generics="K extends keyof Settings">
  import type { Option } from '$lib/constants/options';
  import { settings } from '$lib/state/settings.svelte';
  import type { Settings } from '$lib/types';
  import InfoTip from './InfoTip.svelte';

  interface Props {
    /** The setting this control owns. Its type constrains the options. */
    setting: K;
    label: string;
    /** Flat option list. Omitted when `groups` carries the options instead. */
    options?: Option<Extract<Settings[K], string>>[];
    /** Optional grouped form, for the display-ratio picker. */
    groups?: Array<{ label: string; options: Option<Extract<Settings[K], string>>[] }>;
    tooltip?: string;
    help?: string;
    disabled?: boolean;
  }

  let { setting, label, options = [], groups, tooltip, help, disabled = false }: Props = $props();

  const id = $props.id();
  const value = $derived(settings.current[setting] as Extract<Settings[K], string>);

  function change(event: Event & { currentTarget: HTMLSelectElement }) {
    settings.set(setting, event.currentTarget.value as Settings[K]);
  }
</script>

<div class="mb-3">
  <label class="form-label" for={id}>
    {label}{#if tooltip}<InfoTip text={tooltip} />{/if}
  </label>
  <select {id} class="form-select" {value} {disabled} onchange={change}>
    {#if groups}
      {#each groups as group (group.label)}
        {#if group.label}
          <optgroup label={group.label}>
            {#each group.options as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </optgroup>
        {:else}
          {#each group.options as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        {/if}
      {/each}
    {:else}
      {#each options as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    {/if}
  </select>
  {#if help}<div class="form-text">{help}</div>{/if}
</div>
