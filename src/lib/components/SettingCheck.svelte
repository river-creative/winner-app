<script lang="ts" generics="K extends keyof Settings">
  import { settings } from '$lib/state/settings.svelte';
  import type { Settings } from '$lib/types';
  import InfoTip from './InfoTip.svelte';

  interface Props {
    setting: K;
    label: string;
    tooltip?: string;
    help?: string;
    /** Render as a switch rather than a checkbox. */
    variant?: 'checkbox' | 'switch';
  }

  let { setting, label, tooltip, help, variant = 'checkbox' }: Props = $props();

  const id = $props.id();
  const checked = $derived(settings.current[setting] as boolean);
</script>

<div class="mb-3">
  <div class="form-check" class:form-switch={variant === 'switch'}>
    <input
      {id}
      class="form-check-input"
      type="checkbox"
      role={variant === 'switch' ? 'switch' : undefined}
      {checked}
      onchange={(event) => settings.set(setting, event.currentTarget.checked as Settings[K])}
    />
    <label class="form-check-label" for={id}>
      {label}{#if tooltip}<InfoTip text={tooltip} />{/if}
    </label>
  </div>
  {#if help}<div class="form-text">{help}</div>{/if}
</div>
