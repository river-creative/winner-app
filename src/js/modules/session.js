// ================================
// SESSION EXPIRY HANDLING
// ================================
//
// When the server rejects an API call with 401 (the in-memory-backed session was reset,
// the session lapsed after 24h, or the cookie is missing), show a blocking overlay that
// prompts the operator to sign in again — instead of silently returning empty data, which
// previously made an expired session look like "no winners found".
//
// Framework-agnostic (plain DOM + inline styles) so it renders correctly on any page
// (main app or scanner) regardless of which stylesheets have loaded.

let overlayShown = false;

export function showSessionExpired() {
  if (overlayShown) return;
  overlayShown = true;

  // Preserve where the user was so login can send them back. Relative ./login resolves
  // correctly whether the app is served at / or /win.
  const redirect = encodeURIComponent(window.location.pathname + window.location.search);
  const loginUrl = `./login?redirect=${redirect}`;

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Session expired');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:1rem', 'background:rgba(0,0,0,0.6)',
    'font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif'
  ].join(';');

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:16px;padding:2rem;max-width:360px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.25);';
  // Static markup only — no dynamic values interpolated into HTML.
  modal.innerHTML =
    '<div style="font-size:2.5rem;line-height:1;margin-bottom:0.75rem;">🔒</div>' +
    '<h4 style="margin:0 0 0.5rem;font-size:1.25rem;font-weight:600;color:#1f2937;">Session expired</h4>' +
    '<p style="margin:0 0 1.25rem;color:#6b7280;">Please sign in again to continue.</p>';

  // Build the link via the DOM so the (dynamic) redirect URL is never string-interpolated into HTML.
  const link = document.createElement('a');
  link.href = loginUrl;
  link.textContent = 'Sign in';
  link.style.cssText = 'display:inline-block;background:linear-gradient(135deg,#0A4f7B,#5FA1F7);color:#fff;text-decoration:none;padding:0.6rem 1.5rem;border-radius:8px;font-weight:600;';
  modal.appendChild(link);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Move focus to the actionable control for keyboard / screen-reader users.
  link.focus();
}
