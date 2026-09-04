<script lang="ts">
  import { untrack } from 'svelte';
  import OperatorDialog from '$lib/components/scan/OperatorDialog.svelte';
  import ScanAlertDialog from '$lib/components/scan/ScanAlertDialog.svelte';
  import ScannerHeader from '$lib/components/scan/ScannerHeader.svelte';
  import ScannerView from '$lib/components/scan/ScannerView.svelte';
  import SearchResultsView from '$lib/components/scan/SearchResultsView.svelte';
  import WinnerView from '$lib/components/scan/WinnerView.svelte';
  import { scanner } from '$lib/state/scanner.svelte';

  /**
   * The store is a module singleton, so a second visit has to be told to forget the first.
   * Everything here is untracked: this runs once, on mount, and must not re-run when the state
   * it just wrote changes. The camera itself is started by ScannerView, which owns the `<video>`.
   */
  $effect(() => {
    untrack(() => {
      scanner.reset();
      if (!scanner.operatorName) scanner.openOperatorDialog();
    });
  });
</script>

<svelte:head><title>Prize Pickup Scanner · River Winner</title></svelte:head>

<ScannerHeader />

<main class="container scanner-container">
  <h1 class="visually-hidden">Prize pickup scanner</h1>

  <!--
    All three views stay mounted and are toggled with `hidden` rather than `{#if}`.

    That is not a style choice: the `<video>` element owns the camera, and destroying it every
    time a result comes up would tear the stream down and rebuild it on the way back — slow on a
    phone, and it drops the engine selection (including the native self-test) each round trip.
    Bootstrap's reboot carries `[hidden] { display: none !important }`, so this holds even
    against the display utilities inside.
  -->
  <div hidden={scanner.view !== 'scanner'}>
    <ScannerView />
  </div>

  <div hidden={scanner.view !== 'results'}>
    <SearchResultsView />
  </div>

  <div hidden={scanner.view !== 'winner'}>
    <WinnerView />
  </div>
</main>

{#if scanner.noWinnerOpen}
  <ScanAlertDialog
    title="No Winner Found"
    message="This QR code doesn't match any winner in our records."
    variant="error"
    icon="bi-exclamation-circle"
    detail="Ticket Code: {scanner.noWinnerTicketCode}"
    onclose={() => scanner.backToScanner()}
  />
{/if}

{#if scanner.noResultsOpen}
  <ScanAlertDialog
    title="No Results Found"
    message="No winners found matching your search."
    variant="search"
    icon="bi-search"
    detail={`Search: "${scanner.searchTerm}"`}
    onclose={() => scanner.backToScanner()}
  />
{/if}

{#if scanner.operatorOpen}
  <OperatorDialog />
{/if}
