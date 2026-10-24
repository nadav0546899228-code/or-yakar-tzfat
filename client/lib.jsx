import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

// ---------- ניתוב ----------
const RouterCtx = createContext({ path: '/', query: {} });
export function useRoute() { return useContext(RouterCtx); }

export function navigate(to, { replace = false } = {}) {
  if (replace) window.history.replaceState({}, '', to); else window.history.pushState({}, '', to);
  window.dispatchEvent(new Event('popstate'));
  window.scrollTo(0, 0);
}

export function RouterProvider({ children }) {
  const read = () => ({ path: window.location.pathname.replace(/\/$/, '') || '/', query: Object.fromEntries(new URLSearchParams(window.location.search)) });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return <RouterCtx.Provider value={loc}>{children}</RouterCtx.Provider>;
}

export function Link({ to, children, className = '', ...rest }) {
  const { path } = useRoute();
  const active = to === path || (to !== '/' && to !== '/app' && path.startsWith(to));
  return (
    <a href={to} className={`${className} ${active ? 'active' : ''}`} onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.button !== 0 || /^https?:|^tel:|^mailto:/.test(to)) return;
      e.preventDefault(); navigate(to);
    }} {...rest}>{children}</a>
  );
}

export function matchPath(pattern, path) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  const m = path.match(re);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
}

// ---------- API ----------
export async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `שגיאה ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api(path).then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error }));
    return () => { alive = false; };
  }, [path, tick, ...deps]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export async function download(path, filename) {
  const res = await api(path, { raw: true });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'ההורדה נכשלה'); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function downloadPost(path, body, filename) {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'ההורדה נכשלה'); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ---------- הודעות ----------
let pushToast = () => {};
export function toast(msg, kind = '') { pushToast({ msg, kind, id: Math.random() }); }
export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), t.kind === 'error' ? 6000 : 3500);
    };
  }, []);
  return <div className="toasts">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>;
}

export async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok');
    return r;
  } catch (e) {
    toast(e.message, 'error');
    throw e;
  }
}

// ---------- עיצוב ערכים ----------
const CUR = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' };
export function money(v, cur = 'ILS') {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return `${CUR[cur] || ''}${n.toLocaleString('he-IL', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 })}`;
}
export function date(v) {
  if (!v) return '';
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function datetime(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function today() { return new Date().toISOString().slice(0, 10); }
export function phoneHref(p) { return `tel:${String(p || '').replace(/[^\d+]/g, '')}`; }
export function waHref(p, text = '') {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = `972${d.slice(1)}`;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

// ---------- רכיבים ----------
export function Modal({ title, onClose, children, footer, size = '' }) {
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true">
        <div className="modal-head"><h3>{title}</h3><button className="btn ghost icon" onClick={onClose} aria-label="סגירה">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, full, hint }) {
  return <div className={`field ${full ? 'full' : ''}`}><label>{label}</label>{children}{hint && <span className="small muted">{hint}</span>}</div>;
}

export function Spinner() { return <div className="empty">טוען…</div>; }
export function ErrorBox({ error }) { return error ? <div className="notice bad">{error.message}</div> : null; }

export function Tag({ kind = '', children }) { return <span className={`tag ${kind}`}>{children}</span>; }

// השלמה אוטומטית מול השרת (תורמים, קמפיינים וכו׳)
export function RefPicker({ res, value, onChange, placeholder = 'הקלידו לחיפוש…', allowEmpty = true }) {
  const [q, setQ] = useState('');
  const [label, setLabel] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const timer = useRef();
  useEffect(() => {
    if (!value) { setLabel(''); return; }
    api(`/r/${res}/options?id=${value}`).then((d) => setLabel(d.rows[0]?.label || `#${value}`)).catch(() => {});
  }, [value, res]);
  const search = (text) => {
    setQ(text); setOpen(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => api(`/r/${res}/options?q=${encodeURIComponent(text)}`).then((d) => { setItems(d.rows); setHl(0); }).catch(() => {}), 180);
  };
  const pick = (it) => { onChange(it ? it.id : null); setLabel(it ? it.label : ''); setQ(''); setOpen(false); };
  return (
    <div className="ac">
      <input className="input" value={open ? q : label} placeholder={placeholder}
        onFocus={() => search(q)} onChange={(e) => search(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, items.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter' && open && items[hl]) { e.preventDefault(); pick(items[hl]); }
        }} />
      {open && (
        <div className="ac-list">
          {allowEmpty && value && <div onMouseDown={() => pick(null)} className="muted">— ללא —</div>}
          {items.map((it, i) => <div key={it.id} className={i === hl ? 'hl' : ''} onMouseDown={() => pick(it)}>{it.label}{it.phone ? <span className="muted small"> · {it.phone}</span> : null}</div>)}
          {!items.length && <div className="muted">אין תוצאות</div>}
        </div>
      )}
    </div>
  );
}

export function UserPicker({ value, onChange }) {
  const { data } = useApi('/users/options');
  return (
    <select className="input" value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">— ללא —</option>
      {(data?.rows || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </select>
  );
}

export function Confirm({ title, text, onYes, onClose, danger, needReason, confirmWord }) {
  const [reason, setReason] = useState('');
  const [word, setWord] = useState('');
  const ok = (!needReason || reason.trim()) && (!confirmWord || word === confirmWord);
  return (
    <Modal title={title} onClose={onClose} size="narrow" footer={<>
      <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={!ok} onClick={() => onYes(reason)}>אישור</button>
      <button className="btn" onClick={onClose}>ביטול</button>
    </>}>
      <p>{text}</p>
      {needReason && <Field label="סיבה (חובה)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>}
      {confirmWord && <Field label={`להקליד: ${confirmWord}`}><input className="input" value={word} onChange={(e) => setWord(e.target.value)} /></Field>}
    </Modal>
  );
}

// חתימה דיגיטלית
export function SignaturePad({ onChange }) {
  const ref = useRef();
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0d2152';
  }, []);
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  return (
    <div>
      <canvas ref={ref} className="sig"
        onPointerDown={(e) => { drawing.current = true; const ctx = ref.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...pos(e)); ref.current.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = ref.current.getContext('2d'); ctx.lineTo(...pos(e)); ctx.stroke(); }}
        onPointerUp={() => { drawing.current = false; onChange(ref.current.toDataURL('image/png')); }} />
      <button type="button" className="btn sm ghost" onClick={() => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); onChange(null); }}>ניקוי חתימה</button>
    </div>
  );
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function Logo({ src, alt, className = '' }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <span className={`fallback ${className}`}>{alt}</span>;
  // שומרים על יחס המקור: גובה קבוע, רוחב אוטומטי, object-fit: contain
  return <img src={src} alt={alt} onError={() => setErr(true)} style={{ objectFit: 'contain', width: 'auto' }} />;
}

export const AppCtx = createContext(null);
export function useAppCtx() { return useContext(AppCtx); }
export { useCallback };

// הודעת "יש גרסה חדשה" - בודק כל דקה (ובחזרה ללשונית) אם הגרסה בשרת השתנתה. לא מרענן לבד.
export function UpdateBanner() {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line no-undef
    const mine = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null;
    if (!mine) return undefined;
    const check = () => fetch(`/build.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).then((b) => { if (b.build_id && b.build_id !== mine) setNewer(true); }).catch(() => {});
    const t = setInterval(check, 60000);
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    check();
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  if (!newer) return null;
  return (
    <div className="update-bar" role="status">
      <span>יש גרסה חדשה של המערכת</span>
      <button className="btn sm gold" onClick={async () => {
        try { const regs = await navigator.serviceWorker?.getRegistrations(); await Promise.all((regs || []).map((r) => r.update())); } catch { /* */ }
        window.location.reload();
      }}>עדכון עכשיו</button>
      <button className="btn sm ghost" style={{ color: '#fff' }} onClick={() => setNewer(false)} aria-label="אחר כך">אחר כך</button>
    </div>
  );
}
