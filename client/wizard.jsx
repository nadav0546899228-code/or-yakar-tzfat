// אשף הגדרת האתר הציבורי: עריכה צעד-אחר-צעד של הגדרות org / theme / site הקיימות (אותן נקודות קצה של מסך המתכנת)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, run, toast, Field, Spinner, ErrorBox, useUnsaved, confirmDialog, Link } from './lib.jsx';
import { Icon } from './icons.jsx';

const STEPS = [
  { key: 'org', title: 'פרטי העמותה', icon: 'building' },
  { key: 'brand', title: 'לוגו וצבעים', icon: 'sparkle' },
  { key: 'texts', title: 'טקסטים', icon: 'pen' },
  { key: 'images', title: 'תמונות וגלריות', icon: 'eye' },
  { key: 'summary', title: 'סיכום', icon: 'check' },
];

const PAGE_LABELS = { home: 'דף הבית', story: 'סיפור הקהילה', rabbi: 'ראש הישיבה', mostod: 'מוסדות וליווי', assistance: 'סיוע ותרומה', classes: 'שיעורים', ahuza: 'אחוזת קורדוברו', contact: 'צרו קשר', terms: 'תקנון' };
const THEME_LABELS = { primary: 'צבע ראשי', primary_dark: 'ראשי כהה', accent: 'הדגשה (זהב)', sky: 'רקע בהיר', ink: 'צבע טקסט' };
const SOCIAL = [['facebook', 'פייסבוק'], ['instagram', 'אינסטגרם'], ['youtube', 'יוטיוב'], ['tiktok', 'טיקטוק']];
const MAX_LOGO = 1.5 * 1024 * 1024;

// ---------- בדיקות רכות (אזהרה בלבד, לא חוסמות שמירה) ----------
const digits = (s) => String(s || '').replace(/\D/g, '');
function phoneWarn(v) {
  if (!v) return null;
  const d = digits(v);
  if (/^972\d{8,9}$/.test(d) || /^0\d{8,9}$/.test(d) || /^1[5-9]00\d{6}$/.test(d)) return null;
  return 'מספר הטלפון לא נראה תקין (לדוגמה 04-6923515 או 052-5080979)';
}
function emailWarn(v) {
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim()) ? null : 'כתובת המייל לא נראית תקינה';
}
function urlWarn(v, { allowData = false } = {}) {
  if (!v) return null;
  const s = String(v).trim();
  if (allowData && /^data:image\//.test(s)) return null;
  if (s.startsWith('/')) return null;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? (u.protocol === 'http:' ? 'מומלץ קישור מאובטח (https)' : null) : 'הקישור צריך להתחיל ב-https://'; } catch { return 'הקישור לא נראה תקין (צריך להתחיל ב-https://)'; }
}

// ---------- עזרי עריכה בלתי-משתנה ----------
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
function setIn(obj, path, value) {
  const out = clone(obj);
  let cur = out;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  cur[path[path.length - 1]] = value;
  return out;
}

// ---------- צבעים ----------
const hex2rgb = (h) => { const m = String(h || '').replace('#', ''); const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m.padEnd(6, '0'); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0); };
const rgb2hex = (r, g, b) => `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => { const x = hex2rgb(a); const y = hex2rgb(b); return rgb2hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); };
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min; const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}
const lum = (h) => { const [r, g, b] = hex2rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// דגימת צבעים דומיננטיים מהלוגו בקנבס (בצד הלקוח בלבד)
function extractColors(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 72;
        const c = document.createElement('canvas');
        const ratio = Math.min(size / img.naturalWidth, size / img.naturalHeight, 1) || 1;
        c.width = Math.max(1, Math.round(img.naturalWidth * ratio));
        c.height = Math.max(1, Math.round(img.naturalHeight * ratio));
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, c.width, c.height);
        const { data } = g.getImageData(0, 0, c.width, c.height);
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 160) continue; // שקוף
          const r = data[i]; const gg = data[i + 1]; const b = data[i + 2];
          const [, s, l] = hsl([r, gg, b]);
          if (l > 0.93 || l < 0.06 || (s < 0.12 && l > 0.8)) continue; // לבן / שחור / אפור בהיר - רקע
          const k = `${r >> 4},${gg >> 4},${b >> 4}`;
          const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
          e.n++; e.r += r; e.g += gg; e.b += b;
          buckets.set(k, e);
        }
        const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).map((e) => rgb2hex(e.r / e.n, e.g / e.n, e.b / e.n));
        const picked = [];
        for (const col of sorted) {
          const [r1, g1, b1] = hex2rgb(col);
          if (picked.every((p) => { const [r2, g2, b2] = hex2rgb(p); return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) > 90; })) picked.push(col);
          if (picked.length >= 6) break;
        }
        resolve(picked);
      } catch {
        reject(new Error('הדפדפן חסם קריאת צבעים מהלוגו (השרת של התמונה לא מאפשר זאת). העלו את הלוגו כקובץ ונסו שוב'));
      }
    };
    img.onerror = () => reject(new Error('לא ניתן לטעון את הלוגו'));
    img.src = src;
  });
}

function suggestTheme(colors) {
  if (!colors.length) return null;
  // ראשי: הצבע הדומיננטי הכהה/רווי ביותר שעדיין קריא על לבן; הדגשה: צבע עם גוון שונה
  const scored = colors.map((c) => ({ c, hsl: hsl(hex2rgb(c)), cr: contrast(c, '#ffffff') }));
  let primary = scored.find((x) => x.cr >= 4.5 && x.hsl[1] > 0.2) || scored.find((x) => x.cr >= 3) || scored[0];
  let p = primary.c;
  if (contrast(p, '#ffffff') < 4.5) p = mix(p, '#000000', 0.35);
  const ph = primary.hsl[0];
  const accentC = scored.filter((x) => x !== primary && x.hsl[1] > 0.25).sort((a, b) => {
    const da = Math.min(Math.abs(a.hsl[0] - ph), 1 - Math.abs(a.hsl[0] - ph));
    const db = Math.min(Math.abs(b.hsl[0] - ph), 1 - Math.abs(b.hsl[0] - ph));
    return db - da;
  })[0];
  return {
    primary: p,
    primary_dark: mix(p, '#000000', 0.38),
    accent: accentC ? accentC.c : '#c8a24a',
    sky: mix(p, '#ffffff', 0.91),
    ink: mix(p, '#000000', 0.62),
  };
}

// ---------- רכיבי עזר ----------
const CSS = `
.wz-steps { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
.wz-step { flex: 1 0 auto; display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); background: #fff; border-radius: 12px; padding: 8px 12px; cursor: pointer; font: inherit; color: var(--ink); min-height: 44px; }
.wz-step .wz-num { width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: #eef1f6; font-weight: 700; font-size: 13px; flex: none; }
.wz-step.on { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(22,53,122,.1); }
.wz-step.on .wz-num { background: var(--primary); color: #fff; }
.wz-step.done .wz-num { background: #e3f5ea; color: #1f8a4c; }
.wz-bar { height: 6px; border-radius: 99px; background: #eef1f6; overflow: hidden; margin-top: 10px; }
.wz-bar > i { display: block; height: 100%; background: var(--primary); transition: width .3s; }
.wz-nav { position: sticky; bottom: 0; background: linear-gradient(transparent, var(--bg, #f5f7fb) 30%); padding: 14px 0 8px; display: flex; gap: 8px; align-items: center; z-index: 5; }
.wz-swatch { border-radius: 14px; overflow: hidden; border: 1px solid var(--line); }
.wz-list-item { display: flex; gap: 8px; align-items: center; border: 1px solid var(--line); border-radius: 10px; padding: 6px; background: #fff; }
.wz-list-item img { width: 64px; height: 48px; object-fit: cover; border-radius: 6px; background: #eef1f6; flex: none; }
.wz-section { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: #fbfcfe; }
.wz-warn { color: #8a5a00; font-size: 12.5px; }
@media (max-width: 700px) {
  .wz-step .wz-lbl { display: none; }
  .wz-step.on .wz-lbl { display: inline; }
  .wz-nav .btn { flex: 1; }
  .wz-list-item { flex-wrap: wrap; }
}
`;

function Warn({ msg }) { return msg ? <span className="wz-warn">⚠ {msg}</span> : null; }

function TextInput({ label, value, onChange, warn, ltr, full, hint, area, rows = 3, placeholder }) {
  return (
    <Field label={label} full={full} hint={hint}>
      {area
        ? <textarea className="input" rows={rows} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        : <input className="input" dir={ltr ? 'ltr' : undefined} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
      <Warn msg={warn} />
    </Field>
  );
}

function ImgThumb({ src }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  if (!src) return <img alt="" />;
  return bad ? <span style={{ width: 64, height: 48, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#fde8e8', borderRadius: 6, fontSize: 11, color: '#c53030', flex: 'none' }}>לא נטען</span>
    : <img src={src} alt="" loading="lazy" onError={() => setBad(true)} />;
}

// ---------- צעד 1: פרטי העמותה ----------
function StepOrg({ org, setOrg }) {
  const set = (k) => (v) => setOrg({ ...org, [k]: v });
  const phones = Array.isArray(org.phones) ? org.phones : [];
  const social = org.social || {};
  return (
    <div className="stack">
      <div className="card">
        <h3>שמות</h3>
        <div className="form-grid">
          <TextInput label="שם מלא" value={org.name} onChange={set('name')} hint="מופיע בכותרת הדפדפן ובדף הבית" />
          <TextInput label="שם קצר" value={org.short_name} onChange={set('short_name')} hint="בתחתית האתר ובתפריט" />
          <TextInput label="שם משפטי" value={org.legal_name} onChange={set('legal_name')} hint="בשורת זכויות היוצרים ובקבלות" />
          {'tagline' in org && <TextInput label="סלוגן" value={org.tagline} onChange={set('tagline')} full />}
        </div>
      </div>
      <div className="card">
        <h3>יצירת קשר</h3>
        <div className="form-grid">
          {phones.map((p, i) => (
            <Field key={i} label={`טלפון ${i + 1}`}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input className="input" dir="ltr" inputMode="tel" value={p} onChange={(e) => setOrg({ ...org, phones: phones.map((x, j) => (j === i ? e.target.value : x)) })} />
                <button type="button" className="btn ghost icon" aria-label="הסרת טלפון" onClick={() => setOrg({ ...org, phones: phones.filter((_, j) => j !== i) })}><Icon name="x" size={16} /></button>
              </div>
              <Warn msg={phoneWarn(p)} />
            </Field>
          ))}
          <div className="field" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setOrg({ ...org, phones: [...phones, ''] })}><Icon name="plus" size={16} />הוספת טלפון</button></div>
          <TextInput label="וואטסאפ" ltr value={org.whatsapp} onChange={set('whatsapp')} warn={phoneWarn(org.whatsapp)} />
          <TextInput label="מייל" ltr value={org.email} onChange={set('email')} warn={emailWarn(org.email)} />
          <TextInput label="פקס" ltr value={org.fax} onChange={set('fax')} warn={phoneWarn(org.fax)} />
          <TextInput label="כתובת" value={org.address} onChange={set('address')} />
          {'po_box' in org && <TextInput label="תא דואר" value={org.po_box} onChange={set('po_box')} />}
        </div>
      </div>
      <div className="card">
        <h3>תרומות</h3>
        <div className="form-grid">
          <TextInput label="מספר מוסד בנדרים פלוס" ltr value={org.nedarim_mosad} onChange={set('nedarim_mosad')} warn={org.nedarim_mosad && !/^\d{4,10}$/.test(String(org.nedarim_mosad).trim()) ? 'מספר מוסד מכיל ספרות בלבד' : null} />
          <TextInput label="קישור לדף התרומה" ltr full value={org.donation_url} onChange={set('donation_url')} warn={urlWarn(org.donation_url)} hint="הכפתור 'תרומה לקהילה' באתר מוביל לכאן" />
        </div>
      </div>
      <div className="card">
        <h3>רשתות חברתיות <span className="small muted">(רשות)</span></h3>
        <div className="form-grid">
          {SOCIAL.map(([k, l]) => <TextInput key={k} label={l} ltr value={social[k]} placeholder="https://" onChange={(v) => setOrg({ ...org, social: { ...social, [k]: v } })} warn={urlWarn(social[k])} />)}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>הקישורים נשמרים בהגדרות העמותה ויוצגו באתר כאשר התבנית תתמוך בהם.</p>
      </div>
    </div>
  );
}

// ---------- צעד 2: לוגו וצבעים ----------
function StepBrand({ org, setOrg, theme, setTheme }) {
  const fileRef = useRef();
  const [suggest, setSuggest] = useState(null);
  const [busy, setBusy] = useState(false);
  const onFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('יש לבחור קובץ תמונה', 'error'); return; }
    if (f.size > MAX_LOGO) { toast('הקובץ גדול מ-1.5MB. מומלץ להקטין אותו או להעלות לאחסון ולהדביק קישור', 'error'); return; }
    const r = new FileReader();
    r.onload = () => { setOrg({ ...org, logo_url: r.result }); setSuggest(null); };
    r.readAsDataURL(f);
  };
  const extract = async () => {
    if (!org.logo_url) { toast('אין לוגו לדגימה', 'error'); return; }
    setBusy(true);
    try {
      const cols = await extractColors(org.logo_url);
      if (!cols.length) { toast('לא נמצאו צבעים בולטים בלוגו', 'error'); return; }
      setSuggest({ colors: cols, theme: suggestTheme(cols) });
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const isData = String(org.logo_url || '').startsWith('data:');
  const t = theme;
  return (
    <div className="stack">
      <div className="card">
        <h3>לוגו</h3>
        <div className="form-grid">
          <Field label="כתובת הלוגו" full hint={isData ? `הלוגו הועלה כקובץ ונשמר בהגדרות (${Math.round(org.logo_url.length * 0.75 / 1024)}KB)` : 'הדביקו קישור לתמונה, או העלו קובץ (עד 1.5MB)'}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input" dir="ltr" value={isData ? '(קובץ שהועלה)' : (org.logo_url || '')} readOnly={isData} onChange={(e) => setOrg({ ...org, logo_url: e.target.value })} />
              {isData && <button type="button" className="btn" onClick={() => setOrg({ ...org, logo_url: '' })}>ניקוי</button>}
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}><Icon name="download" size={16} style={{ transform: 'rotate(180deg)' }} />העלאה</button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
            </div>
            {!isData && <Warn msg={urlWarn(org.logo_url)} />}
          </Field>
          {org.logo_url && <div className="full" style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 12, height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><img src={org.logo_url} alt="לוגו" style={{ height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain' }} /></div>}
          {'icon_url' in org && <TextInput label="סמל קטן (אייקון לדפדפן ולטלפון)" ltr full value={org.icon_url} onChange={(v) => setOrg({ ...org, icon_url: v })} warn={urlWarn(org.icon_url, { allowData: true })} />}
        </div>
      </div>
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>צבעים</h3>
          <button type="button" className="btn sm" disabled={busy || !org.logo_url} onClick={extract}><Icon name="sparkle" size={16} />{busy ? 'דוגם…' : 'הצעת צבעים מהלוגו'}</button></div>
        {suggest && (
          <div className="notice" style={{ marginTop: 10 }}>
            <div className="row">
              <span className="small">צבעים שנמצאו בלוגו:</span>
              {suggest.colors.map((c) => <span key={c} title={c} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: '1px solid rgba(0,0,0,.15)' }} />)}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="small">הצעה:</span>
              {Object.entries(suggest.theme).map(([k, c]) => <span key={k} className="small row" style={{ gap: 4 }}><span style={{ width: 18, height: 18, borderRadius: 5, background: c, border: '1px solid rgba(0,0,0,.15)' }} />{THEME_LABELS[k]}</span>)}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn sm primary" onClick={() => { setTheme({ ...theme, ...suggest.theme }); setSuggest(null); toast('הצבעים הוחלו - אפשר לכוונן ידנית', 'ok'); }}>החלת ההצעה</button>
              <button type="button" className="btn sm ghost" onClick={() => setSuggest(null)}>ביטול</button>
            </div>
          </div>
        )}
        <div className="form-grid" style={{ marginTop: 12 }}>
          {Object.entries(THEME_LABELS).filter(([k]) => k in theme).map(([k, l]) => (
            <Field key={k} label={l}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="color" className="input" style={{ width: 56, padding: 4, flex: 'none' }} value={/^#[0-9a-f]{6}$/i.test(t[k]) ? t[k] : '#000000'} onChange={(e) => setTheme({ ...theme, [k]: e.target.value })} aria-label={l} />
                <input className="input num" dir="ltr" value={t[k] || ''} onChange={(e) => setTheme({ ...theme, [k]: e.target.value })} />
              </div>
              <Warn msg={t[k] && !/^#[0-9a-f]{6}$/i.test(t[k]) ? 'פורמט צבע: #RRGGBB' : null} />
            </Field>
          ))}
        </div>
        {contrast(t.primary, '#ffffff') < 4.5 && <div className="notice warn" style={{ marginTop: 10 }}>הצבע הראשי בהיר מדי לטקסט לבן על גביו (ניגודיות {contrast(t.primary, '#ffffff').toFixed(1)}:1, מומלץ לפחות 4.5:1).</div>}
        <h3 style={{ marginTop: 16 }}>תצוגה מקדימה</h3>
        <div className="wz-swatch" aria-label="תצוגה מקדימה של הצבעים">
          <div style={{ background: t.primary, color: '#fff', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            {org.logo_url && <span style={{ background: '#fff', borderRadius: 8, padding: 3, height: 32, display: 'inline-flex' }}><img src={org.logo_url} alt="" style={{ height: '100%', width: 'auto' }} /></span>}
            <b>{org.short_name || org.name || 'שם העמותה'}</b>
            <span style={{ flex: 1 }} />
            <span style={{ background: t.accent, color: '#1b1300', padding: '5px 12px', borderRadius: 8, fontWeight: 600, fontSize: 13 }}>תרומה לקהילה</span>
          </div>
          <div style={{ background: t.sky, color: t.ink, padding: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.primary_dark }}>{org.tagline || 'כותרת לדוגמה'}</div>
            <p style={{ margin: '6px 0 12px', fontSize: 14 }}>כך ייראה טקסט רגיל באתר, על רקע בהיר.</p>
            <span style={{ background: t.primary, color: '#fff', padding: '6px 14px', borderRadius: 8, fontSize: 13, display: 'inline-block' }}>כפתור ראשי</span>
          </div>
          <div style={{ background: t.primary_dark, color: '#fff', padding: '8px 14px', fontSize: 12 }}>תחתית האתר · {org.legal_name || ''}</div>
        </div>
      </div>
    </div>
  );
}

// ---------- צעד 3: טקסטים ----------
const SECTION_TEXT_KEYS = [['heading', 'כותרת'], ['sub', 'כותרת משנה'], ['text', 'טקסט', true], ['quote', 'ציטוט', true], ['cite', 'מקור הציטוט']];

function StepTexts({ site, setSite, page, setPage }) {
  const pages = site?.pages || {};
  const keys = Object.keys(pages);
  const p = pages[page];
  const set = (path) => (v) => setSite(setIn(site, ['pages', page, ...path], v));
  if (!p) return <div className="empty">אין עמודים בהגדרות האתר</div>;
  return (
    <div className="stack">
      <div className="card">
        <Field label="עמוד לעריכה">
          <select className="input" value={page} onChange={(e) => setPage(e.target.value)}>
            {keys.map((k) => <option key={k} value={k}>{PAGE_LABELS[k] || pages[k].title || k}</option>)}
          </select>
        </Field>
        <div className="form-grid" style={{ marginTop: 12 }}>
          {'title' in p && <TextInput label={page === 'home' ? 'כותרת ראשית (Hero)' : 'כותרת העמוד'} value={p.title} onChange={set(['title'])} full />}
          {'kicker' in p && <TextInput label={page === 'home' ? 'כותרת משנה (Hero)' : 'שורת משנה'} value={p.kicker} onChange={set(['kicker'])} full area rows={2} />}
        </div>
      </div>
      {(p.sections || []).map((s, i) => {
        const fields = SECTION_TEXT_KEYS.filter(([k]) => typeof s[k] === 'string');
        const hasCards = Array.isArray(s.cards);
        const hasLink = s.link && typeof s.link.label === 'string';
        if (!fields.length && !hasCards && !hasLink) return null;
        return (
          <div key={i} className="wz-section">
            <div className="small muted" style={{ marginBottom: 6 }}>מקטע {i + 1}{s.heading ? ` · ${s.heading}` : s.quote ? ' · ציטוט' : ''}</div>
            <div className="form-grid">
              {fields.map(([k, l, area]) => <TextInput key={k} label={l} value={s[k]} onChange={set(['sections', i, k])} area={area} rows={k === 'text' ? Math.min(10, Math.max(3, Math.ceil((s[k] || '').length / 90))) : 2} full={area} />)}
              {hasLink && <TextInput label="טקסט הכפתור" value={s.link.label} onChange={set(['sections', i, 'link', 'label'])} />}
            </div>
            {hasCards && s.cards.map((c, j) => (
              <div key={j} className="form-grid" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
                {typeof c.title === 'string' && <TextInput label={`כרטיס ${j + 1} - כותרת`} value={c.title} onChange={set(['sections', i, 'cards', j, 'title'])} />}
                {typeof c.text === 'string' && <TextInput label={`כרטיס ${j + 1} - טקסט`} value={c.text} onChange={set(['sections', i, 'cards', j, 'text'])} area rows={2} full />}
              </div>
            ))}
          </div>
        );
      })}
      <p className="small muted">הוספה או מחיקה של מקטעים, אפשרויות תרומה, קבצי שמע ועוד - במסך המתכנת (עריכה מתקדמת).</p>
    </div>
  );
}

// ---------- צעד 4: תמונות ----------
function UrlList({ items, onChange }) {
  const [add, setAdd] = useState('');
  const move = (i, d) => { const a = [...items]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };
  const doAdd = () => {
    const v = add.trim();
    if (!v) return;
    if (items.includes(v)) { toast('התמונה כבר ברשימה', 'error'); return; }
    onChange([...items, v]); setAdd('');
  };
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      {items.length === 0 && <div className="small muted">הגלריה ריקה</div>}
      {items.map((u, i) => (
        <div key={`${i}-${u}`} className="wz-list-item">
          <ImgThumb src={u} />
          <input className="input" dir="ltr" style={{ flex: 1, minWidth: 140 }} value={u} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`תמונה ${i + 1}`} />
          <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <button type="button" className="btn sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="הזזה למעלה">▲</button>
            <button type="button" className="btn sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="הזזה למטה">▼</button>
            <button type="button" className="btn sm danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="הסרה"><Icon name="x" size={14} /></button>
          </div>
          {urlWarn(u) && <div style={{ flexBasis: '100%' }}><Warn msg={urlWarn(u)} /></div>}
        </div>
      ))}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input className="input" dir="ltr" placeholder="https://… קישור לתמונה" value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } }} />
        <button type="button" className="btn" onClick={doAdd}><Icon name="plus" size={16} />הוספה</button>
      </div>
    </div>
  );
}

function StepImages({ org, setOrg, site, setSite }) {
  const pages = site?.pages || {};
  const blocks = [];
  for (const [pk, p] of Object.entries(pages)) {
    (p.sections || []).forEach((s, i) => {
      if (Array.isArray(s.gallery) || typeof s.image === 'string') blocks.push({ pk, i, s, pageTitle: PAGE_LABELS[pk] || p.title || pk });
    });
  }
  return (
    <div className="stack">
      {'hero_image' in org && (
        <div className="card">
          <h3>תמונה ראשית</h3>
          <div className="wz-list-item"><ImgThumb src={org.hero_image} /><input className="input" dir="ltr" style={{ flex: 1 }} value={org.hero_image || ''} onChange={(e) => setOrg({ ...org, hero_image: e.target.value })} aria-label="תמונה ראשית" /></div>
          <Warn msg={urlWarn(org.hero_image)} />
        </div>
      )}
      {blocks.map(({ pk, i, s, pageTitle }) => (
        <div key={`${pk}-${i}`} className="card">
          <h3>{pageTitle} · {s.heading || `מקטע ${i + 1}`}</h3>
          {typeof s.image === 'string' && (
            <Field label="תמונת המקטע">
              <div className="wz-list-item"><ImgThumb src={s.image} /><input className="input" dir="ltr" style={{ flex: 1 }} value={s.image} onChange={(e) => setSite(setIn(site, ['pages', pk, 'sections', i, 'image'], e.target.value))} /></div>
              <Warn msg={urlWarn(s.image)} />
            </Field>
          )}
          {Array.isArray(s.gallery) && (
            <>
              {typeof s.image === 'string' && <p className="small muted">כשיש למקטע תמונה בודדת, הגלריה שלו לא מוצגת באתר.</p>}
              <UrlList items={s.gallery} onChange={(arr) => setSite(setIn(site, ['pages', pk, 'sections', i, 'gallery'], arr))} />
            </>
          )}
        </div>
      ))}
      {!blocks.length && <div className="empty">אין גלריות בהגדרות האתר</div>}
      <p className="small muted">מומלץ להעלות תמונות לאחסון חיצוני (למשל אתר הוורדפרס או Google Drive עם קישור ציבורי) ולהדביק כאן את הקישור. כך האתר נטען מהר.</p>
    </div>
  );
}

// ---------- צעד 5: סיכום ----------
function findGaps(org, theme, site) {
  const gaps = [];
  const warns = [];
  const req = [['name', 'שם מלא'], ['short_name', 'שם קצר'], ['legal_name', 'שם משפטי'], ['email', 'מייל'], ['whatsapp', 'וואטסאפ'], ['address', 'כתובת'], ['donation_url', 'קישור תרומה'], ['logo_url', 'לוגו'], ['nedarim_mosad', 'מספר מוסד בנדרים']];
  for (const [k, l] of req) if (!String(org[k] || '').trim()) gaps.push({ step: 0, text: `${l} - ריק` });
  if ('fax' in org && !org.fax) gaps.push({ step: 0, text: 'פקס - ריק (רשות)', soft: true });
  if (!(org.phones || []).filter((x) => String(x).trim()).length) gaps.push({ step: 0, text: 'אין מספר טלפון' });
  (org.phones || []).forEach((p) => { if (phoneWarn(p)) warns.push({ step: 0, text: `טלפון ${p}: ${phoneWarn(p)}` }); });
  if (emailWarn(org.email)) warns.push({ step: 0, text: emailWarn(org.email) });
  if (phoneWarn(org.whatsapp)) warns.push({ step: 0, text: `וואטסאפ: ${phoneWarn(org.whatsapp)}` });
  if (urlWarn(org.donation_url)) warns.push({ step: 0, text: `קישור תרומה: ${urlWarn(org.donation_url)}` });
  if (!Object.values(org.social || {}).some(Boolean)) gaps.push({ step: 0, text: 'רשתות חברתיות - לא הוזנו (רשות)', soft: true });
  for (const [k, l] of Object.entries(THEME_LABELS)) if (k in (theme || {}) && !/^#[0-9a-f]{6}$/i.test(theme[k] || '')) warns.push({ step: 1, text: `${l}: צבע לא תקין` });
  for (const [pk, p] of Object.entries(site?.pages || {})) {
    const pl = PAGE_LABELS[pk] || p.title || pk;
    if ('title' in p && !String(p.title || '').trim()) gaps.push({ step: 2, text: `${pl}: כותרת העמוד ריקה`, page: pk });
    if ('kicker' in p && !String(p.kicker || '').trim() && pk !== 'terms') gaps.push({ step: 2, text: `${pl}: שורת המשנה ריקה`, page: pk, soft: true });
    (p.sections || []).forEach((s, i) => {
      for (const [k, l] of SECTION_TEXT_KEYS) if (k in s && typeof s[k] === 'string' && !s[k].trim()) gaps.push({ step: 2, text: `${pl}, מקטע ${i + 1}: ${l} ריק`, page: pk });
      if (Array.isArray(s.gallery) && !s.gallery.length) gaps.push({ step: 3, text: `${pl}: הגלריה "${s.heading || `מקטע ${i + 1}`}" ריקה` });
      if (Array.isArray(s.videos) && !s.videos.length) gaps.push({ step: 3, text: `${pl}: אין סרטונים ב"${s.heading || `מקטע ${i + 1}`}" (רשות)`, soft: true });
      if (typeof s.image === 'string' && !s.image.trim()) gaps.push({ step: 3, text: `${pl}: תמונת המקטע "${s.heading || i + 1}" ריקה` });
      (s.gallery || []).forEach((g) => { if (urlWarn(g)) warns.push({ step: 3, text: `${pl}: קישור תמונה לא תקין` }); });
    });
  }
  if ('hero_image' in org && !org.hero_image) gaps.push({ step: 3, text: 'תמונה ראשית - ריקה' });
  return { gaps, warns };
}

function StepSummary({ org, theme, site, goStep, dirty }) {
  const { gaps, warns } = findGaps(org, theme, site);
  const hard = gaps.filter((g) => !g.soft);
  const soft = gaps.filter((g) => g.soft);
  return (
    <div className="stack">
      <div className="card">
        <div className="row between">
          <h3 style={{ margin: 0 }}>{hard.length ? `נותרו ${hard.length} פרטים להשלמה` : 'כל הפרטים העיקריים מולאו'}</h3>
          <a className="btn primary" href="/" target="_blank" rel="noopener"><Icon name="globe" size={16} />צפייה באתר</a>
        </div>
        {dirty && <div className="notice warn" style={{ marginTop: 10 }}>יש שינויים שעדיין לא נשמרו - לחצו "שמירה" כדי שיופיעו באתר.</div>}
        {!hard.length && !warns.length && <div className="notice" style={{ marginTop: 10 }}>האתר מוכן. אפשר לחזור לאשף בכל עת כדי לעדכן.</div>}
      </div>
      {hard.length > 0 && (
        <div className="card"><h3>חסר</h3>
          <ul className="steps-list">{hard.map((g, i) => <li key={i}><a href="#" onClick={(e) => { e.preventDefault(); goStep(g.step, g.page); }}>{g.text}</a> <span className="small muted">({STEPS[g.step].title})</span></li>)}</ul>
        </div>
      )}
      {warns.length > 0 && (
        <div className="card"><h3>כדאי לבדוק</h3>
          <ul className="steps-list">{warns.map((g, i) => <li key={i}><a href="#" onClick={(e) => { e.preventDefault(); goStep(g.step); }}>{g.text}</a></li>)}</ul>
        </div>
      )}
      {soft.length > 0 && (
        <div className="card"><h3 className="muted">רשות</h3>
          <ul className="steps-list small muted">{soft.map((g, i) => <li key={i}>{g.text}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ---------- המסך הראשי ----------
export function SetupWizardPage() {
  const [loaded, setLoaded] = useState(null); // הערכים השמורים
  const [org, setOrg] = useState(null);
  const [theme, setTheme] = useState(null);
  const [site, setSite] = useState(null);
  const [err, setErr] = useState(null);
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState(() => new Set([0]));
  const [page, setPage] = useState('home');
  const [saving, setSaving] = useState(false);
  const topRef = useRef();

  const load = () => Promise.all(['org', 'theme', 'site'].map((k) => api(`/settings/${k}`)))
    .then(([o, t, s]) => {
      const v = { org: o.value || {}, theme: t.value || {}, site: s.value || {} };
      setLoaded(clone(v)); setOrg(clone(v.org)); setTheme(clone(v.theme)); setSite(clone(v.site)); setErr(null);
    }).catch(setErr);
  useEffect(() => { load(); }, []);

  const dirtyKeys = useMemo(() => {
    if (!loaded) return [];
    const cur = { org, theme, site };
    return ['org', 'theme', 'site'].filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(loaded[k]));
  }, [loaded, org, theme, site]);
  const dirty = dirtyKeys.length > 0;
  useUnsaved(dirty);

  // מעבר למסך אחר בתוך המערכת כשיש שינויים שלא נשמרו - שואלים קודם
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onClick = async (e) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || a.target === '_blank') return;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      e.preventDefault(); e.stopPropagation();
      if (await confirmDialog('יש שינויים שלא נשמרו באשף. לצאת בלי לשמור?', { ok: 'יציאה בלי שמירה', cancel: 'המשך עריכה', danger: true })) {
        dirtyRef.current = false;
        a.click();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const save = async () => {
    if (!dirty) return true;
    if (org?.logo_url?.startsWith('data:') && org.logo_url.length > MAX_LOGO * 1.4) { toast('הלוגו גדול מדי לשמירה', 'error'); return false; }
    setSaving(true);
    try {
      const cur = { org, theme, site };
      await run(async () => {
        for (const k of dirtyKeys) await api(`/settings/${k}`, { method: 'PUT', body: { value: cur[k] } });
      }, 'נשמר. השינויים יופיעו באתר אחרי רענון');
      setLoaded(clone(cur));
      if (dirtyKeys.includes('theme')) applyThemeNow(theme);
      return true;
    } catch { return false; } finally { setSaving(false); }
  };

  const go = (i, pg) => {
    setStep(i);
    if (pg) setPage(pg);
    setVisited((v) => new Set([...v, i]));
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const saveAndNext = async () => { if (await save()) go(Math.min(step + 1, STEPS.length - 1)); };
  const revert = async () => {
    if (!dirty || !(await confirmDialog('לבטל את כל השינויים שלא נשמרו?', { ok: 'ביטול שינויים', danger: true }))) return;
    setOrg(clone(loaded.org)); setTheme(clone(loaded.theme)); setSite(clone(loaded.site));
  };

  if (err) return <div className="stack"><ErrorBox error={err} /><button className="btn" onClick={load}>נסו שוב</button></div>;
  if (!loaded || !org || !theme || !site) return <Spinner />;
  const pct = Math.round(((step + 1) / STEPS.length) * 100);
  const last = step === STEPS.length - 1;

  return (
    <div className="stack wz-root" ref={topRef}>
      <style>{CSS}</style>
      <div className="page-head"><h1>אשף הגדרת האתר</h1>
        <div className="row"><a className="btn sm" href="/" target="_blank" rel="noopener"><Icon name="globe" size={16} />לאתר</a><Link className="btn sm ghost" to="/app/dev">עריכה מתקדמת</Link></div></div>
      <p className="small muted" style={{ marginTop: 0 }}>מלאו את הפרטים צעד אחר צעד. כל צעד נשמר בנפרד, ואפשר לחזור ולעדכן בכל זמן.</p>
      <div>
        <div className="wz-steps" role="tablist" aria-label="שלבי האשף">
          {STEPS.map((s, i) => (
            <button key={s.key} type="button" role="tab" aria-selected={i === step} className={`wz-step ${i === step ? 'on' : ''} ${visited.has(i) && i !== step ? 'done' : ''}`} onClick={() => go(i)}>
              <span className="wz-num">{visited.has(i) && i !== step ? '✓' : i + 1}</span><span className="wz-lbl">{s.title}</span>
            </button>
          ))}
        </div>
        <div className="wz-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
        <div className="small muted" style={{ marginTop: 4 }}>שלב {step + 1} מתוך {STEPS.length} · {STEPS[step].title}{dirty && <> · <span style={{ color: '#8a5a00' }}>יש שינויים שלא נשמרו</span></>}</div>
      </div>

      {step === 0 && <StepOrg org={org} setOrg={setOrg} />}
      {step === 1 && <StepBrand org={org} setOrg={setOrg} theme={theme} setTheme={setTheme} />}
      {step === 2 && <StepTexts site={site} setSite={setSite} page={page} setPage={setPage} />}
      {step === 3 && <StepImages org={org} setOrg={setOrg} site={site} setSite={setSite} />}
      {step === 4 && <StepSummary org={org} theme={theme} site={site} goStep={go} dirty={dirty} />}

      <div className="wz-nav">
        <button type="button" className="btn" disabled={step === 0} onClick={() => go(step - 1)}>→ הקודם</button>
        <span className="grow" style={{ flex: 1 }} />
        {dirty && <button type="button" className="btn ghost" onClick={revert}>ביטול שינויים</button>}
        {last
          ? <button type="button" className="btn primary" disabled={!dirty || saving} onClick={save}>{saving ? 'שומר…' : 'שמירה'}</button>
          : <>
            {!dirty && <button type="button" className="btn primary" onClick={() => go(step + 1)}>הבא ←</button>}
            {dirty && <button type="button" className="btn primary" disabled={saving} onClick={saveAndNext}>{saving ? 'שומר…' : 'שמירה והמשך ←'}</button>}
          </>}
      </div>
    </div>
  );
}

// החלת צבעים חדשים על המערכת הפתוחה מיד אחרי שמירה (כמו בטעינת האתר)
function applyThemeNow(t) {
  const r = document.documentElement.style;
  if (t.primary) r.setProperty('--primary', t.primary);
  if (t.primary_dark) r.setProperty('--primary-dark', t.primary_dark);
  if (t.accent) r.setProperty('--accent', t.accent);
  if (t.sky) r.setProperty('--sky', t.sky);
  if (t.ink) r.setProperty('--ink', t.ink);
}
