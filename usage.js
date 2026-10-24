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
document.addEventListener('click', e => {
  const link = e.target.closest('a[href]');
  if (link?.href === 'https://buy.stripe.com/9B614ncLv4lL7bl3RqgnK00') usageEvent('checkout_click');
});
document.querySelector('video')?.addEventListener('play', () => usageEvent('video_play'));
