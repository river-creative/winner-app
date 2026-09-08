<script lang="ts">
  import { untrack } from 'svelte';
  import { createCelebrationAnimator, type CelebrationAnimator } from '$lib/services/animations';
  import { draw } from '$lib/state/draw.svelte';
  import { preview } from '$lib/state/preview.svelte';
  import { settings } from '$lib/state/settings.svelte';

  let canvas = $state<HTMLCanvasElement>();

  /**
   * Deliberately a plain `let`, not `$state`.
   *
   * The animator owns the confetti and coin arrays and rewrites them sixty times a second.
   * Nothing in this component's markup reads them, so making any of it reactive would push
   * thousands of per-frame writes through the reactivity graph for no rendered benefit — which
   * is exactly the frame-rate cost the canvas exists to avoid. The particle arrays themselves
   * live in `$lib/services/animations`, a plain `.ts` module where runes are not even available.
   */
  let animator: CelebrationAnimator | null = null;

  const wantsCoins = $derived(
    settings.current.celebrationEffect === 'coins' || settings.current.celebrationEffect === 'both'
  );

  /**
   * Empty when nothing should be celebrating; otherwise a key that is unique to the draw whose
   * winners are on screen, so one draw fires exactly one celebration.
   */
  const autoKey = $derived(
    settings.current.celebrationAutoTrigger && draw.showingWinners && draw.result ? draw.result.historyId : ''
  );

  // Seeded from the current values so neither trigger fires merely because the component mounted:
  // arriving at /present with winners already on screen must not replay their celebration.
  let lastPreviewToken = preview.celebrationToken;
  let lastAutoKey = untrack(() => autoKey);
  let lastRevealedCount = draw.revealedCount;

  $effect(() => {
    const element = canvas;
    if (!element) return;

    animator = createCelebrationAnimator(element);
    return () => {
      // Cancels the frame loop, drops every particle, wipes the canvas and removes the resize
      // listener the animator registered.
      animator?.destroy();
      animator = null;
    };
  });

  /** Confetti: once per draw, or on demand from the Setup screen's Test Celebration button. */
  $effect(() => {
    const token = preview.celebrationToken;
    const key = autoKey;

    const fromPreview = token !== lastPreviewToken;
    const fromDraw = key !== '' && key !== lastAutoKey;
    lastPreviewToken = token;
    lastAutoKey = key;

    if (!fromPreview && !fromDraw) return;
    untrack(() => celebrate(fromPreview));
  });

  /**
   * Coins: one burst per winner card as it appears, which is what makes them read as coming *out
   * of* the card rather than off the top of the screen.
   */
  $effect(() => {
    const revealed = draw.revealedCount;
    const enabled = settings.current.celebrationAutoTrigger && wantsCoins && draw.showingWinners;

    const previous = lastRevealedCount;
    lastRevealedCount = revealed;

    if (!enabled || revealed <= previous) return;

    untrack(() => {
      // Queried once, not once per card: an `all-at-once` reveal of a hundred winners arrives as
      // a single step.
      const cards = document.querySelectorAll<HTMLElement>(
        '.winners-grid .winner-card:not(.winner-card-placeholder)'
      );
      for (let index = previous; index < revealed; index++) burstFromCard(cards[index]);
    });
  });

  function celebrate(fromPreview: boolean): void {
    // Whether a celebration plays is `celebrationEffect` ("No Animation" turns it off) and
    // `celebrationAutoTrigger`, both set per event. `prefers-reduced-motion` used to veto it
    // regardless: a flag on the machine driving the projector, silently overruling the show the
    // operator configured for a room that never set it.
    const target = animator;
    if (!target) return;

    // A new draw replaces the previous celebration rather than layering on top of it.
    target.clear();

    const effect = settings.current.celebrationEffect;
    if (effect === 'none') return;

    if (effect === 'confetti' || effect === 'both') {
      target.confetti(Math.max(0, settings.current.celebrationDuration) * 1000);
    }

    // The preview has no winner cards to burst from, so it fires one from the centre instead —
    // otherwise "Test Celebration" would look broken for the coins-only setting.
    if (fromPreview && (effect === 'coins' || effect === 'both')) {
      target.coins(window.innerWidth / 2, window.innerHeight / 2);
    }
  }

  /**
   * This canvas lives in the app shell and the cards live in the Present page, so their geometry
   * is read from the DOM rather than passed as a prop. Measured inside the effect — that is,
   * after the DOM update that added the card — and falling back to the centre of the screen when
   * there is nothing to measure.
   */
  function burstFromCard(card: HTMLElement | undefined): void {
    const target = animator;
    if (!target) return;

    const rect = card?.getBoundingClientRect();

    if (rect && rect.width > 0) {
      target.coins(rect.left + rect.width / 2, rect.top + rect.height / 2);
    } else {
      target.coins(window.innerWidth / 2, window.innerHeight / 2);
    }
  }
</script>

<!--
  Positioned entirely by the existing `#animationCanvas` rules (fixed, full viewport,
  pointer-events: none). The id is load-bearing — both styles.css and responsive.css target it.
-->
<canvas bind:this={canvas} id="animationCanvas" aria-hidden="true"></canvas>
