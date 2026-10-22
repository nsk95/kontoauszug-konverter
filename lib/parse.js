// Turn positioned text lines (see pdftext.js) into a bank statement.
// One generic, layout-driven parser instead of one parser per bank: transactions are
// lines with a date token and an amount token; following lines without an amount are
// purpose continuations. Column headers (Soll/Haben, Ausgang/Eingang) decide the sign
// when the amount itself carries none.

const DATE = /^(\d{2})\.(\d{2})(?:\.(\d{4}|\d{2})?)?$/;
const DATE_PAIR = /^(\d{2}\.\d{2}\.?)\/(\d{2}\.\d{2}\.?)$/;
// Trailing "*" marks balances that ignore value dates (1822direkt).
const AMOUNT = /^([+-])?\s*((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s*([+-]|S|H)?\s*(?:EUR|Euro|€)?\s*\*?$/;
const SUFFIX = /^([+-]|S|H|EUR|Euro|€|€?\*)$/;
const OPEN = /alter\s+(konto)?stand|eröffnungssaldo|alter\s+saldo|anfangssaldo|startsaldo|saldo\s+alt|saldovortrag|dein alter kontostand|kontostand\s+(alt|vorher)/i;
const CLOSE = /neuer\s+(konto)?stand|neuer\s+saldo|endsaldo|schlusssaldo|saldo\s+neu|dein neuer kontostand/i;
const AMBIG = /kontostand\s+(in\s+\w+\s+)?(am|vom|zum)|saldo\s+(am|vom|zum)/i;
const CARRY = /übertrag|uebertrag|zwischensumme|zwischensaldo|summe\s+(der\s+)?(umsätze|soll|haben)/i;
// Value-dated interim balances between bookings ("*** Kontostand zum 09.12. *** 2.100,74+", Consorsbank).
const INFO = /\*\*\*/;
// Month names for dates split over lines ("16" / "Feb." / "2026", Trade Republic).
const MONTHS = { jan: 1, feb: 2, mär: 3, märz: 3, mrz: 3, apr: 4, mai: 5, jun: 6, juni: 6, jul: 7, juli: 7, aug: 8, sep: 9, sept: 9, okt: 10, nov: 11, dez: 12 };
const MONTH = /^(jan|feb|mär|märz|mrz|apr|mai|juni?|juli?|aug|sept?|okt|nov|dez)\.?$/i;
const YEAR = /^(19|20)\d{2}$/;
const PAGE_NO = /seite\s+\d+\s*(von|\/)\s*\d+|blatt\s+\d+/i;
const HEADER_WORDS = /^(datum|buchung|buchungstag|bu-tag|valuta|wert|wertstellung|vorgang|erläuterung|buchungstext|betrag|soll|haben|ausgang|eingang|beschreibung|verbuchungsdatum|verwendungszweck|buchungsinformation|vervollständigt|einnahmen|guthaben|umsatz|saldo|zahlungs(ein|aus)gang)/i;
const IBAN = /\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?)\b/;

export const BANKS = [
  ['N26', /\bN26\b|NTSBDEB1/],
  ['Trade Republic', /trade republic|TRBKDEBB/i], // names custodian banks (e.g. Deutsche Bank) in its own tables
  ['Consorsbank', /consorsbank|CSDBDE71/i],
  ['C24', /\bC24 Bank\b/i],
  ['1822direkt', /1822direkt|HELADEF1822/i], // before Sparkasse: a subsidiary of Frankfurter Sparkasse
  ['Norisbank', /norisbank|NORSDE51/i], // before Deutsche Bank, its parent
  ['comdirect', /comdirect|COBADEHD055/i],
  ['Commerzbank', /commerzbank|COBADE/i],
  ['Postbank', /postbank|PBNKDEFF/i], // before Deutsche Bank: Postbank statements name its parent
  ['Deutsche Bank', /deutsche bank|DEUTDE/i],
  ['ING', /\bING\b|ING-DiBa|INGDDEFF/],
  ['DKB', /\bDKB\b|deutsche kreditbank|BYLADEM1001/i],
  ['Targobank', /targobank|CMCIDEDD/i],
  ['Sparkasse', /sparkasse/i],
  ['Volksbank/Raiffeisenbank', /volksbank|raiffeisen|VR[- ]?Bank|GENODE/i],
  ['Finom', /\bFINOM\b/i], // named only in the legal footer
];

export function parseAmount(s) {
  const m = AMOUNT.exec(s.trim().replace(/\u2212/g, '-')); // U+2212 minus sign (1822direkt)
  if (!m) return null;
  const cents = parseInt(m[2].replace(/[.,]/g, ''), 10);
  const lead = m[1], tail = m[3];
  let sign = 0; // 0 = unknown, decided by column
  if (lead === '-' || tail === '-' || tail === 'S') sign = -1;
  else if (lead === '+' || tail === '+' || tail === 'H') sign = 1;
  return { cents, sign };
}

// Merge stray sign/currency items ("12,34" "S", "-" "12,34") into their amount item.
// With known columns, an amount far from every amount column is part of the text
// (e.g. "Rechnung über 1.234,56 EUR" in a purpose line).
const COL_SLACK = 30;
function inAmountColumn(t, cols) {
  const xs = cols ? [cols.debit, cols.credit, cols.amount, cols.balance].filter((v) => v != null) : [];
  return !xs.length || xs.some((r) => Math.abs(t.r - r) < COL_SLACK);
}

function tokens(line, cols) {
  const out = [];
  for (const it of line.items) {
    const prev = out[out.length - 1];
    if (prev && SUFFIX.test(it.s) && prev.kind === 'amount' && it.x - prev.r < 15) {
      prev.s += ' ' + it.s; prev.r = it.r; prev.amt = parseAmount(prev.s); continue;
    }
    const t = { s: it.s, x: it.x, r: it.r, kind: 'text' };
    if (prev && /^[+\-\u2212]$/.test(prev.s) && t.x - prev.r < 15 && parseAmount(it.s)) {
      prev.s += it.s; prev.r = it.r; prev.kind = 'amount'; prev.amt = parseAmount(prev.s); continue;
    }
    const pair = DATE_PAIR.exec(it.s); // Postbank style "01.10./02.10."
    if (pair) { out.push({ ...t, s: pair[1], kind: 'date' }, { ...t, s: pair[2], kind: 'date' }); continue; }
    if (DATE.test(it.s) && validDayMonth(it.s)) t.kind = 'date';
    else if ((t.amt = parseAmount(it.s))) t.kind = 'amount';
    else if (MONTH.test(it.s)) t.kind = 'month';
    out.push(t);
  }
  for (const t of out) if (t.kind === 'amount' && !inAmountColumn(t, cols)) t.kind = 'text';
  return out;
}

function validDayMonth(s) {
  const [, d, m] = DATE.exec(s);
  return +d >= 1 && +d <= 31 && +m >= 1 && +m <= 12;
}

function headerColumns(line) {
  const words = line.items.filter((i) => HEADER_WORDS.test(i.s));
  if (words.length < 3) return null;
  const cols = {};
  const first = line.items.find((i) => /^(datum|buchung|bu-tag)/i.test(i.s));
  if (first) cols.date = first.x;
  for (const i of line.items) {
    if (/^(saldo|kontostand|guthaben)/i.test(i.s)) cols.balance = i.r; // before "haben": Guthaben is the balance
    else if (/soll|ausgang|belastung/i.test(i.s)) cols.debit = i.r;
    else if (/haben|eingang|gutschrift/i.test(i.s)) cols.credit = i.r;
    else if (/betrag|umsatz|einnahmen\s*\//i.test(i.s)) cols.amount = i.r; // Finom: one "Einnahmen / Ausgaben" column
  }
  return cols;
}

function signed(tok, cols) {
  const { cents, sign } = tok.amt;
  if (sign) return sign * cents;
  if (cols && cols.debit != null && cols.credit != null) {
    return Math.abs(tok.r - cols.debit) < Math.abs(tok.r - cols.credit) ? -cents : cents;
  }
  return cents;
}

// A line of balance labels without amounts ("Buchungssaldo alt", "PRODUKT ANFANGSSALDO … ENDSALDO",
// "Auszug Seite von IBAN Alter Saldo per …"): the values stand in the next line, below their label.
function balanceLabels(line) {
  const at = {};
  for (const i of line.items) {
    if (OPEN.test(i.s)) at.open ??= (i.x + i.r) / 2;
    else if (CLOSE.test(i.s)) at.close ??= (i.x + i.r) / 2;
  }
  return at.open != null || at.close != null ? at : null;
}

function dateParts(s) {
  const [, d, m, y] = DATE.exec(s);
  return { d: +d, m: +m, y: y ? (y.length === 2 ? 2000 + +y : +y) : null };
}

export function detectBank(text) {
  const hit = BANKS.find(([, re]) => re.test(text));
  return hit ? hit[0] : 'unbekannt';
}

export function parseStatement({ lines, pages }) {
  const head = lines.filter((l) => l.page === 1).slice(0, 20).map((l) => l.text).join('\n');
  const st = {
    bank: 'unbekannt', pages, iban: null, currency: 'EUR', statementNo: null,
    opening: null, closing: null, rows: [], warnings: [],
  };
  const no = /(?:auszug|kontoauszug)\s*(?:nr\.?|nummer)?\s*:?\s*(\d{1,4})(?:\s*\/\s*(\d{4}))?/i.exec(head);
  if (no) st.statementNo = +no[1];

  // Sub-accounts (N26 Spaces) follow the main account in the same PDF, each closed by its
  // own balance summary. shortcut: assumes the summary comes after its rows (bottom
  // summary); a PDF with several top summaries would be split one block late.
  const subs = [];
  let cols = null, cur = null, secStart = 0, closedAt = -1, labels = null, day = null;
  const used = new Set(); // lines belonging to a booking; counterparty IBANs and banks live there
  for (const [li, line] of lines.entries()) {
    if (labels) { // values for the balance labels of the previous line
      const at = labels; labels = null;
      const all = tokens(line, null), vals = all.filter((t) => t.kind === 'amount');
      if (vals.length && !all.some((t) => t.kind === 'date')) {
        const near = (x) => vals.reduce((a, t) => (Math.abs((t.x + t.r) / 2 - x) < Math.abs((a.x + a.r) / 2 - x) ? t : a));
        if (at.open != null && !st.opening) st.opening = { cents: signed(near(at.open), null), date: null };
        if (at.close != null) st.closing = { cents: signed(near(at.close), null), date: null };
        cur = null; continue;
      }
    }
    if (INFO.test(line.text)) { cur = null; continue; }
    const hc = headerColumns(line);
    if (hc) { cols = hc; cur = null; day = null; continue; }
    let toks = tokens(line, cols);
    const amts = toks.filter((t) => t.kind === 'amount');
    const dates = toks.filter((t) => t.kind === 'date');
    const contFirst = toks.find((t) => t.kind !== 'date' && !YEAR.test(t.s));
    const continues = cur && line.page === cur.page && cur.lastY - line.y <= line.h * 2.2 && (!contFirst || contFirst.x >= cur.descX - 3);
    if (!amts.length && !dates.length && !continues && (labels = balanceLabels(line))) { cur = null; continue; }

    // Day alone in the date column starts a booking whose month line follows (Trade Republic).
    if (toks.length === 1 && /^\d{1,2}$/.test(toks[0].s) && cols?.date != null && Math.abs(toks[0].x - cols.date) < 15) {
      day = { d: +toks[0].s, pre: [] }; cur = null; continue;
    }
    const month = day && !dates.length && toks.find((t) => t.kind === 'month');
    if (day && !amts.length && !month) { day.pre.push(line.text); continue; } // description above the month line

    const kind = OPEN.test(line.text) ? 'open' : CLOSE.test(line.text) ? 'close'
      : AMBIG.test(line.text) ? (st.opening || st.rows.length > secStart ? 'close' : 'open') : null;
    if (kind && amts.length) {
      if (closedAt >= 0 && (st.rows.length > closedAt || kind === 'open')) { // rows or a new opening after a closing: next sub-account
        subs.push({ opening: st.opening, closing: st.closing, rows: st.rows.slice(secStart, closedAt) });
        secStart = closedAt; st.opening = st.closing = null; closedAt = -1;
      }
      const d = /\b\d{2}\.\d{2}\.(\d{4}|\d{2})\b/.exec(line.text);
      const bal = { cents: signed(amts[amts.length - 1], null), date: d ? dateParts(d[0]) : null };
      if (kind === 'open' && !st.opening) st.opening = bal;
      else if (kind === 'close') { st.closing = bal; closedAt = st.rows.length; }
      cur = null; continue;
    }
    // Carry-over lines hold a balance but no date; "übertragen" in a purpose line is text (Finom).
    // shortcut: a dated carry line ("Übertrag vom 30.09. 1.234,56") would count as a booking; the balance check flags it.
    if (PAGE_NO.test(line.text) || (CARRY.test(line.text) && amts.length && !dates.length)) { cur = null; continue; }

    const txAmts = amts.filter((t) => !(cols && cols.balance != null && Math.abs(t.r - cols.balance) < 25));
    if ((dates.length || month) && txAmts.length) {
      const amt = txAmts[0];
      const text = [...(month ? day.pre : []), ...toks.filter((t) => t !== amt && t !== dates[0] && t !== dates[1] && t !== month && (t.kind !== 'amount' || txAmts.includes(t))).map((t) => t.s)].join(' '); // running balance is not text
      const descTok = toks.find((t) => t.kind === 'text');
      cur = {
        date: month ? { d: day.d, m: MONTHS[month.s.replace('.', '').toLowerCase()], y: null } : dateParts(dates[0].s),
        valueDate: dates[1] ? dateParts(dates[1].s) : null,
        text, cents: signed(amt, cols), page: line.page, lastY: line.y, line: li,
        descX: descTok ? descTok.x : line.items[0].x,
      };
      st.rows.push(cur); used.add(li); day = null;
      continue;
    }
    // Years printed below the day/month dates ("14.08. 14.08." / "2023 2023 Name", Deutsche Bank; Trade Republic).
    let years = 0;
    while (cur && years < 2 && toks[years] && YEAR.test(toks[years].s) && toks[years].x < cur.descX - 3) years++;
    if (years) {
      cur.date.y ??= +toks[0].s;
      if (years > 1 && cur.valueDate) cur.valueDate.y ??= +toks[1].s;
      toks = toks.slice(years);
      if (!toks.length) { cur.lastY = line.y; used.add(li); continue; }
    }
    // Continuation of the purpose text: close below, same page, inside the text column.
    const firstText = toks.find((t) => t.kind !== 'date');
    if (cur && !amts.length && line.page === cur.page && cur.lastY - line.y <= line.h * 2.2
        && (!firstText || firstText.x >= cur.descX - 3)) {
      let rest = toks;
      if (rest[0] && rest[0].kind === 'date') {
        if (!cur.valueDate) cur.valueDate = dateParts(rest[0].s);
        rest = rest.slice(1);
      }
      let text = rest.map((t) => t.s).join(' ');
      const wert = /^(wertstellung|valuta|wert)\s*:?\s*(\d{2}\.\d{2}\.(\d{4}|\d{2})?)$/i.exec(text);
      if (wert) { if (!cur.valueDate) cur.valueDate = dateParts(wert[2]); text = ''; }
      if (text) cur.text += (cur.text ? ' ' : '') + text;
      cur.lastY = line.y; used.add(li);
      continue;
    }
    cur = null;
  }

  // Bank and account IBAN only from letterhead/footer lines; the legal footer may sit on the last page only.
  const chrome = (p) => lines.filter((l, i) => l.page === p && !used.has(i));
  st.bank = detectBank(chrome(1).map((l) => l.text).join('\n'));
  if (st.bank === 'unbekannt') st.bank = detectBank(chrome(pages).map((l) => l.text).join('\n'));
  // Labelled IBAN first; else any IBAN outside bookings (DKB "Girokonto 123, DE11 …", Deutsche Bank header row).
  const ibanLine = chrome(1).find((l) => /IBAN/i.test(l.text) && IBAN.test(l.text)) || chrome(1).find((l) => IBAN.test(l.text));
  if (ibanLine) st.iban = IBAN.exec(ibanLine.text)[1].replace(/ /g, '');

  const secs = subs.length ? [...subs, { opening: st.opening, closing: st.closing, rows: st.rows.slice(secStart) }] : [st];
  for (const s of secs) {
    resolveYears(s, lines, used);
    s.rows = s.rows.map(({ date, valueDate, text, cents, line }) => ({ date, valueDate: valueDate || date, text, cents, line })); // line: source line index, for diagnostics
    s.check = balanceCheck(s);
  }
  if (subs.length) {
    const [main, ...rest] = secs;
    Object.assign(st, { opening: main.opening, closing: main.closing, rows: main.rows, from: main.from, to: main.to, check: main.check });
    st.subAccounts = rest;
    st.warnings.push(`Das PDF enthält ${rest.length} weitere Unterkonten (z. B. N26 Spaces). Übernommen ist nur das Hauptkonto.`);
  }
  if (!st.rows.length) st.warnings.push('Keine Umsätze erkannt. Ist das PDF ein Scan ohne Textebene?');
  if (!st.iban) st.warnings.push('Keine IBAN des Kontos gefunden.');
  return st;
}

// Dates without year ("01.10.") get the year from the statement's full dates,
// handling a December→January turn.
function resolveYears(st, lines, used = new Set()) {
  const full = [];
  for (const l of lines) for (const m of l.text.matchAll(/\b\d{2}\.(\d{2})\.(\d{4})\b/g)) full.push({ m: +m[1], y: +m[2] });
  const head = [];
  // Two-digit years count in the head ("Datum 31.12.21", Consorsbank).
  // only letterhead lines: a purpose like "Rechnung vom 01.09.2026" must not set the year
  for (const l of lines.filter((l, i) => l.page === 1 && !used.has(i)).slice(0, 20)) for (const m of l.text.matchAll(/\b\d{2}\.(\d{2})\.(\d{4}|\d{2})\b/g)) head.push({ m: +m[1], y: m[2].length === 2 ? 2000 + +m[2] : +m[2] });
  const ref = st.closing?.date?.y ? st.closing.date : head[head.length - 1] || full[full.length - 1] || { y: new Date().getFullYear(), m: 12 };
  const fix = (d) => {
    if (!d) return null;
    let y = d.y ?? (d.m > ref.m + 1 ? ref.y - 1 : ref.y);
    return `${y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  };
  for (const r of st.rows) { r.date = fix(r.date); r.valueDate = fix(r.valueDate); }
  for (const b of [st.opening, st.closing]) if (b) b.date = fix(b.date);
  const ds = st.rows.map((r) => r.date).sort();
  st.from = ds[0] || st.opening?.date || null; // opening balance is dated the day before the first booking period
  st.to = st.closing?.date || ds[ds.length - 1] || null;
}

export function balanceCheck(st) {
  if (!st.opening || !st.closing) return { ok: false, reason: 'Anfangs- oder Endsaldo nicht gefunden' };
  const sum = st.rows.reduce((a, r) => a + r.cents, 0);
  const expected = st.opening.cents + sum;
  const diff = st.closing.cents - expected;
  return { ok: diff === 0, sum, expected, diff, reason: diff === 0 ? 'Saldo stimmt' : 'Saldo weicht ab' };
}
