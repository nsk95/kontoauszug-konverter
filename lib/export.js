// Export a parsed statement (see parse.js) to CSV, CAMT.053, MT940 and DATEV.
// Amounts are integer cents throughout; formatting happens only here.
import { DATEV_COLUMNS } from './datev-columns.js';

const eur = (c, sep = ',') => {
  const a = Math.abs(c);
  return `${Math.floor(a / 100)}${sep}${String(a % 100).padStart(2, '0')}`;
};
const deAmount = (c) => (c < 0 ? '-' : '') + eur(c);

// ---------- CSV (Excel, German locale) ----------
export function toCSV(st) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const de = (iso) => iso.split('-').reverse().join('.');
  const rows = [['Buchungstag', 'Wertstellung', 'Buchungstext', 'Betrag', 'Währung']];
  for (const r of st.rows) rows.push([de(r.date), de(r.valueDate), r.text, deAmount(r.cents), st.currency]);
  return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n') + '\r\n';
}

// ---------- CAMT.053.001.08 (ISO 20022, as used by the DK "DFÜ-Abkommen Anlage 3") ----------
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const chunks = (s, n) => (s.match(new RegExp(`.{1,${n}}`, 'gs')) || ['']);

export function toCAMT(st, now = new Date()) {
  const ts = now.toISOString().slice(0, 19);
  const id = `KK${st.iban || 'UNBEKANNT'}${(st.to || ts).slice(0, 10).replace(/-/g, '')}`.slice(0, 35);
  const bal = (cd, b, fallback) => `
      <Bal><Tp><CdOrPrtry><Cd>${cd}</Cd></CdOrPrtry></Tp><Amt Ccy="${st.currency}">${eur(b.cents, '.')}</Amt><CdtDbtInd>${b.cents < 0 ? 'DBIT' : 'CRDT'}</CdtDbtInd><Dt><Dt>${b.date || fallback}</Dt></Dt></Bal>`;
  const ntry = (r) => `
      <Ntry>
        <Amt Ccy="${st.currency}">${eur(r.cents, '.')}</Amt><CdtDbtInd>${r.cents < 0 ? 'DBIT' : 'CRDT'}</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>${r.date}</Dt></BookgDt><ValDt><Dt>${r.valueDate}</Dt></ValDt>
        <BkTxCd/>
        <NtryDtls><TxDtls><RmtInf>${chunks(r.text, 140).map((c) => `<Ustrd>${xml(c)}</Ustrd>`).join('')}</RmtInf></TxDtls></NtryDtls>
      </Ntry>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>${xml(id)}</MsgId><CreDtTm>${ts}</CreDtTm></GrpHdr>
    <Stmt>
      <Id>${xml(id)}</Id>${st.statementNo ? `<ElctrncSeqNb>${st.statementNo}</ElctrncSeqNb>` : ''}<CreDtTm>${ts}</CreDtTm>
      <FrToDt><FrDtTm>${st.from}T00:00:00</FrDtTm><ToDtTm>${st.to}T23:59:59</ToDtTm></FrToDt>
      <Acct><Id>${st.iban ? `<IBAN>${st.iban}</IBAN>` : '<Othr><Id>UNBEKANNT</Id></Othr>'}</Id><Ccy>${st.currency}</Ccy></Acct>${bal('PRCD', st.opening, st.from)}${bal('CLBD', st.closing, st.to)}${st.rows.map(ntry).join('')}
    </Stmt>
  </BkToCstmrStmt>
</Document>
`;
}

// ---------- MT940 (SWIFT, German DK variant) ----------
// Field :86: uses GVC 999 = "Unstrukturierte Belegung des Mehrzweckfeldes" (DFÜ-Abkommen
// Anlage 3, GVC table); structured use of :86: is optional there. PDFs carry no business
// transaction codes, so a structured GVC would be guessed.
// shortcut: no ?20..?29 subfields; add them if an importer insists on structured :86:.
const swift = (s) => s
  .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^A-Za-z0-9/\-:().,'+ ]/g, '.');
const yymmdd = (iso) => iso.slice(2).replace(/-/g, '');

export function toMT940(st) {
  const acct = st.iban && st.iban.startsWith('DE') && st.iban.length === 22
    ? `${st.iban.slice(4, 12)}/${st.iban.slice(12).replace(/^0+/, '')}` : (st.iban || 'UNBEKANNT');
  const bal = (tag, b, fallback) => `:${tag}:${b.cents < 0 ? 'D' : 'C'}${yymmdd(b.date || fallback)}${st.currency}${eur(b.cents)}`;
  const out = [':20:STARTUMS', `:25:${acct}`, `:28C:${String(st.statementNo || 1).padStart(5, '0')}/001`, bal('60F', st.opening, st.from)];
  for (const r of st.rows) {
    out.push(`:61:${yymmdd(r.valueDate)}${r.date.slice(5).replace('-', '')}${r.cents < 0 ? 'D' : 'C'}${eur(r.cents)}NMSCNONREF`);
    // 6 lines of max. 65 chars including the ":86:" tag line
    const t = swift(r.text);
    out.push(`:86:999${t.slice(0, 58)}`, ...chunks(t.slice(58), 65).filter(Boolean).slice(0, 5));
  }
  out.push(bal('62F', st.closing, st.to), '-');
  return out.join('\r\n') + '\r\n';
}

// ---------- DATEV-Format Buchungsstapel (EXTF, Version 700, Kategorie 21, Formatversion 13) ----------

export const DATEV_DEFAULTS = { berater: 1001, mandant: 1, bankkonto: '1200', gegenkonto: '1590', kontenlaenge: 4, kuerzel: '' };

export function toDATEV(st, opt = {}, now = new Date()) {
  const o = { ...DATEV_DEFAULTS, ...opt };
  const year = (st.from || st.rows[0]?.date || '').slice(0, 4);
  if (st.rows.some((r) => !r.date.startsWith(year))) throw new Error('Ein DATEV-Stapel darf nur ein Wirtschaftsjahr enthalten. Bitte den Auszug je Jahr exportieren.');
  const ymd = (iso) => iso.replace(/-/g, '');
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const created = now.toISOString().replace(/\D/g, '').slice(0, 17);
  const head = ['"EXTF"', 700, 21, '"Buchungsstapel"', 13, created, '', '"RE"', '""', '""', o.berater, o.mandant,
    `${year}0101`, o.kontenlaenge, ymd(st.from), ymd(st.to), q(`Bank ${st.bank}`.slice(0, 30)), q(o.kuerzel), 1, 0, 0, '"EUR"',
    '', '', '', '', '', '', '', '', ''];
  const lines = [head.join(';'), DATEV_COLUMNS.join(';')];
  for (const r of st.rows) {
    const f = new Array(DATEV_COLUMNS.length).fill('');
    f[0] = eur(r.cents);
    f[1] = r.cents < 0 ? '"H"' : '"S"'; // S/H refers to field "Konto" = the bank account
    f[6] = o.bankkonto;
    f[7] = o.gegenkonto;
    f[9] = r.date.slice(8, 10) + r.date.slice(5, 7); // Belegdatum TTMM
    f[13] = q(r.text.slice(0, 60));
    lines.push(f.join(';'));
  }
  return encodeCp1252(lines.join('\r\n') + '\r\n');
}

// DATEV expects ANSI (Windows-1252); TextEncoder only does UTF-8.
const CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
export function encodeCp1252(s) {
  const out = new Uint8Array(s.length);
  let i = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    out[i++] = CP1252[ch] ?? (c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : 0x3f);
  }
  return out.slice(0, i);
}
