<script lang="ts">
  import { asset } from '$app/paths';
  import { scanner } from '$lib/state/scanner.svelte';
  import { session } from '$lib/state/session.svelte';
  import { settings } from '$lib/state/settings.svelte';
</script>

<!--
  The pickup desk's chrome: who is operating this station, the theme toggle, and the way out.
  The theme key is the same one the console writes, so a volunteer switching between the two
  screens on one tablet does not get two different themes.
-->
<header class="scanner-header">
  <div class="d-flex align-items-center">
    <img src={asset('/favicon.png')} width="32" height="32" class="me-2" alt="" />
  </div>

  <div class="d-flex gap-2 align-items-center">
    <button
      type="button"
      class="header-btn"
      title="Change operator"
      onclick={() => scanner.openOperatorDialog()}
    >
      <i class="bi bi-person-fill" aria-hidden="true"></i>
      <span>{scanner.operatorName || 'Set Name'}</span>
    </button>

    <button
      type="button"
      class="header-btn"
      title="Toggle theme"
      aria-label="Toggle theme"
      onclick={() => settings.toggleTheme()}
    >
      <i class="bi {settings.theme === 'dark' ? 'bi-sun-fill' : 'bi-moon-fill'}" aria-hidden="true"></i>
    </button>

    <button
      type="button"
      class="header-btn"
      title="Sign out"
      aria-label="Sign out"
      onclick={() => void session.signOut()}
    >
      <i class="bi bi-box-arrow-right" aria-hidden="true"></i>
    </button>
  </div>
</header>
