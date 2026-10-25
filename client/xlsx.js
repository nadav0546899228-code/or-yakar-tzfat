// קריאה וכתיבה של קבצי Excel (xlsx) בדפדפן, בלי ספריות כבדות. קובץ xlsx הוא zip של קבצי XML
import JSZip from 'jszip';

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const colName = (i) => { let s = ''; let n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// כתיבה: headers = מערך כותרות, rows = מערך מערכים. גיליון מימין לשמאל, שורת כותרת מודגשת
export async function writeXlsx(filename, headers, rows, sheetName = 'נתונים') {
  const all = [headers, ...rows];
  const sheetRows = all.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${colName(ci)}${ri + 1}`;
    const style = ri === 0 ? ' s="1"' : '';
    if (v === null || v === undefined || v === '') return `<c r="${ref}"${style}/>`;
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const widths = headers.map((h, i) => Math.min(45, Math.max(10, ...all.map((r) => String(r[i] ?? '').length + 2))));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16357A"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData></worksheet>`);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// קריאה: מחזיר מערך אובייקטים לפי שורת הכותרת של הגיליון הראשון
export async function readXlsx(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
  const shared = [];
  const ss = zip.file('xl/sharedStrings.xml');
  if (ss) parse(await ss.async('string')).querySelectorAll('si').forEach((si) => shared.push([...si.querySelectorAll('t')].map((t) => t.textContent).join('')));
  const wbRels = zip.file('xl/_rels/workbook.xml.rels');
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (wbRels) {
    const wb = parse(await zip.file('xl/workbook.xml').async('string'));
    const first = wb.getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') || first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = [...parse(await wbRels.async('string')).getElementsByTagName('Relationship')].find((x) => x.getAttribute('Id') === rid);
    if (rel) sheetPath = `xl/${rel.getAttribute('Target').replace(/^\/?xl\//, '')}`;
  }
  const sheet = parse(await zip.file(sheetPath).async('string'));
  const grid = [];
  sheet.querySelectorAll('sheetData row').forEach((row) => {
    const out = [];
    row.querySelectorAll('c').forEach((c) => {
      const ref = c.getAttribute('r') || '';
      const letters = ref.replace(/\d+/g, '');
      let idx = 0; for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64); idx -= 1;
      const t = c.getAttribute('t');
      let v = '';
      if (t === 's') v = shared[Number(c.querySelector('v')?.textContent)] ?? '';
      else if (t === 'inlineStr') v = [...c.querySelectorAll('t')].map((x) => x.textContent).join('');
      else v = c.querySelector('v')?.textContent ?? '';
      out[idx >= 0 ? idx : out.length] = v;
    });
    grid.push(out);
  });
  const nonEmpty = grid.filter((r) => r && r.some((x) => String(x ?? '').trim() !== ''));
  if (!nonEmpty.length) return [];
  const head = nonEmpty[0].map((h) => String(h ?? '').trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']).filter(([h]) => h)));
}

// קריאת CSV (עם תמיכה בגרשיים ובקידוד עברי ישן)
export async function readCsv(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) { try { text = new TextDecoder('windows-1255').decode(buf); } catch { /* */ } }
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const split = (l) => { const out = []; let cur = ''; let q = false; for (let i = 0; i < l.length; i += 1) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i += 1; } else q = !q; } else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((s) => s.trim()); };
  const head = split(lines[0] || '');
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v]).filter(([h]) => h)));
}

export async function readSheet(file) {
  return /\.xlsx$/i.test(file.name) ? readXlsx(file) : readCsv(file);
}
