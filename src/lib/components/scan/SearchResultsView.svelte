<script lang="ts">
  import SearchInput from './SearchInput.svelte';
  import { winnerInfoLines } from '$lib/services/winner-search';
  import { scanner } from '$lib/state/scanner.svelte';
</script>

<div class="card search-results-card">
  <div class="card-body">
    {#if scanner.isFamilySearch}
      <!--
        The scanned card belongs to someone who did not win, but a relative did. Saying both —
        who won, and that the scanned card itself is not a winner — is what stops a volunteer
        re-scanning the same card looking for a prize that was never on it.
      -->
      <div class="text-center mb-3">
        <div class="alert alert-info py-2 mb-2">
          <i class="bi bi-people-fill me-2" aria-hidden="true"></i>
          <strong>Family Members Who Won</strong>
        </div>
        <p class="text-muted small mb-0">
          Scanned: <code>{scanner.scannedIdCard}</code> (not a winner)
        </p>
      </div>
    {:else}
      <h5 class="card-title mb-3 text-center">Search Results</h5>
    {/if}

    <p class="text-muted text-center mb-3">
      Found {scanner.searchResults.length}
      {scanner.isFamilySearch ? 'family member(s) who won' : 'winner(s)'}
    </p>

    <div class="search-results-list">
      {#each scanner.searchResults as result, index (result.winner.entryId)}
        {@const info = winnerInfoLines(result.winner)}
        <!--
          A real <button>, not the old clickable <div>: this is the only way into a winner's
          prizes, and it has to be reachable from a keyboard and announced as an action.
        -->
        <button type="button" class="search-result-card" onclick={() => scanner.selectResult(index)}>
          <span class="search-result-name d-block">{result.winner.displayName || 'Unknown'}</span>

          <span class="search-result-meta d-block">
            <span class="me-3">
              <i class="bi bi-gift" aria-hidden="true"></i>
              {result.prizeCount} prize(s)
            </span>
            {#if result.pendingCount > 0}
              <span class="text-warning me-2">
                <i class="bi bi-clock" aria-hidden="true"></i>
                {result.pendingCount} pending
              </span>
            {/if}
            {#if result.prizeCount - result.pendingCount > 0}
              <span class="text-success">
                <i class="bi bi-check-circle" aria-hidden="true"></i>
                {result.prizeCount - result.pendingCount} picked up
              </span>
            {/if}
          </span>

          {#if info.info2}
            <span class="search-result-extra text-muted small d-block">
              <i class="bi bi-building" aria-hidden="true"></i>
              {info.info2}
            </span>
          {/if}
        </button>
      {:else}
        <p class="no-results-message">
          <i class="bi bi-search" aria-hidden="true"></i>
          Nothing to show here.
        </p>
      {/each}
    </div>

    {#if !scanner.isFamilySearch}
      <div>
        <p class="text-muted small mb-2 mt-3">Refine search</p>
        <SearchInput
          bind:value={scanner.searchInput}
          label="Refine the winner search"
          placeholder="Refine search"
          disabled={scanner.searching}
          onsearch={() => void scanner.performSearch()}
        />
      </div>
    {/if}

    <div class="card-footer-actions">
      <button type="button" class="btn btn-primary" onclick={() => scanner.backToScanner()}>
        <i class="bi bi-arrow-left" aria-hidden="true"></i>
        <span class="ms-2">Back</span>
      </button>
    </div>
  </div>
</div>
