<script lang="ts">
  import * as api from '$lib/api/client';
  import InfoTip from '$lib/components/InfoTip.svelte';
  import SettingCheck from '$lib/components/SettingCheck.svelte';
  import SettingSelect from '$lib/components/SettingSelect.svelte';
  import {
    BACKGROUND_TYPES,
    DISPLAY_FONT_SIZES,
    DISPLAY_RATIO_GROUPS,
    FONT_FAMILIES,
    type Option
  } from '$lib/constants/options';
  import { boot, refreshSounds } from '$lib/state/boot.svelte';
  import { preview } from '$lib/state/preview.svelte';
  import { settings, THEME_PRESETS } from '$lib/state/settings.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import type { SoundOption } from '$lib/services/sounds';
  import type { BackgroundType } from '$lib/types';

  // `as const` gives a readonly tuple, which is not assignable to the mutable option array the
  // select expects. Copied once here rather than spread inline on every render.
  const backgroundTypeOptions: Option<BackgroundType>[] = [...BACKGROUND_TYPES];

  const colorFields: Array<{
    setting: 'primaryColor' | 'secondaryColor' | 'selectionColor';
    label: string;
  }> = [
    { setting: 'primaryColor', label: 'Primary' },
    { setting: 'secondaryColor', label: 'Secondary' },
    { setting: 'selectionColor', label: 'Selection' }
  ];

  /** The three settings that name a sound file, so a deleted file can be cleared out of them. */
  const SOUND_SETTINGS = ['soundDuringDelay', 'soundEndOfDelay', 'soundDuringReveal'] as const;

  // -------------------------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------------------------

  let webhookError = $state<string | null>(null);

  /**
   * The check `validation.js` shipped and nothing ever called.
   *
   * Without it an operator could save `example.com/hook`, and only discover at draw time that
   * nothing was ever delivered — webhook failures are swallowed on purpose so they cannot
   * interrupt a live selection, which is exactly why the URL has to be right before it is saved.
   */
  function webhookProblem(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null; // Empty is how "no webhook configured" is expressed.

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return 'Enter a full URL, including https://';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'The URL must use http or https.';
    }
    return null;
  }

  function commitWebhookUrl(event: Event & { currentTarget: HTMLInputElement }) {
    const problem = webhookProblem(event.currentTarget.value);
    webhookError = problem;
    // Refuse to save. The box keeps what was typed, so it can be corrected rather than retyped.
    if (problem) return;
    settings.set('webhookUrl', event.currentTarget.value.trim());
  }

  /** Clear a standing error as soon as it stops being true, but never raise one mid-word. */
  function relaxWebhookError(event: Event & { currentTarget: HTMLInputElement }) {
    if (webhookError && !webhookProblem(event.currentTarget.value)) webhookError = null;
  }

  // Switching the webhook off removes the box the error describes. Leaving it set would flag
  // the field as invalid the moment it comes back, showing what the *saved* value is not.
  $effect(() => {
    if (!settings.current.enableWebhook) webhookError = null;
  });

  // -------------------------------------------------------------------------------------------
  // Sound files
  // -------------------------------------------------------------------------------------------

  let soundInput = $state<HTMLInputElement>();
  let uploadingSounds = $state(false);

  /**
   * Uploads land in `data/uploads` — the persisted volume — so they survive a deploy.
   *
   * The button this replaces never uploaded anything: it triggered a *download* of the chosen
   * file to the operator's own machine along with a note asking them to copy it into
   * `public/sounds` in the source tree, then wrote metadata to a `sounds` collection the backend
   * does not whitelist, so even that write was rejected. No sound an operator picked ever
   * reached the server.
   */
  async function handleSoundFiles(event: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(event.currentTarget.files ?? [])];
    // Reset first: without it, re-picking the same file after a failure fires no change event.
    event.currentTarget.value = '';
    if (files.length === 0) return;

    uploadingSounds = true;
    let uploaded = 0;
    try {
      // Sequential: each upload rewrites the uploads directory listing the next one reads.
      for (const file of files) {
        await api.uploadSound(file);
        uploaded += 1;
      }
      toasts.success(uploaded === 1 ? 'Sound uploaded' : `${uploaded} sounds uploaded`);
    } catch (error) {
      toasts.fromError(error, 'Could not upload the sound file.');
    } finally {
      // A partial batch still changed the list, so this runs whether or not the loop finished.
      if (uploaded > 0) await refreshSounds().catch(() => undefined);
      uploadingSounds = false;
    }
  }

  async function deleteSound(sound: SoundOption) {
    const confirmed = await ui.confirm({
      title: 'Delete sound file',
      message: `Delete “${sound.name}”? This removes the file from the server for everyone.`,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      // The uploaded sound's id is its filename — see loadSounds() in services/sounds.ts.
      await api.deleteUploadedSound(sound.id);

      // A setting still naming a deleted file renders as a blank <select> and silently plays
      // nothing mid-draw, so the reference goes with the file.
      for (const key of SOUND_SETTINGS) {
        if (settings.current[key] === sound.id) settings.set(key, 'none');
      }

      await refreshSounds();
      toasts.success('Sound deleted');
    } catch (error) {
      toasts.fromError(error, 'Could not delete the sound file.');
    }
  }

  // -------------------------------------------------------------------------------------------
  // Background images
  // -------------------------------------------------------------------------------------------

  let images = $state<api.UploadedImage[]>([]);
  let imagesLoading = $state(false);
  let imagesError = $state<string | null>(null);
  let imageMode = $state<'existing' | 'upload'>('existing');
  let uploadingImage = $state(false);

  /** Not reactive: a one-shot guard so the effect below fetches once, not on every read. */
  let imagesRequested = false;

  async function loadImages() {
    imagesLoading = true;
    imagesError = null;
    try {
      images = await api.getUploadedImages();
    } catch (error) {
      // A failed load must not render as "no images uploaded yet".
      imagesError = error instanceof Error ? error.message : 'Could not load the uploaded images.';
    } finally {
      imagesLoading = false;
    }
  }

  // Fetching the gallery is a side effect, and it is only worth paying for once the operator
  // actually chooses an image background.
  $effect(() => {
    if (settings.current.backgroundType !== 'image' || imagesRequested) return;
    imagesRequested = true;
    void loadImages();
  });

  /**
   * Stored relative, always.
   *
   * The server answers with an absolute `/uploads/x.png`, which resolves against the host root
   * and so points at nothing under the `/win` mount. `uploadUrl()` reduces any stored path or
   * bare filename to `./uploads/x.png`.
   */
  function selectImage(pathOrUrl: string) {
    settings.set('customBackgroundImage', api.uploadUrl(pathOrUrl));
  }

  /** Compare by filename, so records the old app wrote as absolute paths still match. */
  function isSelectedImage(image: api.UploadedImage): boolean {
    const current = settings.current.customBackgroundImage;
    return current !== null && api.uploadUrl(current) === api.uploadUrl(image.path);
  }

  async function handleImageFile(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    uploadingImage = true;
    try {
      const imagePath = await api.uploadBackgroundImage(file);
      selectImage(imagePath);
      await loadImages();
      // Show the operator the image they just picked, in context with the rest.
      imageMode = 'existing';
      toasts.success('Background image uploaded and applied');
    } catch (error) {
      toasts.fromError(error, 'Could not upload the background image.');
    } finally {
      uploadingImage = false;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------------------------

  async function resetToDefaults() {
    const confirmed = await ui.confirm({
      title: 'Reset settings',
      message: 'Put every setting back to its default? Lists, prizes and winners are not touched.',
      details: [
        'Theme colours, fonts and the display ratio',
        'Reveal, delay, sound and celebration settings',
        'The webhook URL and the duplicate rules'
      ],
      confirmText: 'Reset',
      variant: 'danger'
    });
    if (!confirmed) return;

    settings.reset();
    webhookError = null;
    toasts.success('Settings reset to defaults');
  }
</script>

<svelte:head><title>Settings · River Winner</title></svelte:head>

<h1 class="visually-hidden">Settings</h1>

<div class="d-flex flex-wrap justify-content-end align-items-center gap-3 mt-3 mb-2">
  <span class="text-muted small d-inline-flex align-items-center gap-2" role="status" aria-live="polite">
    {#if settings.saving}
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>Saving…
    {:else}
      <i class="bi bi-check-circle text-success" aria-hidden="true"></i>Saved
    {/if}
  </span>

  <button type="button" class="btn btn-sm btn-outline-danger" onclick={() => void resetToDefaults()}>
    <i class="bi bi-arrow-counterclockwise me-2" aria-hidden="true"></i>Reset to defaults
  </button>
</div>

<div class="row">
  <!-- ------------------------------------------------------------------ Left column -->
  <div class="col-lg-6">
    <div class="card">
      <div class="card-body">
        <h2 class="card-title h5">General Settings</h2>

        <SettingCheck
          setting="preventDuplicates"
          label="Remove winners from source list"
          tooltip="Prevent the same person from winning multiple times"
        />
        <SettingCheck
          setting="preventSamePrize"
          label="Prevent winning same prize twice"
          tooltip="Winners cannot win the same prize multiple times"
        />
        <!--
          A default, not a rule: each list stores its own copy from the moment it is imported and
          is edited through the gear on its card. It has to live here all the same — the import
          wizard used to be the only thing that wrote it, so without this control the value a new
          list starts from would be unreachable.
        -->
        <SettingCheck
          setting="skipExistingWinners"
          label="Skip existing winners by default"
          tooltip="The starting value for new lists: records that have already won are not added. Each list can override this in its own settings."
        />
        <SettingCheck
          setting="hideEntryCounts"
          label="Hide Entry Counts"
          tooltip="Hide the number of participants in public view"
        />
        <SettingCheck setting="enableDebugLogs" label="Enable Debug Logs" />
      </div>
    </div>

    <div class="card mt-3">
      <div class="card-body">
        <h2 class="card-title h5">Webhook Settings</h2>

        <SettingCheck
          setting="enableWebhook"
          label="Enable Webhook Notifications"
          tooltip="Send HTTP POST requests when winners are selected"
        />

        {#if settings.current.enableWebhook}
          <div class="mb-3">
            <label class="form-label" for="settings-webhook-url">
              Webhook URL
              <InfoTip text="URL where winner selection notifications will be sent via POST request" />
            </label>
            <input
              id="settings-webhook-url"
              type="url"
              class="form-control"
              class:is-invalid={webhookError !== null}
              placeholder="https://example.com/webhook"
              value={settings.current.webhookUrl}
              aria-invalid={webhookError !== null}
              aria-describedby="settings-webhook-help{webhookError ? ' settings-webhook-error' : ''}"
              oninput={relaxWebhookError}
              onchange={commitWebhookUrl}
            />
            {#if webhookError}
              <div id="settings-webhook-error" class="invalid-feedback d-block">
                {webhookError}
              </div>
            {/if}
            <div id="settings-webhook-help" class="form-text">
              Winners data will be sent as JSON in the request body
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div class="card mt-3">
      <div class="card-body">
        <h2 class="card-title h5">Sound Files</h2>

        <p class="form-text mt-0">
          Uploaded MP3 files become available in every sound picker. They are stored on the server, so they
          survive a deploy and every operator sees them.
        </p>

        <!--
          The file input is only the picker the button opens; `d-none` keeps it out of the
          layout and out of the tab order, and the button carries the accessible name.
        -->
        <input
          bind:this={soundInput}
          type="file"
          class="d-none"
          accept="audio/mpeg,.mp3"
          multiple
          onchange={(event) => void handleSoundFiles(event)}
        />
        <button
          type="button"
          class="btn btn-primary"
          disabled={uploadingSounds}
          onclick={() => soundInput?.click()}
        >
          {#if uploadingSounds}
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Uploading…
          {:else}
            <i class="bi bi-upload me-2" aria-hidden="true"></i>Upload Sound Files
          {/if}
        </button>

        <h3 class="form-label mt-3 mb-1 h6">Available Sound Files</h3>
        <ul class="list-group list-group-flush">
          {#each boot.sounds as sound (sound.id)}
            <li class="list-group-item d-flex flex-wrap align-items-center gap-2 px-0">
              <span class="flex-grow-1 text-truncate">{sound.name}</span>

              <span class="badge {sound.source === 'uploaded' ? 'bg-info' : 'bg-secondary'}">
                {sound.source === 'uploaded' ? 'Uploaded' : 'Built-in'}
              </span>

              <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                aria-label="Play {sound.name}"
                title="Play {sound.name}"
                onclick={() => void preview.testSound(sound.id)}
              >
                <i class="bi bi-play-fill" aria-hidden="true"></i>
              </button>

              {#if sound.source === 'uploaded'}
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger"
                  aria-label="Delete {sound.name}"
                  title="Delete {sound.name}"
                  onclick={() => void deleteSound(sound)}
                >
                  <i class="bi bi-trash" aria-hidden="true"></i>
                </button>
              {/if}
            </li>
          {:else}
            <li class="list-group-item px-0 text-muted">No sound files available.</li>
          {/each}
        </ul>
      </div>
    </div>
  </div>

  <!-- ----------------------------------------------------------------- Right column -->
  <div class="col-lg-6">
    <div class="card">
      <div class="card-body">
        <h2 class="card-title h5">Theme &amp; Appearance</h2>

        <SettingSelect
          setting="fontFamily"
          label="Font Family"
          tooltip="Choose the main font for the application"
          options={FONT_FAMILIES}
        />

        <div class="mb-3">
          <span class="form-label d-block">Theme Colors</span>
          <div class="row">
            {#each colorFields as field (field.setting)}
              <div class="col-4">
                <label class="form-label small" for="settings-{field.setting}">{field.label}</label>
                <!--
                  `change`, never `input`. Chrome fires `input` for every pixel of a drag across
                  the colour field, and each one would restart the settings write debounce and
                  queue another server round trip. `settings.set` repaints the CSS custom
                  properties itself, so the app still recolours the moment a colour is chosen.
                -->
                <input
                  id="settings-{field.setting}"
                  type="color"
                  class="form-control color-input"
                  value={settings.current[field.setting]}
                  onchange={(event) => settings.set(field.setting, event.currentTarget.value)}
                />
              </div>
            {/each}
          </div>
        </div>

        <SettingSelect
          setting="backgroundType"
          label="Background Type"
          tooltip="Choose background style for winner display"
          options={backgroundTypeOptions}
        />

        {#if settings.current.backgroundType === 'image'}
          <div class="mb-3">
            <span class="form-label d-block">Background Image</span>

            <div class="btn-group w-100 mb-3" role="group" aria-label="Background image source">
              <button
                type="button"
                class="btn btn-outline-primary"
                class:active={imageMode === 'existing'}
                aria-pressed={imageMode === 'existing'}
                onclick={() => (imageMode = 'existing')}
              >
                Select Existing
              </button>
              <button
                type="button"
                class="btn btn-outline-primary"
                class:active={imageMode === 'upload'}
                aria-pressed={imageMode === 'upload'}
                onclick={() => (imageMode = 'upload')}
              >
                Upload New
              </button>
            </div>

            {#if imageMode === 'existing'}
              {#if imagesLoading}
                <div class="text-center py-3">
                  <div class="spinner-border spinner-border-sm" role="status">
                    <span class="visually-hidden">Loading…</span>
                  </div>
                </div>
              {:else if imagesError}
                <div class="alert alert-danger d-flex flex-wrap gap-2 align-items-center" role="alert">
                  <span class="flex-grow-1 small">{imagesError}</span>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-danger"
                    onclick={() => void loadImages()}
                  >
                    Retry
                  </button>
                </div>
              {:else}
                <div class="row g-2">
                  {#each images as image (image.filename)}
                    {@const selected = isSelectedImage(image)}
                    <div class="col-4 col-md-3">
                      <button
                        type="button"
                        class="image-thumbnail"
                        class:selected
                        aria-pressed={selected}
                        aria-label="Use {image.filename} as the background"
                        onclick={() => selectImage(image.path)}
                      >
                        <img src={api.uploadUrl(image.url)} alt="" />
                        {#if selected}
                          <span class="image-thumbnail-check">
                            <i class="bi bi-check-circle-fill text-success" aria-hidden="true"></i>
                          </span>
                        {/if}
                      </button>
                    </div>
                  {:else}
                    <p class="col-12 text-muted small mb-0">
                      No images uploaded yet — use “Upload New” to add one.
                    </p>
                  {/each}
                </div>
                {#if images.length > 0}
                  <p class="text-muted small mt-2 mb-0">Click an image to select it as background</p>
                {/if}
              {/if}
            {:else}
              <label class="form-label" for="settings-background-image">Upload a new image</label>
              <input
                id="settings-background-image"
                type="file"
                class="form-control"
                accept="image/*"
                disabled={uploadingImage}
                onchange={(event) => void handleImageFile(event)}
              />
              <div class="form-text">
                {uploadingImage ? 'Uploading…' : 'The uploaded image is applied straight away.'}
              </div>
            {/if}
          </div>
        {/if}

        <div class="mb-3">
          <span class="form-label d-block">Theme Presets</span>
          <div class="row g-2">
            {#each THEME_PRESETS as preset (preset.id)}
              <div class="col-4">
                <button
                  type="button"
                  class="btn {preset.buttonClass} w-100 theme-preset"
                  onclick={() => settings.applyPreset(preset)}
                >
                  <i class="bi {preset.icon} me-1" aria-hidden="true"></i>{preset.label}
                </button>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>

    <div class="card mt-3">
      <div class="card-body">
        <h2 class="card-title h5">Display</h2>

        <SettingSelect
          setting="displayRatio"
          label="Public Display Ratio"
          tooltip="Lock the public winner display to a fixed screen shape (letterboxed with dark bars). Pick a Portrait ratio for vertical screens."
          groups={DISPLAY_RATIO_GROUPS}
        />

        <SettingSelect
          setting="displayFontSize"
          label="Winner Display Size"
          tooltip="How large the winner name is shown on the public display. Larger sizes reduce the card padding and enlarge the name; long names may wrap to two lines. Larger sizes suit smaller winner counts."
          options={DISPLAY_FONT_SIZES}
        />
      </div>
    </div>
  </div>
</div>
