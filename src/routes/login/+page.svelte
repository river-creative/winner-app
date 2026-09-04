<script lang="ts">
  import { tick } from 'svelte';
  import { asset } from '$app/paths';
  import * as api from '$lib/api/client';
  import { ApiError } from '$lib/api/client';
  import type { GoogleCredentialResponse } from '$lib/types/google-identity';
  import { Persisted } from '$lib/utils/persisted.svelte';

  /**
   * Sign-in.
   *
   * This route sits outside the `(app)` group on purpose: nothing here may make an authenticated
   * request, because a 401 from one would put the "session expired" overlay up on the very page
   * that fixes an expired session.
   */

  const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
  // GIS renders a fixed-pixel-width button and caps it at 400.
  const GOOGLE_BUTTON_MAX_WIDTH = 400;
  const GOOGLE_BUTTON_MIN_WIDTH = 200;
  /** renderButton fails quietly; give it this long to insert something before we call it. */
  const RENDER_CHECK_DELAY_MS = 2000;
  const RESIZE_DEBOUNCE_MS = 150;

  /**
   * Which method this browser signed in with last.
   *
   * Shared scanner tablets use the admin credentials every time, so opening straight to that
   * form saves them a click; staff browsers keep Google in front. Purely a per-browser
   * convenience — `Persisted` guards every read and write, because storage throws outright in
   * some private-browsing modes.
   */
  const lastMethod = new Persisted<string>('login_last_method', '', { raw: true });

  let errorText = $state('');
  // Open on the admin form for a browser that last used it, before Google finishes loading —
  // no flash of the wrong panel.
  let adminOpen = $state(lastMethod.current === 'admin');
  let submitting = $state(false);

  let skeletonVisible = $state(true);
  let googleBusy = $state(false);
  let googleUnavailable = $state(false);

  let googleButtonEl = $state<HTMLDivElement>();
  let usernameEl = $state<HTMLInputElement>();

  let username = $state('');
  let password = $state('');

  /**
   * Where to go after a successful sign-in.
   *
   * The `redirect` parameter is attacker-controllable — anyone can hand out a link to this page.
   * Resolving it against our own origin and requiring it to stay there turns an open redirect
   * (which would drop a freshly-signed-in operator on a convincing fake login page) into a
   * same-origin path. Also rejects the protocol-relative "//evil.example" form and non-http
   * schemes, both of which resolve to a different origin.
   */
  function safeRedirectTarget(): string {
    const raw = new URLSearchParams(location.search).get('redirect');
    if (!raw) return './';
    try {
      const url = new URL(raw, location.origin);
      if (url.origin !== location.origin) return './';
      return url.pathname + url.search + url.hash;
    } catch {
      return './';
    }
  }

  /**
   * The most useful message a failed sign-in can offer, without assuming the body was JSON.
   *
   * A 403 carries the server's own explanation (wrong domain, unverified address) verbatim — it
   * is the one message that tells the user what to do differently. A non-JSON 5xx is a dev-proxy
   * or gateway failure, which means unreachable rather than rejected.
   */
  function signInErrorMessage(error: unknown): string {
    if (!(error instanceof ApiError) || error.status === 0) {
      return 'Cannot reach the server. Please check your connection and try again.';
    }

    const body: unknown = error.body;
    if (body && typeof body === 'object' && 'error' in body) {
      const { error: serverMessage } = body as { error?: unknown };
      if (typeof serverMessage === 'string' && serverMessage) return serverMessage;
    }

    if (error.status >= 500) return 'Cannot reach the server. Please try again shortly.';
    return `Sign in failed (${error.status}). Please try again.`;
  }

  async function expandAdminPanel(focusFirstField: boolean) {
    adminOpen = true;
    if (!focusFirstField) return;
    // The panel is only `hidden`, never unmounted, but the attribute change still has to land
    // before the field can take focus.
    await tick();
    usernameEl?.focus();
  }

  function toggleAdminPanel() {
    if (adminOpen) adminOpen = false;
    else void expandAdminPanel(true);
  }

  /** Google is unreachable/blocked: say so, and put the working path in front of the user. */
  function markGoogleUnavailable() {
    skeletonVisible = false;
    googleBusy = false;
    googleUnavailable = true;
    void expandAdminPanel(false);
  }

  /**
   * Load the Google Identity Services client script once.
   *
   * Resolves when `window.google.accounts.id` is available; rejects if the script fails to load
   * (CSP, an ad-blocker, or offline).
   */
  function loadGisScript(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }

      const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in')), {
          once: true
        });
        return;
      }

      const script = document.createElement('script');
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google sign-in'));
      document.head.appendChild(script);
    });
  }

  /** GIS callback: exchange the Google ID token for a session cookie. */
  async function handleCredential(response: GoogleCredentialResponse) {
    errorText = '';
    googleBusy = true;
    try {
      await api.signInWithGoogle(response.credential);
      lastMethod.current = 'google';
      location.href = safeRedirectTarget();
      // Deliberately no `finally`: that would also run on this success path, flashing the button
      // back on screen while the browser is already navigating away.
      return;
    } catch (error) {
      errorText = signInErrorMessage(error);
    }

    // Only a sign-in that failed gets the button back for a retry.
    googleBusy = false;
  }

  /** GIS needs an explicit pixel width, so it is derived from the card and kept in sync. */
  function googleButtonWidth(): number {
    const available = googleButtonEl?.parentElement?.clientWidth ?? 0;
    return Math.round(Math.min(GOOGLE_BUTTON_MAX_WIDTH, Math.max(GOOGLE_BUTTON_MIN_WIDTH, available)));
  }

  function renderGoogleButton() {
    const target = googleButtonEl;
    const gis = window.google?.accounts?.id;
    if (!target || !gis) return;

    // Clear first: whether GIS replaces or appends into the container is not something to depend
    // on, and a re-render that appends would stack a second button on every resize.
    target.replaceChildren();
    gis.renderButton(target, {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      width: googleButtonWidth()
    });
  }

  /**
   * Bring Google sign-in up, and register the two things that have to be torn down with it: the
   * deferred render check and the resize listener.
   */
  async function initGoogleSignIn(signal: AbortSignal): Promise<() => void> {
    const config = await api.getAuthConfig();
    if (!config.clientId) throw new Error('Auth config carried no client ID');

    await loadGisScript();
    const gis = window.google?.accounts?.id;
    if (!gis) throw new Error('Google Identity Services did not initialise');
    if (signal.aborted) return () => {};

    gis.initialize({
      client_id: config.clientId,
      callback: handleCredential,
      hosted_domain: config.hostedDomain,
      auto_select: false
    });

    renderGoogleButton();
    skeletonVisible = false;

    // renderButton can fail quietly — an unauthorised origin leaves the container empty and the
    // page looks fine while being unable to sign anyone in. The check is deferred rather than
    // immediate so it cannot race GIS's own insertion, and it only ever downgrades to the admin
    // path; it never blocks a button that did render.
    const renderCheck = setTimeout(() => {
      if (googleButtonEl?.childElementCount === 0) {
        console.error(
          '[login] Google button did not render — check Authorized JavaScript origins for this client ID.'
        );
        markGoogleUnavailable();
      }
    }, RENDER_CHECK_DELAY_MS);

    // Keep the fixed-width button in step with the card across rotation/resize.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let lastWidth = googleButtonWidth();
    window.addEventListener(
      'resize',
      () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const width = googleButtonWidth();
          if (width === lastWidth) return;
          lastWidth = width;
          renderGoogleButton();
        }, RESIZE_DEBOUNCE_MS);
      },
      { signal }
    );

    return () => {
      clearTimeout(renderCheck);
      clearTimeout(resizeTimer);
    };
  }

  async function submitAdminSignIn(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;

    submitting = true;
    errorText = '';
    try {
      await api.signInWithPassword(username, password);
      lastMethod.current = 'admin';
      location.href = safeRedirectTarget();
      // As above: no `finally`. Restoring the button here would flash the form back while the
      // browser is already navigating away.
      return;
    } catch (error) {
      errorText = signInErrorMessage(error);
    }

    submitting = false;
  }

  /**
   * Start Google sign-in once, on mount.
   *
   * The abort signal removes the resize listener; the returned disposer clears both timers. The
   * effect reads no reactive state, so it never re-runs.
   */
  $effect(() => {
    const controller = new AbortController();
    let disposeTimers: (() => void) | null = null;

    initGoogleSignIn(controller.signal).then(
      (dispose) => {
        if (controller.signal.aborted) dispose();
        else disposeTimers = dispose;
      },
      (error: unknown) => {
        console.error('[login] Google sign-in unavailable:', error);
        if (!controller.signal.aborted) markGoogleUnavailable();
      }
    );

    return () => {
      controller.abort();
      disposeTimers?.();
    };
  });
</script>

<svelte:head><title>Login - Winner App</title></svelte:head>

<div class="login-page">
  <div class="login-card">
    <div class="logo">
      <img src={asset('/favicon.png')} alt="" />
      <h1>Winner App</h1>
      <p>Sign in to continue</p>
    </div>

    <!--
      role=alert + aria-live announces failures to screen readers; the element stays in the DOM
      so the live region is registered before the first message lands in it.
    -->
    <div class="error-message" class:show={errorText !== ''} role="alert" aria-live="assertive">
      <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
      <span>{errorText}</span>
    </div>

    <div class="google-slot" hidden={googleBusy || googleUnavailable}>
      <div bind:this={googleButtonEl}></div>
      <div class="google-skeleton" hidden={!skeletonVisible}></div>
    </div>
    <p class="google-note" role="status" hidden={!googleBusy}>Signing you in&hellip;</p>
    <p class="google-note" hidden={!googleUnavailable}>
      Google sign-in is unavailable right now. Use admin credentials below.
    </p>

    <div class="divider"><span>or</span></div>

    <button
      type="button"
      class="disclosure"
      aria-expanded={adminOpen}
      aria-controls="adminPanel"
      onclick={toggleAdminPanel}
    >
      <i class="bi bi-key" aria-hidden="true"></i>
      <span>Sign in with admin credentials</span>
      <i class="bi bi-chevron-down chevron" aria-hidden="true"></i>
    </button>

    <div id="adminPanel" hidden={!adminOpen}>
      <form onsubmit={submitAdminSignIn}>
        <div class="form-group">
          <label class="form-label" for="username">Username</label>
          <input
            bind:this={usernameEl}
            bind:value={username}
            type="text"
            class="form-input"
            id="username"
            name="username"
            placeholder="Enter username"
            required
            autocomplete="username"
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="password">Password</label>
          <input
            bind:value={password}
            type="password"
            class="form-input"
            id="password"
            name="password"
            placeholder="Enter password"
            required
            autocomplete="current-password"
          />
        </div>

        <button type="submit" class="login-btn" disabled={submitting}>
          {#if submitting}
            <span class="spinner" role="status" aria-label="Signing in"></span>
          {:else}
            <span>Sign In</span>
          {/if}
        </button>
      </form>
    </div>
  </div>
</div>
