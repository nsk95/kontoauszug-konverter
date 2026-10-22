import { ledger } from './license.js';

export const QUOTA_API = 'https://formundsystem.de/kk-api';
const KEY = 'kk-online-v1';
const read = (storage, key, fallback) => { try { return JSON.parse(storage.getItem(key)) || fallback; } catch { return fallback; } };
const operation = () => crypto.randomUUID().replaceAll('-', '');

// Only page count and random transaction IDs reach the quota service. Hashes stay local.
export function quotaLedger(storage, transport = fetch, api = QUOTA_API) {
  const local = ledger(storage);
  const previous = read(storage, 'kk-license-v1', { codes: {}, charged: {} });
  const legacy = Object.keys(previous.codes || {}).length > 0 && !storage.getItem(KEY);
  const state = read(storage, KEY, { remaining: local.remaining(), operations: {}, initialized: false });
  let pending;
  const save = () => {
    const value = JSON.stringify(state);
    storage.setItem(KEY, value);
    if (storage.getItem(KEY) !== value) throw new Error('Ihr Browser kann das Guthaben nicht speichern. Bitte Website-Speicher erlauben; es wurden keine weiteren Seiten gebucht.');
  };
  const request = async (path, body) => {
    let response;
    try {
      response = await transport(`${api}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('Das Online-Guthaben ist gerade nicht erreichbar. Ihre Datei und Vorschau bleiben auf Ihrem Gerät. Bitte später erneut versuchen; dieselbe Buchung wird nicht doppelt gezählt.'); }
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Guthaben konnte nicht geprüft werden.');
      error.status = response.status;
      throw error;
    }
    if (data.token) state.token = data.token;
    state.remaining = data.remaining;
    save();
    return data;
  };
  const initialize = () => pending ||= (async () => {
    save(); // Ensure persistence before performing any charge.
    await request('/balance', {});
    if (!state.initialized) {
      const used = Math.max(0, 3 - Math.max(0, local.remaining()));
      if (used) {
        state.migration ||= operation(); save();
        await request('/charge', { operation: state.migration, pages: used });
      }
      state.initialized = true; save();
    }
  })().catch(err => { pending = undefined; throw err; });
  return {
    legacy,
    remaining: () => legacy ? local.remaining() : state.remaining,
    async redeem(code) {
      if (legacy) return local.redeem(code);
      try {
        await initialize();
        const before = state.remaining;
        await request('/redeem', { code: code.trim() });
        return { ok: true, pages: Math.max(0, state.remaining - before), remaining: state.remaining };
      } catch (err) { return { ok: false, reason: err.message }; }
    },
    async charge(hash, pages) {
      if (legacy) return local.charge(hash, pages);
      if (local.isCharged(hash) || state.operations[hash]?.charged) return true;
      await initialize();
      state.operations[hash] ||= { id: operation() }; save();
      try {
        await request('/charge', { operation: state.operations[hash].id, pages });
        state.operations[hash].charged = true; save();
        return true;
      } catch (err) { if (err.status === 402) return false; throw err; }
    },
    async refresh() { if (!legacy) await initialize(); return this.remaining(); },
  };
}
