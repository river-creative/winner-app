<script lang="ts">
  import { goto } from '$app/navigation';
  import { base, resolve } from '$app/paths';
  import Dialog from '$lib/components/Dialog.svelte';
  import KeyboardShortcuts from '$lib/components/present/KeyboardShortcuts.svelte';
  import { sendSmsToWinners } from '$lib/services/texting';
  import { draw } from '$lib/state/draw.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import { setup } from '$lib/state/setup.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import type { SmsSendResults } from '$lib/types';
  import { formatNumber, pluralise, winnerCardLines } from '$lib/utils/format';

  /** The console, resolved once — both the Manage link and the `m`/`v` shortcuts go there. */
  const CONSOLE_PATH = resolve('/');

  const result = $derived(draw.result);
  const winners = $derived(result?.winners ?? []);
  const hasWinners = $derived(winners.length > 0);

  const revealed = $derived(winners.slice(0, draw.revealedCount));

  const mode = $derived(settings.current.selectionMode);
  const individual = $derived(mode === 'individual');

  /**
   * Pre-position the cards that have not been revealed yet.
   *
   * The grid picks its column count from how many `.winner-card` children it has, so a reveal
   * that adds them one at a time re-lays the whole grid on every card. The placeholders keep the
   * child count — and therefore the layout — fixed from the first card to the last. Only the two
   * staggered modes need it; `all-at-once` never reflows.
   */
  const stableGrid = $derived(
    settings.current.stableGrid && (mode === 'sequential' || mode === 'individual')
  );
  const placeholders = $derived(stableGrid ? winners.slice(draw.revealedCount) : []);

  const canRevealNext = $derived(
    individual && draw.phase === 'revealing' && draw.revealedCount < winners.length
  );

  const eligibleLabel = $derived(
    setup.excludedCount > 0
      ? `${formatNumber(setup.eligibleEntries)} (${formatNumber(setup.excludedCount)} excluded)`
      : formatNumber(setup.eligibleEntries)
  );

  let isFullscreen = $state(false);

  let smsResults = $state<SmsSendResults | null>(null);
  let smsResultsOpen = $state(false);
  const successRate = $derived(
    smsResults && smsResults.total > 0 ? Math.round((smsResults.sent / smsResults.total) * 100) : 0
  );

  /** The button's icon has to follow the real state: Escape and F11 leave fullscreen too. */
  $effect(() => {
    const sync = () => (isFullscreen = document.fullscreenElement !== null);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  });

  function startDraw(): void {
    if (draw.phase !== 'idle' || draw.busy || !setup.canStart) return;
    void draw.start();
  }

  function newSelection(): void {
    if (!draw.showingWinners) return;
    draw.reset();
  }

  function revealNext(): void {
    if (!canRevealNext) return;
    draw.revealNext();
  }

  async function undoLast(): Promise<void> {
    if (!draw.canUndo) {
      toasts.warning('There is nothing to undo.');
      return;
    }

    const confirmed = await ui.confirm({
      title: 'Undo last selection',
      message: 'This deletes the winners of the last draw and puts everything back as it was.',
      details: ['The prize quantity is restored.', 'Entries removed by the draw go back into their lists.'],
      confirmText: 'Undo',
      variant: 'danger'
    });
    if (confirmed) await draw.undo();
  }

  async function sendSms(): Promise<void> {
    if (!hasWinners || !result) {
      toasts.warning('There are no current winners to send messages to.');
      return;
    }

    // A single keystroke (`t`) reaches this, and a text message cannot be recalled — so it asks
    // first, and says plainly what it costs.
    const confirmed = await ui.confirm({
      title: 'Send SMS to winners',
      message: `Text all ${winners.length} ${pluralise(winners.length, 'winner')} of “${result.prize.name}”?`,
      details: ['Messages cannot be recalled.', 'The draw can no longer be undone afterwards.'],
      confirmText: 'Send messages',
      variant: 'warning'
    });
    if (!confirmed) return;

    const results = await sendSmsToWinners(winners);
    // `null` means the send was refused before it began; the toast already explained why.
    if (!results) return;

    smsResults = results;
    smsResultsOpen = true;

    if (results.sent > 0) {
      toasts.success(`Messages sent to ${results.sent} of ${results.total} winners.`);
    } else {
      toasts.error('No messages could be sent.');
    }
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      toasts.fromError(error, 'This browser would not switch to fullscreen.');
    }
  }

  function openConsole(): void {
    void goto(CONSOLE_PATH);
  }
</script>

<svelte:head><title>Winner Selection · River Winner</title></svelte:head>

<div class="public-selection-interface">
  <!-- The one heading for the screen. The visible "Winner Selection" title below is an <h2>
       because it disappears the moment the winners are on stage. -->
  <h1 class="visually-hidden">Winner selection</h1>

  <!-- The stage carries the themed background; the backdrop around it stays dark, which is what
       makes the letterbox bars read as bars. The letterboxing itself is pure CSS, keyed off the
       attributes settings.applyTheme() puts on <html>. -->
  <div class="display-stage" style={settings.displayStageStyle}>
    <div class="selection-header">
      <div class="d-flex align-items-center">
        <img src="{base}/favicon.png" width="40" height="40" alt="" class="me-2" />
      </div>

      {#if hasWinners && result}
        <div class="prize-display-header">
          <div class="prize-name-header">{result.prize.name}</div>
          <div class="prize-subtitle-header">
            {winners.length}
            {pluralise(winners.length, 'Winner')}
          </div>
        </div>
      {/if}

      <div class="d-flex gap-2">
        {#if canRevealNext}
          <button type="button" class="btn btn-outline-light" onclick={revealNext}>
            <i class="bi bi-forward-fill me-2" aria-hidden="true"></i>Reveal next
          </button>
        {/if}

        {#if draw.showingWinners}
          <button
            type="button"
            class="btn btn-outline-light"
            title="Start new selection"
            aria-label="Start new selection"
            onclick={newSelection}
          >
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
          </button>
        {/if}

        {#if draw.canUndo}
          <button
            type="button"
            class="btn btn-outline-warning"
            title="Undo last selection"
            aria-label="Undo last selection"
            onclick={() => void undoLast()}
          >
            <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
          </button>
        {/if}

        {#if hasWinners}
          <button
            type="button"
            class="btn btn-outline-success"
            title="Send SMS to current winners"
            aria-label="Send SMS to current winners"
            onclick={() => void sendSms()}
          >
            <i class="bi bi-envelope-fill" aria-hidden="true"></i>
          </button>
        {/if}

        <button
          type="button"
          class="btn btn-outline-light"
          title="Toggle fullscreen"
          aria-label={isFullscreen ? 'Leave fullscreen' : 'Enter fullscreen'}
          aria-pressed={isFullscreen}
          onclick={() => void toggleFullscreen()}
        >
          <i class="bi {isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}" aria-hidden="true"></i>
        </button>

        <a class="btn btn-outline-light" href={CONSOLE_PATH} title="Open management">
          <i class="bi bi-list-ul me-1" aria-hidden="true"></i>Manage
        </a>
      </div>
    </div>

    <!--
      Clicking anywhere on the stage advances a one-at-a-time reveal: the presenter is holding a
      clicker, not aiming at a button. It duplicates the "Reveal next" button in the header,
      which is focusable and keyboard-operable, so this element deliberately carries no keyboard
      handler and no interactive role of its own.
    -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="selection-main" onclick={revealNext}>
      {#if draw.error}
        <!--
          Outside the phase branches on purpose. Nested inside the idle branch — as it was in the
          partial rewrite — a draw that failed while `phase` was still moving showed an endless
          spinner and no message at all.

          The width mirrors `.selection-controls`, which is the block it sits above.
        -->
        <div class="alert alert-danger w-100 mb-3" role="alert" style="max-width: 800px; text-align: left;">
          <strong>The draw failed.</strong>
          <span class="d-block small">{draw.error}</span>
        </div>
      {/if}

      {#if draw.phase === 'idle'}
        <div class="selection-controls">
          <h2 class="selection-title">Winner Selection</h2>
          <p class="selection-subtitle">Get ready for the big moment!</p>

          <div class="selection-info">
            <div class="info-card">
              <div class="info-label">Current List</div>
              <div class="info-value">{setup.listDisplayText}</div>
            </div>

            {#if !settings.current.hideEntryCounts}
              <div class="info-card">
                <div class="info-label">Eligible Entries</div>
                <div class="info-value">{eligibleLabel}</div>
              </div>
            {/if}

            <div class="info-card">
              <div class="info-label">Winners to Select</div>
              <div class="info-value" class:text-danger={setup.hasValidationWarning}>
                {formatNumber(setup.winnersCount)}
              </div>
            </div>

            <div class="info-card">
              <div class="info-label">Prize</div>
              <div class="info-value">{setup.prizeDisplayText}</div>
            </div>
          </div>

          <button
            type="button"
            class="big-play-button"
            aria-label="Start the selection"
            disabled={!setup.canStart || draw.busy}
            onclick={startDraw}
          >
            <i class="bi bi-play-fill" aria-hidden="true"></i>
          </button>
        </div>
      {:else if draw.showingWinners}
        <!--
          Column count and font sizes come entirely from the `:has(.winner-card:nth-child(…))`
          ladders in styles.css (re-derived for phone widths in responsive.css). Rendering the
          right number of children is the whole contract — nothing here sets a width or a size.
        -->
        <div class="winners-grid" role="list" aria-label="Winners">
          {#each revealed as winner (winner.winnerId)}
            {@const lines = winnerCardLines(winner, result?.infoConfig)}
            <div class="winner-card {settings.current.displayEffect}" role="listitem">
              <div class="winner-number">{winner.position}</div>
              {#if lines[0]}<div class="winner-info1">{lines[0]}</div>{/if}
              {#if lines[1]}<div class="winner-info2">{lines[1]}</div>{/if}
              {#if lines[2]}<div class="winner-info3">{lines[2]}</div>{/if}
            </div>
          {/each}

          {#each placeholders as winner (winner.winnerId)}
            <div class="winner-card winner-card-placeholder" aria-hidden="true"></div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <KeyboardShortcuts
    onplay={startDraw}
    ontext={() => void sendSms()}
    onundo={() => void undoLast()}
    onfullscreen={() => void toggleFullscreen()}
    onnew={newSelection}
    onmanage={openConsole}
  />
</div>

<Dialog bind:open={smsResultsOpen} title="Message results" size="modal-lg">
  {#if smsResults}
    <div class="row text-center g-3 mb-3">
      <div class="col-4">
        <div class="h3 mb-0">{successRate}%</div>
        <small class="text-muted">Success rate</small>
      </div>
      <div class="col-4">
        <div class="h3 mb-0 text-success">{smsResults.sent}</div>
        <small class="text-muted">Sent</small>
      </div>
      <div class="col-4">
        <div class="h3 mb-0 text-danger">{smsResults.failed.length}</div>
        <small class="text-muted">Failed</small>
      </div>
    </div>

    {#if smsResults.failed.length > 0}
      <h6 class="mb-2">Not sent</h6>
      <ul class="list-group">
        {#each smsResults.failed as failure (failure.winner.winnerId)}
          <li class="list-group-item d-flex flex-wrap justify-content-between gap-2">
            <span class="text-truncate">{failure.winner.displayName}</span>
            <span class="text-danger small">{failure.error}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-muted mb-0">Every winner was sent a message.</p>
    {/if}
  {/if}

  {#snippet footer()}
    <button type="button" class="btn btn-secondary" onclick={() => (smsResultsOpen = false)}> Close </button>
  {/snippet}
</Dialog>
