<script lang="ts">
  import { untrack } from 'svelte';
  import SearchInput from './SearchInput.svelte';
  import { scanner } from '$lib/state/scanner.svelte';

  let videoElement = $state<HTMLVideoElement>();

  /**
   * The camera's lifetime is this element's lifetime.
   *
   * Tying the two together is what makes the release correct by construction: the engine can
   * never be started without a `<video>` to draw into, and can never outlive one — including on
   * a navigation away mid-scan, which is when the old page used to leave the camera light on.
   * `untrack` keeps the effect from re-running (and restarting the camera) on unrelated changes.
   */
  $effect(() => {
    const element = videoElement;
    if (!element) return;

    scanner.attachVideo(element);
    untrack(() => void scanner.start());

    return () => {
      scanner.deactivate();
      scanner.attachVideo(null);
    };
  });
</script>

<div class="card">
  <div class="card-body text-center">
    <!--
      Shown only on the pure-JS tier. It is a real degradation — the JS binarizer struggles in
      the low light a pickup desk usually has — so it is announced, not just drawn.
    -->
    {#if scanner.engineName === 'js'}
      <div class="mb-3">
        <div
          class="alert alert-warning d-flex align-items-center text-start gap-2 py-2 mb-0"
          role="status"
          aria-live="polite"
        >
          <i class="bi bi-exclamation-triangle-fill flex-shrink-0" aria-hidden="true"></i>
          <span class="small">
            This device doesn't support the enhanced scanner. Using the basic scanner — low-light scanning may
            be limited.
            {#if scanner.engineReason}
              <span class="text-muted d-block mt-1" style="font-size: 0.7rem;">
                Reason: {scanner.engineReason}
              </span>
            {/if}
          </span>
        </div>
      </div>
    {/if}

    <h5 class="card-title mb-3">Scan QR Code</h5>

    <div class="qr-video-container mb-3">
      <!-- `muted` is set from scan-engines.ts rather than here, because it is the autoplay-policy
           workaround that belongs with the `play()` call it exists for. -->
      <video bind:this={videoElement} id="qr-video"></video>
    </div>

    <div class="scan-status" role="status" aria-live="polite">{scanner.scanStatus}</div>

    <div class="scanner-controls">
      {#if scanner.isScanning}
        <button type="button" class="btn btn-danger btn-lg" onclick={() => scanner.stop()}>
          <i class="bi bi-stop-circle" aria-hidden="true"></i> Stop Scanner
        </button>
      {:else}
        <button
          type="button"
          class="btn btn-primary btn-lg"
          disabled={scanner.isStarting}
          onclick={() => void scanner.start()}
        >
          {#if scanner.isStarting}
            <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
            <span>Starting…</span>
          {:else}
            <i class="bi bi-camera" aria-hidden="true"></i>
            <span> Start Scanner</span>
          {/if}
        </button>
      {/if}
    </div>

    <div class="mt-4 search-manual">
      <p class="text-muted">Or search manually:</p>
      <SearchInput
        bind:value={scanner.searchInput}
        label="Ticket code or winner name"
        placeholder="Enter ticket code or winner name"
        disabled={scanner.searching}
        onsearch={() => void scanner.performSearch()}
      />
    </div>
  </div>
</div>
