import { extractLines } from './lib/pdftext.js';
import { parseStatement } from './lib/parse.js';
import { toCSV, toCAMT, toMT940, toDATEV, DATEV_DEFAULTS } from './lib/export.js';
import { ledger } from './lib/license.js';

// pdf.js (~1.8 MB incl. worker) is fetched shortly after the page has loaded, off the critical
// rendering path. Once it is there (body[data-pdf=ready]), reading a statement needs no request at all.
let pdf;
const loadPdf = () => (pdf ||= import('./vendor/pdf.min.mjs').then((pdfjs) => {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  const worker = new pdfjs.PDFWorker();
  return worker.promise.then(() => {
    document.body.dataset.pdf = 'ready';
    document.getElementById('ready').textContent = 'Bereit: arbeitet ab jetzt auch offline';
    return { pdfjs, worker };
  });
}));
if (document.readyState === 'complete') setTimeout(loadPdf, 800);
else addEventListener('load', () => setTimeout(loadPdf, 800), { once: true });

const $ = (s, el = document) => el.querySelector(s);
const store = (() => { try { return window.localStorage; } catch { return { getItem: () => null, setItem() {} }; } })();
const lic = ledger(store);
const money = (c) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const de = (iso) => (iso ? iso.split('-').reverse().join('.') : '–');

// ---------- DATEV settings (remembered per browser) ----------
const datevOpt = (() => { try { return { ...DATEV_DEFAULTS, ...JSON.parse(store.getItem('kk-datev') || '{}') }; } catch { return { ...DATEV_DEFAULTS }; } })();
for (const input of document.querySelectorAll('[data-datev]')) {
  input.value = datevOpt[input.dataset.datev];
  input.addEventListener('change', () => {
    datevOpt[input.dataset.datev] = input.value.trim();
    try { store.setItem('kk-datev', JSON.stringify(datevOpt)); } catch { /* not persisted */ }
  });
}

// ---------- licence ----------
const showRemaining = () => { $('#remaining').textContent = Math.max(0, lic.remaining()); };
showRemaining();
$('#redeem').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await lic.redeem($('#code').value);
  $('#redeem-msg').textContent = r.ok ? `${r.pages} Seiten freigeschaltet.` : r.reason;
  if (r.ok) $('#code').value = '';
  showRemaining();
});

// ---------- panels (DATEV settings, unlock code) ----------
for (const b of document.querySelectorAll('[aria-controls]')) {
  b.addEventListener('click', () => {
    const panel = document.getElementById(b.getAttribute('aria-controls'));
    panel.hidden = !panel.hidden;
    b.setAttribute('aria-expanded', String(!panel.hidden));
  });
}

// ---------- files ----------
// Listen on the whole window: a PDF dropped next to the zone would otherwise be opened by the browser.
const drop = $('#drop');
addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); loadPdf(); });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('over'); });
addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handle([...e.dataTransfer.files]); });
$('#file').addEventListener('change', (e) => { handle([...e.target.files]); e.target.value = ''; }); // copy: resetting value empties the FileList

async function handle(files) {
  for (const file of files) {
    const card = $('#card').content.firstElementChild.cloneNode(true);
    $('.name', card).textContent = file.name;
    $('.meta', card).textContent = 'wird gelesen …';
    $('#results').prepend(card);
    card.scrollIntoView({ block: 'nearest' });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const { pdfjs, worker } = await loadPdf();
      const st = parseStatement(await extractLines(pdfjs, bytes.slice(), worker));
      render(card, file.name, st, hash);
    } catch (err) {
      $('.meta', card).textContent = 'Datei konnte nicht gelesen werden.';
      showWarn(card, String(err.message || err));
    }
  }
}

function showWarn(card, text) { const w = $('.warn', card); w.textContent = text; w.hidden = !text; }

function render(card, name, st, hash) {
  const c = st.check;
  $('.meta', card).textContent = `${st.bank} · ${st.iban || 'IBAN unbekannt'} · ${de(st.from)} – ${de(st.to)} · ${st.rows.length} Umsätze · ${st.pages} Seite(n)`;
  const badge = $('.badge', card);
  badge.className = `badge ${c.ok ? 'ok' : 'bad'}`;
  badge.textContent = c.ok ? 'Saldo stimmt' : 'Saldo stimmt nicht';
  badge.title = c.ok
    ? `${money(st.opening.cents)} + ${money(c.sum)} = ${money(st.closing.cents)}`
    : c.diff != null ? `Erwartet ${money(c.expected)}, Auszug sagt ${money(st.closing.cents)}, Differenz ${money(c.diff)}` : c.reason;
  const warns = [...st.warnings];
  if (!c.ok) warns.unshift(c.diff != null
    ? `Anfangssaldo + Umsätze ergibt ${money(c.expected)}, der Auszug nennt ${money(st.closing.cents)} (Differenz ${money(c.diff)}). Vermutlich fehlt ein Umsatz oder wurde falsch gelesen.`
    : c.reason + '.');
  showWarn(card, warns.join(' '));

  const tbody = $('tbody', card);
  for (const r of st.rows) {
    const tr = document.createElement('tr');
    for (const [v, cls] of [[de(r.date)], [de(r.valueDate)], [r.text], [money(r.cents), r.cents < 0 ? 'num neg' : 'num']]) {
      const td = document.createElement('td'); td.textContent = v; if (cls) td.className = cls; tr.append(td);
    }
    tbody.append(tr);
  }

  const base = name.replace(/\.pdf$/i, '');
  const formats = {
    csv: () => [toCSV(st), `${base}.csv`, 'text/csv;charset=utf-8'],
    camt: () => [toCAMT(st), `${base}.camt053.xml`, 'application/xml'],
    mt940: () => [toMT940(st), `${base}.sta`, 'text/plain'],
    datev: () => [toDATEV(st, datevOpt), `EXTF_Buchungsstapel_${base}.csv`, 'text/csv;charset=windows-1252'],
  };
  card.addEventListener('click', (e) => {
    const fmt = e.target.dataset?.fmt;
    if (!fmt) return;
    const msg = $('.msg', card);
    if (!c.ok && (fmt === 'camt' || fmt === 'mt940')) {
      msg.textContent = 'CAMT und MT940 brauchen einen stimmigen Saldo. Bitte den Auszug prüfen.';
      return;
    }
    if (!c.ok && !confirm('Der Saldo stimmt nicht. Trotzdem exportieren?')) return;
    try {
      const [data, file, type] = formats[fmt](); // build first: a failed export must not cost pages
      if (!lic.charge(hash, st.pages)) {
        msg.textContent = `Für diesen Auszug fehlen Seiten (${st.pages} nötig, ${Math.max(0, lic.remaining())} übrig). Seitenpakete folgen in Kürze.`;
        return;
      }
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([data], { type })), download: file });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      msg.textContent = `${file} gespeichert.`;
    } catch (err) {
      msg.textContent = err.message;
    }
    showRemaining();
  });
}
