import type { Winner } from '$lib/types';

/** How one SMS status renders: the badge classes, the Bootstrap icon and the label. */
export interface SmsBadge {
  class: string;
  icon: string;
  text: string;
}

/**
 * The fallback, and deliberately also where every status the map below does not name lands —
 * `pending`, `cancelled` and `unknown` included.
 *
 * That is exactly how the Alpine `winnerHelpers` component resolved them, and it is the honest
 * answer: none of those three means the message reached anyone, and inventing a badge for them
 * would tell a pickup desk that something was sent when nothing was confirmed.
 */
const NOT_SENT: SmsBadge = { class: 'badge bg-secondary', icon: 'bi-dash-circle', text: 'Not Sent' };

const BADGES = {
  delivered: { class: 'badge bg-success', icon: 'bi-check-circle-fill', text: 'Delivered' },
  bounced: { class: 'badge bg-danger', icon: 'bi-x-circle-fill', text: 'Bounced' },
  failed: { class: 'badge bg-danger', icon: 'bi-x-circle-fill', text: 'Failed' },
  queued: { class: 'badge bg-info', icon: 'bi-clock-fill', text: 'Queued' },
  sending: { class: 'badge bg-warning', icon: 'bi-arrow-up-circle-fill', text: 'Sending' },
  sent: { class: 'badge bg-primary', icon: 'bi-send-fill', text: 'Sent' }
} satisfies Record<string, SmsBadge>;

/**
 * The one place the SMS column's badge is decided.
 *
 * Shared rather than duplicated because the scanner shows the same badge for the winner it has
 * just looked up: two copies of this map is how a status ends up green in one screen and grey
 * in the other. Statuses are lowercased on the way in — the backend and the texting provider do
 * not agree on casing.
 */
export function smsBadge(winner: Winner): SmsBadge {
  const status = winner.sms?.status;
  if (!status) return NOT_SENT;
  return (BADGES as Record<string, SmsBadge | undefined>)[status.toLowerCase()] ?? NOT_SENT;
}
