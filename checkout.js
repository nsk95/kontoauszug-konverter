import { QUOTA_API, quotaLedger } from './lib/quota-client.js';

const status = document.querySelector('#payment-status');
const button = document.querySelector('#check-payment');
const field = document.querySelector('#instant-code');
const link = document.querySelector('#unlock-now');
const store = (() => { try { return window.localStorage; } catch { return { getItem: () => null, setItem() {} }; } })();
// Remove the bearer-like Stripe session ID from the address bar immediately.
const session = new URL(location.href).searchParams.get('session_id');
history.replaceState(null, '', location.pathname);
if (session) {
  button.hidden = false;
  button.addEventListener('click', check);
  await check();
}
document.querySelector('#copy-code')?.addEventListener('click', async (e) => {
  try { await navigator.clipboard.writeText(field.value); e.currentTarget.textContent = 'Kopiert'; }
  catch { field.select(); }
});
async function check() {
  button.disabled = true;
  status.textContent = 'Zahlungsbestätigung wird direkt bei Stripe geprüft …';
  try {
    const response = await fetch(`${QUOTA_API}/checkout`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session }), signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Zahlung konnte noch nicht bestätigt werden.');
    // This is the same deterministic code as in the existing confirmation email.
    field.value = data.code;
    document.querySelector('#instant-unlock').hidden = false;
    button.hidden = true;
    // Credit the converter's own balance in this browser right away (same ledger as the converter page;
    // redeeming is idempotent, so the e-mail link or a manual redeem later never adds pages twice).
    const lic = quotaLedger(store);
    const result = await lic.redeem(data.code);
    if (result.ok) {
      document.body.dataset.credited = 'true';
      link.href = './#konverter';
      link.textContent = 'Zum Konverter';
      status.textContent = `Zahlung bestätigt. Die 50 Seiten sind in diesem Browser gutgeschrieben – Ihr Guthaben: ${Math.max(0, lic.remaining())} Seiten. Die Vertragsbestätigung mit demselben Code folgt per E-Mail.`;
    } else {
      link.href = `./#freischalten=${encodeURIComponent(data.code)}`;
      link.textContent = 'Jetzt im Konverter einlösen';
      status.textContent = 'Zahlung bestätigt. Ihr Code für 50 Seiten ist bereit; ein Klick auf „Jetzt im Konverter einlösen“ schreibt das Guthaben gut. Die Vertragsbestätigung folgt zusätzlich per E-Mail.';
    }
  } catch (err) {
    status.textContent = `${err.message} Der bestehende E-Mail-Versand läuft unabhängig weiter. Bei verzögerter Zahlung können Sie erneut prüfen.`;
  } finally { button.disabled = false; }
}
