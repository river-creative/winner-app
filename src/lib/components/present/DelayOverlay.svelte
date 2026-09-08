<script lang="ts">
  import { startDelayAnimation, type DelayAnimationType } from '$lib/services/animations';
  import { playBeep } from '$lib/services/sounds';
  import { draw } from '$lib/state/draw.svelte';
  import { preview } from '$lib/state/preview.svelte';
  import { settings } from '$lib/state/settings.svelte';

  /**
   * Every pre-selection delay visual, in one component.
   *
   * It is driven by two sources that must look identical to the room: a real draw
   * (`draw.phase === 'delaying'`) and the Setup screen's Preview Delay button
   * (`preview.delayVisual`). The old app had three separate code paths reaching into the DOM by
   * id, and two of them had drifted from what a real draw actually showed.
   *
   * Of the four simple `#delayOverlay` panes the old markup carried, only `.delay-spinner` is
   * rendered here. `.delay-countdown` (the spinning circle), `.delay-progress` and `.delay-dots`
   * were selected by `displayType` values — `spinner`, `progress`, `dots` — that no longer exist
   * in the `DelayVisualType` union, so wiring them up would add markup no setting can reach.
   */

  let canvas = $state<HTMLCanvasElement>();

  const previewVisual = $derived(preview.delayVisual);
  const drawing = $derived(draw.phase === 'delaying' || draw.phase === 'selecting');

  const visual = $derived(previewVisual ?? (drawing ? settings.current.delayVisualType : null));
  const remaining = $derived(previewVisual ? preview.remaining : draw.delayRemaining);

  /** Never shows 0: the old countdown hid itself on reaching zero rather than displaying it. */
  const tick = $derived(Math.max(1, Math.ceil(remaining)));

  const canvasType = $derived<DelayAnimationType | null>(
    visual === 'animation' ||
      visual === 'swirl-animation' ||
      visual === 'christmas-snow' ||
      visual === 'time-machine'
      ? visual
      : null
  );

  /**
   * The draw and the delay run concurrently, so the countdown can hit zero while the winners are
   * still being written. The room must not be left staring at a frozen "1" for the length of the
   * write — but it must not be shown a spinner either, unless something really is still running.
   *
   * That distinction is the store's to make, not this component's. It used to be inferred here
   * from `phase === 'delaying'` plus a locally tracked "the delay is over" flag, which is true
   * both a microtask before the reveal and five seconds into a slow write — so the spinner
   * appeared on every draw, measured at 1.8 s *after* the winners had been saved. `'selecting'`
   * means exactly one thing: the countdown is over and the write has not come back.
   */
  const waiting = $derived(previewVisual === null && draw.phase === 'selecting');

  /**
   * The countdown has run out, and nothing has replaced it yet — the 600 ms beat the end-of-delay
   * sting plays into. The stage stays empty for it on purpose.
   */
  const countdownFinished = $derived(previewVisual === null && draw.delayProgress >= 1);

  type Pane = 'hidden' | 'spinner' | 'countdown';

  /**
   * The operator's choice decides this, and nothing else.
   *
   * `prefers-reduced-motion` used to sit ahead of `visual` here and substitute a progress bar.
   * That flag belongs to whoever set it on the machine driving the projector; the room watching
   * never expressed it, and an operator who had picked "Time Machine" by name got a bar reading
   * "Finalizing selection…" with nothing to say why. Turning the show down is what the setting
   * itself is for — "No Visual (Silent)" is one of the six choices.
   */
  const pane = $derived<Pane>(
    !visual || visual === 'none' ? 'hidden' : waiting ? 'spinner' : countdownFinished ? 'hidden' : 'countdown'
  );

  // A beep on each decrement, matching the old countdown. `lastTick` is a plain `let` because
  // nothing renders from it.
  let lastTick = 0;

  $effect(() => {
    if (pane !== 'countdown' || visual !== 'countdown') {
      lastTick = 0;
      return;
    }
    const value = tick;
    // Silent on the first number shown, then one beep per second, exactly as before.
    if (lastTick !== 0 && value !== lastTick) playBeep();
    lastTick = value;
  });

  $effect(() => {
    const element = canvas;
    const type = canvasType;
    if (!element || !type) return;

    const animation = startDelayAnimation(element, type);
    // Cancels the frame loop, wipes the canvas and removes the animation's resize listener.
    return () => animation?.destroy();
  });
</script>

{#if pane === 'spinner'}
  <div class="delay-overlay" role="status">
    <div class="delay-content">
      <div class="delay-spinner">
        <div class="spinner-border text-light" style="width: 3rem; height: 3rem;" aria-hidden="true"></div>
        <div class="mt-3 text-light">Preparing winners…</div>
      </div>
    </div>
  </div>
{:else if pane === 'countdown'}
  <div class="countdown-animation" role="status">
    <!-- The number itself is hidden from assistive tech: announcing "5 4 3 2 1" adds nothing. -->
    <span class="visually-hidden">Selecting winners…</span>
    <div class="countdown-number" aria-hidden="true">{tick}</div>
    {#if canvasType}
      <canvas bind:this={canvas} id="countdownCanvas" aria-hidden="true"></canvas>
    {/if}
  </div>
{/if}
