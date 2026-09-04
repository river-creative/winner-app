<!--
  The rules card shown on the venue screens and handed out as a link.

  Static: no script, no state, and — like /login — outside the `(app)` group, so it never makes
  an API call. Anyone with the link can open it, including people who are not signed in.
-->
<svelte:head><title>Prize Win &amp; Claim Requirements</title></svelte:head>

<div class="conditions-page">
  <div class="conditions-card">
    <div class="conditions-header">
      <h1>🏆 Prize Winner</h1>
      <div class="subtitle">Claim Requirements &amp; Rules</div>
    </div>

    <div class="conditions-content">
      <div class="requirements-box">
        <h2 class="requirements-title">To Claim Your Prize</h2>

        <div class="requirement-item">
          <span class="requirement-icon" aria-hidden="true">📍</span>
          <div class="requirement-text">
            Winners must be <strong>physically present on the property</strong> at the time of the announcement
            to claim their gift.
          </div>
        </div>

        <div class="requirement-item">
          <span class="requirement-icon" aria-hidden="true">🎫</span>
          <div class="requirement-text">
            The <strong>winning wristband number must match</strong> the code drawn.
          </div>
        </div>

        <div class="requirement-item">
          <span class="requirement-icon" aria-hidden="true">⏱️</span>
          <div class="requirement-text">
            Winners have <span class="timer-highlight">60 SECONDS</span> from the time their number is called to
            present themselves.
          </div>
        </div>
      </div>

      <div class="warning-box">
        <span class="warning-icon" aria-hidden="true">⚠️</span>
        <div class="warning-text">
          Failure to meet these requirements will result in forfeiture of the prize.
        </div>
      </div>
    </div>
  </div>
</div>
