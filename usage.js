// Optional, per-page aggregate counters. No storage, cookies, URLs or document data.
import { QUOTA_API } from './lib/quota-client.js';
const consent = document.querySelector('#usage-consent');
const sent = new Set();
const audience = new URLSearchParams(location.search).get('messung') === 'qa' || navigator.webdriver ? 'qa' : 'public';
const privacyPreference = navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
if (consent) {
  consent.checked = false;
  consent.disabled = privacyPreference;
  consent.addEventListener('change', () => { if (consent.checked) usageEvent('page_view'); });
}
export function usageEvent(event) {
  if (!consent?.checked || privacyPreference || sent.has(event)) return;
  sent.add(event); // Once per step and page instance; no retries or backfill.
  void fetch(`${QUOTA_API}/events`, {
    method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, audience, consent: true }),
    signal: AbortSignal.timeout(3000), keepalive: true,
  }).catch(() => {}); // Counting must never delay or block conversion or checkout.
}
const STRIPE_LINK = 'https://buy.stripe.com/9B614ncLv4lL7bl3RqgnK00';
// Ad attribution without tracking: a source tag in the landing URL (e.g. ?quelle=gads-{keyword}) only travels
// to Stripe as client_reference_id when the buyer clicks, so paid sessions show their origin. Nothing is stored.
const source = (new URLSearchParams(location.search).get('quelle') || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64).replace(/^-+|-+$/g, '');
if (source) for (const a of document.querySelectorAll(`a[href="${STRIPE_LINK}"]`)) a.href = `${STRIPE_LINK}?client_reference_id=${source}`;
document.addEventListener('click', e => {
  const link = e.target.closest('a[href]');
  if (link && link.origin + link.pathname === STRIPE_LINK) usageEvent('checkout_click');
});
document.querySelector('video')?.addEventListener('play', () => usageEvent('video_play'));
