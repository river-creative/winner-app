<script lang="ts">
  import 'bootstrap/dist/css/bootstrap.min.css';
  import 'bootstrap-icons/font/bootstrap-icons.css';
  // Order matters and is documented in responsive.css's own header: every viewport-width rule
  // lives in responsive.css, and it loads last so it wins ties at equal specificity.
  import '../css/styles.css';
  import '../css/responsive.css';

  import type { Snippet } from 'svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import ProgressOverlay from '$lib/components/ProgressOverlay.svelte';
  import SessionExpiredOverlay from '$lib/components/SessionExpiredOverlay.svelte';
  import Toasts from '$lib/components/Toasts.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<!--
  Bootstrap's stylesheet stays; its JavaScript does not. Modals are native <dialog>s, the tab
  strip is real routing, and dropdowns are Svelte components — which is what let the two global
  monkeypatches the old page carried (a patched JSON.parse and a wrapped
  document.body.getAttribute) be deleted rather than ported.
-->
{@render children()}

<Toasts />
<ConfirmDialog />
<ProgressOverlay />
<SessionExpiredOverlay />
