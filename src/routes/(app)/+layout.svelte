<script lang="ts">
  import type { Snippet } from 'svelte';
  import CelebrationCanvas from '$lib/components/present/CelebrationCanvas.svelte';
  import DelayOverlay from '$lib/components/present/DelayOverlay.svelte';
  import { ensureBooted } from '$lib/state/boot.svelte';
  import { settings } from '$lib/state/settings.svelte';

  let { children }: { children: Snippet } = $props();

  /**
   * Everything behind sign-in boots here — the public display, the scanner and the console all
   * need settings, data and a session. `/login` and `/conditions` sit outside this group
   * precisely so they never make an API call that could 401 and put the expiry overlay up on
   * the sign-in page itself.
   */
  const booted = ensureBooted();

  // Keep the CSS custom properties in step with the theme settings. This is a genuine side
  // effect on the document, which is what $effect is for — the values themselves are state.
  $effect(() => {
    void settings.current.primaryColor;
    void settings.current.secondaryColor;
    void settings.current.selectionColor;
    void settings.current.fontFamily;
    void settings.current.displayRatio;
    void settings.current.displayFontSize;
    settings.applyTheme();
  });
</script>

{#await booted}
  <div class="app-boot" role="status" aria-live="polite">
    <div class="spinner-border text-primary" aria-hidden="true"></div>
    <p class="mt-3 mb-0">Loading…</p>
  </div>
{:then}
  {@render children()}

  <!--
    Both overlays live in the shell rather than in the Present page, because both are driven from
    two screens: a real draw on /present, and the Setup screen's Preview Delay and Test
    Celebration buttons. Rendering them once here is what guarantees an operator previews exactly
    what the room will see — the old app had separate ad-hoc code paths for the two, and they had
    drifted apart.
  -->
  <DelayOverlay />
  <CelebrationCanvas />
{:catch error}
  <div class="app-boot">
    <div class="alert alert-danger" role="alert">
      <h5 class="alert-heading">The app could not start</h5>
      <p class="mb-2">{error instanceof Error ? error.message : String(error)}</p>
      <button type="button" class="btn btn-sm btn-outline-danger" onclick={() => location.reload()}>
        Try again
      </button>
    </div>
  </div>
{/await}
