<script lang="ts" generics="K extends keyof Settings">
  import { settings } from '$lib/state/settings.svelte';
  import type { Settings } from '$lib/types';
  import InfoTip from './InfoTip.svelte';

  interface Props {
    setting: K;
    label: string;
    min?: number;
    max?: number;
    step?: number;
    tooltip?: string;
    help?: string;
  }

  let { setting, label, min, max, step = 1, tooltip, help }: Props = $props();

  const id = $props.id();
  const value = $derived(settings.current[setting] as number);

  function change(event: Event & { currentTarget: HTMLInputElement }) {
    const parsed = Number.parseFloat(event.currentTarget.value);
    // An empty or unparseable box falls back to the low bound rather than writing NaN, which
    // would poison every comparison the draw makes against it.
    const next = Number.isFinite(parsed) ? parsed : (min ?? 0);
    const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? -Infinity, next));
    settings.set(setting, clamped as Settings[K]);
  }
</script>

<div class="mb-3">
  <label class="form-label" for={id}>
    {label}{#if tooltip}<InfoTip text={tooltip} />{/if}
  </label>
  <input {id} type="number" class="form-control" {min} {max} {step} {value} onchange={change} />
  {#if help}<div class="form-text">{help}</div>{/if}
</div>
