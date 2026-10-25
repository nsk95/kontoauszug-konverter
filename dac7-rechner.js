// DAC7 / PStTG de-minimis check for goods: a seller is exempt only below BOTH 30 sales and 2,000 EUR per platform and year.
export function dac7(sales, revenue) {
  if (!(sales >= 0) || !(revenue >= 0)) return null;
  return { reported: sales >= 30 || revenue >= 2000, salesLeft: Math.max(0, 30 - Math.floor(sales)), euroLeft: Math.max(0, 2000 - revenue) };
}
const form = globalThis.document?.querySelector('#dac7');
if (form) {
  const out = document.querySelector('#dac7-ergebnis');
  const euro = (x) => x.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', () => {
    const [a, s] = ['#dac7-anzahl', '#dac7-summe'].map((id) => form.querySelector(id).value);
    const r = a === '' || s === '' ? null : dac7(Number(a), Number(s));
    out.innerHTML = !r ? '<b>Tragen Sie beide Werte ein.</b> Die Plattform meldet Sie, sobald eine der zwei Grenzen erreicht ist: 30 Verkäufe oder 2.000 €.'
      : r.reported ? '<b>Die Plattform meldet Ihre Verkäufe für dieses Jahr.</b> Mindestens eine Grenze (30 Verkäufe oder 2.000 €) ist erreicht. Das allein löst keine Steuer aus; lesen Sie die Hinweise unten.'
      : `<b>Unter beiden Grenzen: Für den Verkauf von Waren meldet diese Plattform Sie voraussichtlich nicht.</b> Bis zur Meldung fehlen noch ${r.salesLeft} Verkäufe oder ${euro(r.euroLeft)} Erlös, je nachdem, was zuerst erreicht ist.`;
  });
}
