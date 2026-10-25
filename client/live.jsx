import React, { useEffect, useRef, useState } from 'react';
import { api, navigate } from './lib.jsx';
import { Icon } from './icons.jsx';

// עדכון חי: בודק כל 15 שניות אם משהו השתנה במערכת. אם כן - המסכים הפתוחים מתרעננים בשקט,
// והתראות חדשות קופצות בפינת המסך
export function LiveUpdates() {
  const ver = useRef(null);
  const last = useRef(0);
  const [pops, setPops] = useState([]);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await api(`/live?since=${last.current || 0}`);
        if (!alive) return;
        if (ver.current !== null && r.v !== ver.current) window.dispatchEvent(new Event('oy:refresh'));
        ver.current = r.v;
        if (last.current && r.notifs?.length) {
          setPops((p) => [...r.notifs.map((n) => ({ ...n, key: `${n.id}` })), ...p].slice(0, 3));
          window.dispatchEvent(new Event('oy:refresh'));
        }
        last.current = Math.max(last.current || 0, r.last || 0, ...(r.notifs || []).map((n) => n.id));
      } catch { /* בפעם הבאה */ }
    };
    check();
    const t = setInterval(check, 15000);
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  useEffect(() => {
    if (!pops.length) return undefined;
    const t = setTimeout(() => setPops((p) => p.slice(0, -1)), 9000);
    return () => clearTimeout(t);
  }, [pops]);
  if (!pops.length) return null;
  const close = (key) => setPops((p) => p.filter((x) => x.key !== key));
  return (
    <div className="pops" role="status" aria-live="polite">
      {pops.map((n) => (
        <div key={n.key} className="pop">
          <span className="pop-ico"><Icon name="bell" size={18} /></span>
          <button type="button" className="pop-body" onClick={() => { close(n.key); if (n.link) navigate(n.link); api('/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {}); }}>
            <b>{n.title}</b>{n.body && <span>{n.body}</span>}
          </button>
          <button type="button" className="btn ghost icon" aria-label="סגירה" onClick={() => close(n.key)}><Icon name="x" size={16} /></button>
        </div>
      ))}
    </div>
  );
}
