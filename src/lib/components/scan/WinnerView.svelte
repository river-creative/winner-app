<script lang="ts">
  import { winnerInfoLines } from '$lib/services/winner-search';
  import { scanner } from '$lib/state/scanner.svelte';
  import { formatDateTime } from '$lib/utils/format';

  const winner = $derived(scanner.winner);
  const info = $derived(winner ? winnerInfoLines(winner) : { info2: '', info3: '' });
</script>

<div class="card winner-card-unified">
  <div class="card-body">
    <div class="winner-header-section">
      <h2 class="winner-name-title">{winner?.displayName || 'Unknown Winner'}</h2>

      <div class="winner-meta-info">
        <div class="winner-meta-item">
          <i class="bi bi-ticket-perforated" aria-hidden="true"></i>
          <span>Ticket: {winner?.entryId ?? ''}</span>
        </div>
        {#if info.info2}
          <div class="winner-meta-item">
            <i class="bi bi-building" aria-hidden="true"></i>
            <span>{info.info2}</span>
          </div>
        {/if}
        {#if info.info3}
          <div class="winner-meta-item">
            <i class="bi bi-telephone" aria-hidden="true"></i>
            <span>{info.info3}</span>
          </div>
        {/if}
      </div>
    </div>

    <hr class="my-4" />

    <div class="prizes-section">
      <h4 class="prizes-title mb-3">
        <i class="bi bi-gift-fill me-2" aria-hidden="true"></i>Prizes Won
      </h4>

      <div class="prizes-list">
        {#each scanner.prizes as prize, index (prize.winnerId)}
          <div class="prize-item-card" class:picked-up={prize.pickedUp}>
            <div class="prize-header">
              <h5 class="prize-name">{prize.prize}</h5>
              <div class="prize-status-badge">
                {#if prize.pickedUp}
                  <span class="badge bg-success">
                    <i class="bi bi-check-circle-fill" aria-hidden="true"></i> Picked Up
                  </span>
                {:else}
                  <span class="badge bg-warning">
                    <i class="bi bi-clock" aria-hidden="true"></i> Pending
                  </span>
                {/if}
              </div>
            </div>

            <div class="prize-meta">
              <div class="prize-meta-item">
                <i class="bi bi-calendar-event" aria-hidden="true"></i>
                Won: {formatDateTime(prize.timestamp)}
              </div>
              {#if prize.pickedUp && prize.pickupTimestamp}
                <div class="prize-meta-item">
                  <i class="bi bi-check-circle" aria-hidden="true"></i>
                  Picked up: {formatDateTime(prize.pickupTimestamp)}
                </div>
              {/if}
              {#if prize.pickedUp && prize.pickupStation}
                <div class="prize-meta-item">
                  <i class="bi bi-person-check" aria-hidden="true"></i>
                  Station: {prize.pickupStation}
                </div>
              {/if}
            </div>

            {#if !prize.pickedUp}
              <div class="prize-actions text-end">
                <button
                  type="button"
                  class="btn btn-sm pickup-btn"
                  onclick={() => void scanner.markPickedUp(index)}
                >
                  <i class="bi bi-check-circle me-2" aria-hidden="true"></i>Mark as Picked Up
                </button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <div class="card-footer-actions">
      <button type="button" class="btn btn-primary" onclick={() => scanner.backToScanner()}>
        <i class="bi bi-arrow-left" aria-hidden="true"></i>
        <span class="ms-2">Back</span>
      </button>
    </div>
  </div>
</div>
