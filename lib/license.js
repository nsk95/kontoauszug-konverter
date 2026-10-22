// Page packages unlocked by offline codes: KK1.<payload>.<signature>, Ed25519-signed.
// The app only holds the public key, so codes cannot be forged.
// shortcut: usage is counted in the viewer's localStorage, so clearing site data or
// reusing a code on another device is not prevented. Without a server this is an
// honour system; upgrade to a tiny redeem endpoint if abuse shows up in sales numbers.

export const PUBLIC_KEY = 'o6KvmgJo9QoUc-9wNjVxYBDErYCdqWvcjxR1WuG9y58';
export const FREE_PAGES = 3;
const KEY = 'kk-license-v1';

const b64u = {
  enc: (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};
export { b64u };

export async function verifyCode(code, publicKey = PUBLIC_KEY) {
  const m = /^KK1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) return null;
  try {
    const key = await crypto.subtle.importKey('raw', b64u.dec(publicKey), { name: 'Ed25519' }, false, ['verify']);
    const ok = await crypto.subtle.verify('Ed25519', key, b64u.dec(m[2]), new TextEncoder().encode(m[1]));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64u.dec(m[1])));
    return Number.isInteger(p.p) && p.p > 0 && typeof p.n === 'string' ? { serial: p.n, pages: p.p } : null;
  } catch {
    return null;
  }
}

// storage: anything with getItem/setItem (localStorage in the browser).
export function ledger(storage) {
  const load = () => {
    try { return JSON.parse(storage.getItem(KEY)) || { codes: {}, charged: {} }; } catch { return { codes: {}, charged: {} }; }
  };
  const save = (s) => { try { storage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked: nothing to persist */ } };
  return {
    remaining() {
      const s = load();
      const bought = Object.values(s.codes).reduce((a, c) => a + c, 0);
      const used = Object.values(s.charged).reduce((a, c) => a + c, 0);
      return FREE_PAGES + bought - used;
    },
    async redeem(code, publicKey) {
      const lic = await verifyCode(code, publicKey);
      if (!lic) return { ok: false, reason: 'Code ungültig' };
      const s = load();
      if (s.codes[lic.serial]) return { ok: false, reason: 'Code wurde in diesem Browser schon eingelöst' };
      s.codes[lic.serial] = lic.pages; save(s);
      return { ok: true, pages: lic.pages };
    },
    // Charges a document once (by content hash); re-exporting the same file is free.
    charge(docHash, pages) {
      const s = load();
      if (s.charged[docHash]) return true;
      if (this.remaining() < pages) return false;
      s.charged[docHash] = pages; save(s);
      return true;
    },
    isCharged: (docHash) => Boolean(load().charged[docHash]),
  };
}
