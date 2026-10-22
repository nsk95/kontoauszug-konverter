// Extract positioned text lines from a PDF with pdf.js. Works in browser and Node:
// the caller passes the pdf.js module so this file has no import-time dependency.

// Items whose baselines differ by less than 0.4 × font height belong to one line;
// items closer than 0.15 × font height horizontally are one word (glyph-wise PDFs).
const Y_TOL = 0.4, GLUE = 0.15;

// worker: optional shared pdf.js PDFWorker, so the worker script is loaded once up front.
export async function extractLines(pdfjs, data, worker) {
  const task = pdfjs.getDocument({
    data,
    worker,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const rows = [];
    for (const it of items) {
      const s = it.str.trim();
      if (!s) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || 8;
      let row = rows.find((r) => Math.abs(r.y - y) <= Y_TOL * Math.max(h, r.h));
      if (!row) rows.push((row = { page: p, y, h, items: [] }));
      row.items.push({ s, x, r: x + it.width, sp: /\s$/.test(it.str) }); // sp: trailing space was trimmed
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      r.items = r.items.reduce((out, it) => {
        const prev = out[out.length - 1];
        if (prev && !prev.sp && it.x - prev.r < GLUE * r.h && it.x >= prev.x) {
          prev.s += it.s; prev.r = Math.max(prev.r, it.r); prev.sp = it.sp;
        } else out.push({ ...it });
        return out;
      }, []);
      r.text = r.items.map((i) => i.s).join(' ');
      lines.push(r);
    }
  }
  const pages = doc.numPages;
  await task.destroy();
  return { lines, pages };
}
