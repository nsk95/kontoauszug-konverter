import { extractLines } from './lib/pdftext.js';
import { parseStatement } from './lib/parse.js';
import { toCSV, toCAMT, toMT940, toDATEV, DATEV_DEFAULTS } from './lib/export.js';
import { quotaLedger } from './lib/quota-client.js';

// pdf.js (~1.8 MB incl. worker) is fetched shortly after the page has loaded, off the critical
// rendering path. Once it is there (body[data-pdf=ready]), reading a statement needs no request at all.
let pdf;
const loadPdf = () => (pdf ||= import('./vendor/pdf.min.mjs').then((pdfjs) => {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  const worker = new pdfjs.PDFWorker();
  return worker.promise.then(() => {
    document.body.dataset.pdf = 'ready';
    document.getElementById('ready').textContent = 'Bereit: PDF-Verarbeitung lokal, neues Guthaben wird beim Export online geprüft';
    return { pdfjs, worker };
  });
}));
if (document.readyState === 'complete') setTimeout(loadPdf, 800);
else addEventListener('load', () => setTimeout(loadPdf, 800), { once: true });

const $ = (s, el = document) => el.querySelector(s);
const store = (() => { try { return window.localStorage; } catch { return { getItem: () => null, setItem() {} }; } })();
const lic = quotaLedger(store);
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
if (lic.legacy) $('#quota-note').textContent = 'Ihr bereits eingelöstes Guthaben bleibt wie bisher offline in diesem Browser nutzbar.';
const unlock = /^#freischalten=(.+)$/.exec(location.hash);
if (unlock) {
  history.replaceState(null, '', '#konverter');
  try { $('#code').value = decodeURIComponent(unlock[1]); } catch { $('#code').value = ''; }
  $('#code-panel').hidden = false;
  document.querySelector('[aria-controls="code-panel"]').setAttribute('aria-expanded', 'true');
  $('#code-panel').scrollIntoView();
}
$('#redeem').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await lic.redeem($('#code').value);
  $('#redeem-msg').textContent = r.ok ? (r.remaining == null ? `${r.pages} Seiten freigeschaltet.` : `Guthaben geöffnet: ${r.remaining} Seiten verfügbar. Erneutes Einlösen desselben Codes füllt es nicht erneut auf.`) : r.reason;
  if (r.ok) $('#code').value = '';
  showRemaining();
});
if (unlock && $('#code').value) $('#redeem').requestSubmit();

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

// The bundled fixture is synthetic and never spends the visitor's page allowance.
$('#show-example')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  try {
    const { demoPDF } = await import('./lib/demo-pdf.js');
    const bytes = Uint8Array.from(atob(demoPDF), c => c.charCodeAt(0));
    await handle([new File([bytes], 'Beispielauszug-erfundene-Daten.pdf', { type: 'application/pdf' })], true);
  } finally { button.disabled = false; }
});
// Search-intent guides can lead directly to a useful result without requesting a file.
if (location.hash === '#beispiel') {
  history.replaceState(null, '', '#konverter');
  $('#show-example').click();
}

async function handle(files, example = false) {
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
      render(card, file.name, st, hash, example);
    } catch (err) {
      $('.meta', card).textContent = 'Datei konnte nicht gelesen werden.';
      showWarn(card, String(err.message || err));
    }
  }
}

function showWarn(card, text) { const w = $('.warn', card); w.textContent = text; w.hidden = !text; }

function render(card, name, st, hash, example = false) {
  const c = st.check;
  $('.meta', card).textContent = `${st.bank} · ${st.iban || 'IBAN unbekannt'} · ${de(st.from)} – ${de(st.to)} · ${st.rows.length} Umsätze · ${st.pages} Seite(n)`;
  const badge = $('.badge', card);
  badge.className = `badge ${c.ok ? 'ok' : 'bad'}`;
  badge.textContent = c.ok ? 'Saldo stimmt' : 'Saldo stimmt nicht';
  badge.title = c.ok
    ? `${money(st.opening.cents)} + ${money(c.sum)} = ${money(st.closing.cents)}`
    : c.diff != null ? `Erwartet ${money(c.expected)}, Auszug sagt ${money(st.closing.cents)}, Differenz ${money(c.diff)}` : c.reason;
  const warns = [...st.warnings];
  if (example) warns.unshift('Beispiel mit erfundenen Daten. Auch der Download dieses Beispiels ist kostenlos und verbraucht keine Gratisseiten.');
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
  let busy = false;
  card.addEventListener('click', async (e) => {
    const fmt = e.target.dataset?.fmt;
    if (!fmt || busy) return;
    const msg = $('.msg', card);
    if (!c.ok && (fmt === 'camt' || fmt === 'mt940')) {
      msg.textContent = 'CAMT und MT940 brauchen einen stimmigen Saldo. Bitte den Auszug prüfen.';
      return;
    }
    if (!c.ok && !confirm('Der Saldo stimmt nicht. Trotzdem exportieren?')) return;
    busy = true;
    for (const button of card.querySelectorAll('[data-fmt]')) button.disabled = true;
    try {
      const [data, file, type] = formats[fmt](); // build first: a failed export must not cost pages
      if (!example && !await lic.charge(hash, st.pages)) {
        msg.textContent = `Dieser Auszug hat ${st.pages} Seiten, Ihr Guthaben reicht noch für ${Math.max(0, lic.remaining())}. Ihre Vorschau bleibt erhalten. `;
        const offer = Object.assign(document.createElement('a'), { href: '#preise', textContent: '50 weitere Seiten für 9 € ansehen' });
        msg.append(offer);
        return;
      }
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([data], { type })), download: file });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      msg.textContent = `${file} gespeichert.`;
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      busy = false;
      for (const button of card.querySelectorAll('[data-fmt]')) button.disabled = false;
      showRemaining();
    }
  });
}
