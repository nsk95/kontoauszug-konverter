import { QUOTA_API } from './lib/quota-client.js';

const status = document.querySelector('#payment-status');
const button = document.querySelector('#check-payment');
const field = document.querySelector('#instant-code');
const link = document.querySelector('#unlock-now');
// Remove the bearer-like Stripe session ID from the address bar immediately.
const session = new URL(location.href).searchParams.get('session_id');
history.replaceState(null, '', location.pathname);
if (session) {
  button.hidden = false;
  button.addEventListener('click', check);
  await check();
}
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
    link.href = `./#freischalten=${encodeURIComponent(data.code)}`;
    status.textContent = 'Zahlung bestätigt. Ihr Code für 50 Seiten ist sofort bereit. Bitte bewahren Sie ihn auf; die Vertragsbestätigung folgt zusätzlich per E-Mail.';
    button.hidden = true;
  } catch (err) {
    status.textContent = `${err.message} Der bestehende E-Mail-Versand läuft unabhängig weiter. Bei verzögerter Zahlung können Sie erneut prüfen.`;
  } finally { button.disabled = false; }
}
