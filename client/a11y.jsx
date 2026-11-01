// תפריט נגישות לאתר הציבורי (ברוח ת"י 5568 / WCAG 2.0 AA). קטן במכוון - בלי תלויות.
// ההתאמות מופעלות כמחלקות על תגית html (a11y-*) והעיצוב שלהן בסוף styles.css. הבחירה נשמרת בדפדפן.
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useRoute } from './lib.jsx';

const KEY = 'oy_a11y';
const TOGGLES = [
  ['contrast', 'ניגודיות גבוהה'],
  ['gray', 'גווני אפור'],
  ['links', 'הדגשת קישורים'],
  ['font', 'גופן קריא'],
  ['still', 'עצירת אנימציות'],
];
const EMPTY = { text: 0, contrast: false, gray: false, links: false, font: false, still: false };
const ALL_CLASSES = ['a11y-text-1', 'a11y-text-2', 'a11y-text-3', ...TOGGLES.map(([k]) => `a11y-${k}`)];

function load() {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...EMPTY }; }
}
function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* מצב פרטי - לא נשמר */ }
}
function apply(s) {
  const cl = document.documentElement.classList;
  cl.remove(...ALL_CLASSES);
  if (s.text > 0) cl.add(`a11y-text-${s.text}`);
  TOGGLES.forEach(([k]) => { if (s[k]) cl.add(`a11y-${k}`); });
}

export function A11yMenu() {
  const [s, setS] = useState(load);
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const { path } = useRoute();
  useEffect(() => setOpen(false), [path]);

  // ההתאמות חלות רק כל עוד האתר הציבורי מוצג (לא על המערכת ב-/app)
  useLayoutEffect(() => { apply(s); }, [s]);
  useLayoutEffect(() => () => document.documentElement.classList.remove(...ALL_CLASSES), []);

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.querySelector('button')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    const onDown = (e) => { if (!panelRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const update = (patch) => setS((prev) => { const next = { ...prev, ...patch }; save(next); return next; });
  const reset = () => { save(EMPTY); setS({ ...EMPTY }); };

  return (
    <div className="a11y">
      <button ref={btnRef} type="button" className="a11y-btn" aria-label="תפריט נגישות" aria-expanded={open} aria-controls="a11y-panel" onClick={() => setOpen(!open)}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18z" /></svg>
      </button>
      {open && (
        <div ref={panelRef} id="a11y-panel" className="a11y-panel" role="dialog" aria-label="התאמות נגישות">
          <div className="a11y-head"><b>התאמות נגישות</b>
            <button type="button" className="a11y-x" aria-label="סגירת תפריט הנגישות" onClick={() => { setOpen(false); btnRef.current?.focus(); }}>×</button>
          </div>
          <div className="a11y-size" role="group" aria-label="גודל טקסט">
            <button type="button" onClick={() => update({ text: Math.max(0, s.text - 1) })} disabled={s.text === 0} aria-label="הקטנת טקסט">א-</button>
            <span aria-live="polite">גודל טקסט: {s.text === 0 ? 'רגיל' : `+${s.text}`}</span>
            <button type="button" onClick={() => update({ text: Math.min(3, s.text + 1) })} disabled={s.text === 3} aria-label="הגדלת טקסט">א+</button>
          </div>
          {TOGGLES.map(([k, label]) => (
            <button key={k} type="button" className="a11y-opt" aria-pressed={!!s[k]} onClick={() => update({ [k]: !s[k] })}>
              <span className="a11y-check" aria-hidden="true">{s[k] ? '✓' : ''}</span>{label}
            </button>
          ))}
          <button type="button" className="a11y-opt a11y-reset" onClick={reset}>איפוס כל ההתאמות</button>
          <Link to="/accessibility" className="a11y-link">הצהרת נגישות</Link>
        </div>
      )}
    </div>
  );
}
