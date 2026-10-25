import React, { useEffect, useRef, useState } from 'react';
import { api, useApi, run, toast, Modal, Field, Spinner, navigate, datetime, useDebounced } from './lib.jsx';
import { Icon } from './icons.jsx';

// ---------- הודעות פנימיות בין אנשי הצוות ----------
export function InboxPage() {
  const [box, setBox] = useState('in');
  const { data, reload } = useApi(`/inbox?box=${box}`);
  const [sel, setSel] = useState([]);
  const [open, setOpen] = useState(null);
  const [compose, setCompose] = useState(null);
  useEffect(() => setSel([]), [box]);
  const rows = data?.rows || [];
  const openMsg = (m) => {
    setOpen(m);
    if (box === 'in' && !m.read_at) api('/inbox/read', { method: 'POST', body: { ids: [m.id] } }).then(reload).catch(() => {});
  };
  const del = (ids) => run(() => api('/inbox/delete', { method: 'POST', body: { ids } }), ids.length > 1 ? `נמחקו ${ids.length} הודעות` : 'נמחקה').then(() => { setSel([]); setOpen(null); reload(); });
  const markRead = (ids) => run(() => api('/inbox/read', { method: 'POST', body: { ids } }), 'סומן כנקרא').then(() => { setSel([]); reload(); });
  return (
    <div>
      <div className="page-head"><h1>הודעות צוות</h1><button className="btn primary" onClick={() => setCompose({})}><Icon name="pen" size={16} />הודעה חדשה</button></div>
      <div className="tabs">
        <button className={box === 'in' ? 'on' : ''} onClick={() => setBox('in')}>נכנסות{data?.unread ? ` (${data.unread})` : ''}</button>
        <button className={box === 'sent' ? 'on' : ''} onClick={() => setBox('sent')}>נשלחו</button>
      </div>
      <div className="toolbar">
        <label className="check small"><input type="checkbox" checked={rows.length > 0 && rows.every((r) => sel.includes(r.id))} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])} />סימון הכל</label>
        {sel.length > 0 && <>
          <b className="small">{sel.length} נבחרו</b>
          {box === 'in' && <button className="btn sm" onClick={() => markRead(sel)}><Icon name="check" size={15} />סימון כנקרא</button>}
          <button className="btn sm danger" onClick={() => del(sel)}><Icon name="x" size={15} />מחיקה</button>
        </>}
      </div>
      {!data ? <Spinner /> : (
        <div className="msg-list">
          {rows.map((m) => (
            <div key={m.id} className={`msg-row ${box === 'in' && !m.read_at ? 'unread' : ''} ${sel.includes(m.id) ? 'sel' : ''}`} onClick={() => openMsg(m)}>
              <input type="checkbox" checked={sel.includes(m.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSel(e.target.checked ? [...sel, m.id] : sel.filter((x) => x !== m.id))} aria-label="בחירה" />
              <span className="msg-av">{((box === 'in' ? m.from_name : m.to_name) || '?').slice(0, 1)}</span>
              <span className="msg-main">
                <span className="row between"><b>{box === 'in' ? m.from_name || 'מערכת' : `אל: ${m.to_name}`}</b><span className="small muted">{datetime(m.at)}</span></span>
                <span className="small">{m.subject ? <b>{m.subject} · </b> : null}{String(m.body).slice(0, 110)}</span>
              </span>
            </div>
          ))}
          {!rows.length && <div className="empty">{box === 'in' ? 'אין הודעות נכנסות' : 'עוד לא נשלחו הודעות'}</div>}
        </div>
      )}
      {open && (
        <Modal title={open.subject || 'הודעה'} onClose={() => setOpen(null)} footer={<>
          {box === 'in' && open.from_user && <button className="btn primary" onClick={() => { setCompose({ reply: open }); setOpen(null); }}><Icon name="send" size={16} />תשובה</button>}
          <button className="btn danger" onClick={() => del([open.id])}>מחיקה</button>
          <button className="btn" onClick={() => setOpen(null)}>סגירה</button>
        </>}>
          <div className="small muted" style={{ marginBottom: 8 }}>{box === 'in' ? `מאת ${open.from_name || 'מערכת'}` : `אל ${open.to_name}`} · {datetime(open.at)}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{open.body}</div>
          {open.link && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => { setOpen(null); navigate(open.link); }}>מעבר לפריט</button>}
        </Modal>
      )}
      {compose && <Compose reply={compose.reply} onClose={() => setCompose(null)} onSent={() => { setCompose(null); setBox('sent'); reload(); }} />}
    </div>
  );
}

function Compose({ reply, onClose, onSent }) {
  const { data } = useApi('/inbox/users');
  const [to, setTo] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const send = () => run(() => api('/inbox', { method: 'POST', body: { to, subject, body, reply_to: reply?.id } }), 'נשלח').then(onSent);
  return (
    <Modal title={reply ? `תשובה ל${reply.from_name}` : 'הודעה חדשה'} onClose={onClose} footer={<><button className="btn primary" disabled={!body.trim() || (!reply && !to.length)} onClick={send}><Icon name="send" size={16} />שליחה</button><button className="btn" onClick={onClose}>ביטול</button></>}>
      <div className="stack">
        {!reply && (
          <Field label="אל (אפשר לבחור כמה)">
            <div className="chips row">{(data?.rows || []).map((u) => <button type="button" key={u.id} className={`chip ${to.includes(u.id) ? 'on' : ''}`} onClick={() => setTo(to.includes(u.id) ? to.filter((x) => x !== u.id) : [...to, u.id])}>{to.includes(u.id) && <Icon name="check" size={14} />}{u.name}</button>)}</div>
          </Field>
        )}
        {reply && <div className="notice small"><b>{reply.subject || 'הודעה'}</b><div>{String(reply.body).slice(0, 200)}</div></div>}
        {!reply && <Field label="נושא"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
        <Field label="תוכן"><textarea className="input" rows={5} autoFocus value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ---------- חיפוש אחד לכל המערכת ----------
const TYPE_ICON = { donor: 'user', tx: 'shekel', doc: 'receipt', campaigns: 'flag', events: 'star', institutions: 'building' };
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [res, setRes] = useState([]);
  const [hl, setHl] = useState(0);
  const inp = useRef();
  useEffect(() => {
    if (dq.trim().length < 2) { setRes([]); return; }
    let alive = true;
    api(`/search?q=${encodeURIComponent(dq.trim())}`).then((d) => { if (alive) { setRes(d.results); setHl(0); } }).catch(() => {});
    return () => { alive = false; };
  }, [dq]);
  useEffect(() => { if (open) setTimeout(() => inp.current?.focus(), 30); }, [open]);
  useEffect(() => {
    const on = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const go = (r) => { setOpen(false); setQ(''); navigate(r.link); };
  return (
    <>
      <button className="btn ghost icon" onClick={() => setOpen(true)} aria-label="חיפוש בכל המערכת" title="חיפוש (Ctrl+K)"><Icon name="search" /></button>
      {open && (
        <div className="search-bg" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="search-box" role="dialog" aria-label="חיפוש">
            <div className="search-input"><Icon name="search" /><input ref={inp} autoFocus placeholder="שם, טלפון, מספר קבלה, סכום…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(res.length - 1, h + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)); } if (e.key === 'Enter' && res[hl]) go(res[hl]); }} />
              <button className="btn ghost icon" onClick={() => setOpen(false)} aria-label="סגירה"><Icon name="x" size={18} /></button></div>
            <div className="search-results">
              {res.map((r, i) => (
                <button type="button" key={`${r.type}${r.id}`} className={`search-item ${i === hl ? 'hl' : ''}`} onMouseEnter={() => setHl(i)} onClick={() => go(r)}>
                  <span className="search-ico"><Icon name={TYPE_ICON[r.type] || 'search'} size={18} /></span>
                  <span className="search-txt"><b>{r.title}</b>{r.sub && <span className="small muted">{r.sub}</span>}</span>
                </button>
              ))}
              {q.trim().length >= 2 && !res.length && <div className="empty small">לא נמצאו תוצאות</div>}
              {q.trim().length < 2 && <div className="empty small">מקלידים לפחות שני תווים</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- מעבר בין תצוגת טלפון לתצוגת מחשב (גם מתוך האפליקציה המותקנת) ----------
export function applyViewMode() {
  let mode = '';
  try { mode = localStorage.getItem('oy_view') || ''; } catch { /* */ }
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  meta.setAttribute('content', mode === 'desktop' ? 'width=1280' : 'width=device-width, initial-scale=1, viewport-fit=cover');
}
export function ViewToggle() {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('oy_view') || ''; } catch { return ''; } });
  const small = typeof window !== 'undefined' && (window.screen?.width || 1000) < 900;
  if (!small && mode !== 'desktop') return null;
  const next = mode === 'desktop' ? '' : 'desktop';
  return (
    <button type="button" className="side-toggle" onClick={() => { try { localStorage.setItem('oy_view', next); } catch { /* */ } setMode(next); applyViewMode(); toast(next ? 'עברת לתצוגת מחשב' : 'עברת לתצוגת טלפון', 'ok'); }}>
      <Icon name={mode === 'desktop' ? 'mobile' : 'dashboard'} size={18} />{mode === 'desktop' ? 'מעבר לתצוגת טלפון' : 'מעבר לתצוגת מחשב'}
    </button>
  );
}
