<script lang="ts">
  import Dropdown from '$lib/components/Dropdown.svelte';
  import InfoTip from '$lib/components/InfoTip.svelte';
  import SettingCheck from '$lib/components/SettingCheck.svelte';
  import SettingNumber from '$lib/components/SettingNumber.svelte';
  import SettingSelect from '$lib/components/SettingSelect.svelte';
  import {
    CELEBRATION_EFFECTS,
    DELAY_VISUALS,
    DISPLAY_EFFECTS,
    SELECTION_MODES,
    type Option
  } from '$lib/constants/options';
  import { boot } from '$lib/state/boot.svelte';
  import { data } from '$lib/state/data.svelte';
  import { preview } from '$lib/state/preview.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import { setup } from '$lib/state/setup.svelte';
  import { formatNumber, pluralise } from '$lib/utils/format';

  /** `none` plus every built-in and uploaded sound, so a select can never offer a missing file. */
  const soundOptions = $derived<Option<string>[]>([
    { value: 'none', label: 'No Sound' },
    ...boot.sounds.map((sound) => ({ value: sound.id, label: sound.name }))
  ]);

  const eligibleLabel = $derived(
    setup.excludedCount > 0
      ? `${formatNumber(setup.eligibleEntries)} (${formatNumber(setup.excludedCount)} excluded)`
      : formatNumber(setup.eligibleEntries)
  );

  const stableGridApplies = $derived(
    settings.current.selectionMode === 'sequential' || settings.current.selectionMode === 'individual'
  );
</script>

<svelte:head><title>Setup · River Winner</title></svelte:head>

<h1 class="visually-hidden">Selection setup</h1>

<div class="card" style="overflow: visible;">
  <div class="card-body">
    <h5 class="card-title"><i class="bi bi-gear-fill me-2" aria-hidden="true"></i>Quick Selection Setup</h5>
    <p class="text-muted">Configure the next public winner selection from here.</p>

    <div class="row g-3">
      <!-- Lists -->
      <div class="col-md-5">
        <fieldset>
          <legend class="form-label h6">Select Lists</legend>

          <div class="list-checkboxes border rounded p-2" style="max-height: 200px; overflow-y: auto;">
            {#each data.lists as list (list.listId)}
              <div class="form-check">
                <input
                  class="form-check-input"
                  type="checkbox"
                  id="setup-list-{list.listId}"
                  checked={setup.isListSelected(list.listId)}
                  onchange={() => setup.toggleList(list.listId)}
                />
                <label class="form-check-label" for="setup-list-{list.listId}">
                  {list.metadata.name}
                  <span class="text-muted">({formatNumber(list.entries.length)})</span>
                </label>
              </div>
            {:else}
              <p class="text-muted mb-0">No lists uploaded yet</p>
            {/each}
          </div>

          <div class="d-flex flex-wrap align-items-center gap-2 mt-2">
            <button
              type="button"
              class="btn btn-sm btn-outline-primary"
              disabled={data.lists.length === 0}
              onclick={() => setup.selectAllLists()}
            >
              Select All
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              disabled={setup.validSelectedCount === 0}
              onclick={() => setup.clearSelectedLists()}
            >
              Clear All
            </button>
            <span class="text-muted">{setup.validSelectedCount} selected</span>
          </div>

          <small class="text-muted d-block mt-1">Eligible: {eligibleLabel}</small>
        </fieldset>
      </div>

      <!-- Prize -->
      <div class="col-md-5">
        <span class="form-label h6 d-block" id="setup-prize-label">Select Prize</span>

        <Dropdown
          buttonClass="btn btn-outline-secondary w-100 text-start"
          label=""
          align="start"
          menuClass="w-100"
          ariaLabel="Select prize"
        >
          {#snippet trigger()}
            {#if setup.selectedPrize}
              <span class="d-flex align-items-center gap-2 flex-wrap">
                <strong class="me-auto">{setup.selectedPrize.name}</strong>
                <span class="badge bg-secondary">{setup.selectedPrize.quantity} qty</span>
                {#if setup.selectedPrize.winnersCount}
                  <span class="badge bg-info">{setup.selectedPrize.winnersCount} win</span>
                {/if}
              </span>
            {:else}
              <span class="text-muted">Select Prize…</span>
            {/if}
          {/snippet}

          {#snippet children(close)}
            {#each data.prizes as prize (prize.prizeId)}
              <li>
                <button
                  type="button"
                  class="dropdown-item py-2"
                  class:active={setup.isPrizeSelected(prize.prizeId)}
                  role="menuitem"
                  onclick={() => {
                    setup.selectPrize(prize.prizeId);
                    close();
                  }}
                >
                  <span class="d-flex align-items-center gap-2 flex-wrap">
                    <strong class="me-auto">{prize.name}</strong>
                    <span class="badge bg-secondary">{prize.quantity} qty</span>
                    {#if prize.winnersCount}
                      <span class="badge bg-info">{prize.winnersCount} win</span>
                    {/if}
                  </span>
                  {#if prize.description}
                    <small class="d-block text-muted text-truncate">
                      {prize.description.split('\n')[0]}
                    </small>
                  {/if}
                </button>
              </li>
            {:else}
              <li><span class="dropdown-item-text text-muted text-center py-3">No prizes available</span></li>
            {/each}
          {/snippet}
        </Dropdown>

        {#if setup.selectedPrizeDefaultWinners > 0}
          <small class="text-muted d-block mt-1">
            Default: {setup.selectedPrizeDefaultWinners}
            {pluralise(setup.selectedPrizeDefaultWinners, 'winner')}
          </small>
        {/if}
      </div>

      <!-- Winner count -->
      <div class="col-md-2">
        <label class="form-label h6" for="setup-winners-count">Number of Winners</label>
        <input
          id="setup-winners-count"
          type="number"
          class="form-control"
          class:border-danger={setup.hasValidationWarning}
          class:text-danger={setup.hasValidationWarning}
          min="1"
          max="9999"
          placeholder="Count"
          value={setup.winnersCount}
          aria-describedby={setup.hasValidationWarning ? 'setup-winners-warning' : undefined}
          oninput={(event) => (setup.winnersCount = event.currentTarget.valueAsNumber)}
          onblur={() => setup.capWinnersCount()}
        />

        {#if setup.entriesExceeded}
          <small id="setup-winners-warning" class="text-danger d-block mt-1">
            {setup.eligibleEntries === 0
              ? 'No entries available'
              : `Only ${formatNumber(setup.eligibleEntries)} entries available${setup.excludedCount > 0 ? ` (${setup.excludedCount} excluded)` : ''}`}
          </small>
        {:else if setup.prizeQuantityExceeded}
          <small id="setup-winners-warning" class="text-danger d-block mt-1">
            Only {setup.selectedPrizeQuantity} prizes available
          </small>
        {/if}
      </div>
    </div>
  </div>
</div>

<div class="row g-3 mt-1">
  <!-- Reveal -->
  <div class="col-lg-6">
    <div class="card h-100">
      <div class="card-body">
        <h5 class="card-title">
          <i class="bi bi-eye-fill me-2" aria-hidden="true"></i>Reveal Settings
          <InfoTip text="Configure how winners are revealed" />
        </h5>

        <SettingSelect
          setting="selectionMode"
          label="Selection Mode"
          tooltip="How winners are selected and revealed"
          options={SELECTION_MODES}
        />
        <SettingSelect
          setting="displayEffect"
          label="Display Effect"
          tooltip="How winners appear on screen"
          options={DISPLAY_EFFECTS}
        />
        <SettingNumber
          setting="displayDuration"
          label="Time Between Winners (seconds)"
          min={0.1}
          max={5}
          step={0.1}
        />

        {#if stableGridApplies}
          <SettingCheck
            setting="stableGrid"
            label="Stable Grid"
            variant="switch"
            tooltip="Pre-position all cards to prevent the grid shifting during the reveal"
          />
        {/if}
      </div>
    </div>
  </div>

  <!-- Delay -->
  <div class="col-lg-6">
    <div class="card h-100">
      <div class="card-body">
        <h5 class="card-title">
          <i class="bi bi-clock-fill me-2" aria-hidden="true"></i>Delay Settings
          <InfoTip text="Configure pre-selection delay options" />
        </h5>

        <SettingNumber
          setting="preSelectionDelay"
          label="Delay Duration (seconds)"
          min={0}
          max={30}
          step={0.5}
        />
        <SettingSelect setting="delayVisualType" label="Delay Visual" options={DELAY_VISUALS} />

        <button
          type="button"
          class="btn btn-outline-secondary"
          disabled={preview.delayVisual !== null}
          onclick={() => void preview.runDelay()}
        >
          <i class="bi bi-eye me-2" aria-hidden="true"></i>Preview Delay
        </button>
      </div>
    </div>
  </div>
</div>

<div class="row g-3 mt-1 mb-4">
  <!-- Celebration -->
  <div class="col-lg-6">
    <div class="card h-100">
      <div class="card-body">
        <h5 class="card-title">
          <i class="bi bi-star-fill me-2" aria-hidden="true"></i>Celebration Effects
          <InfoTip text="Visual effects when winners are revealed" />
        </h5>

        <SettingSelect
          setting="celebrationEffect"
          label="Celebration Animation"
          options={CELEBRATION_EFFECTS}
        />
        <SettingNumber
          setting="celebrationDuration"
          label="Animation Duration (seconds)"
          min={1}
          max={10}
          step={0.5}
        />
        <SettingCheck
          setting="celebrationAutoTrigger"
          label="Auto-trigger celebration when winners are revealed"
        />

        <button type="button" class="btn btn-sm btn-outline-secondary" onclick={() => preview.celebrate()}>
          <i class="bi bi-play-fill me-2" aria-hidden="true"></i>Test Celebration
        </button>
      </div>
    </div>
  </div>

  <!-- Sound -->
  <div class="col-lg-6">
    <div class="card h-100">
      <div class="card-body">
        <h5 class="card-title">
          <i class="bi bi-volume-up-fill me-2" aria-hidden="true"></i>Sound Settings
          <InfoTip text="Sounds played around the draw" />
        </h5>

        {#each [{ setting: 'soundDuringDelay', label: 'Sound During Delay', tip: 'Sound effect played during the pre-selection delay' }, { setting: 'soundEndOfDelay', label: 'Sound at End of Delay', tip: 'Sound effect when the delay completes' }, { setting: 'soundDuringReveal', label: 'Sound During Reveal', tip: 'Sound effect when winners are revealed' }] as const as row (row.setting)}
          <div class="d-flex align-items-end gap-2">
            <div class="flex-grow-1 min-w-0">
              <SettingSelect
                setting={row.setting}
                label={row.label}
                tooltip={row.tip}
                options={soundOptions}
              />
            </div>
            <button
              type="button"
              class="btn btn-outline-secondary mb-3"
              aria-label="Test {row.label}"
              title="Test {row.label}"
              disabled={settings.current[row.setting] === 'none'}
              onclick={() => void preview.testSound(settings.current[row.setting])}
            >
              <i class="bi bi-play-fill" aria-hidden="true"></i>
            </button>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
