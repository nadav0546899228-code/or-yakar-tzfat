import React, { useEffect, useRef, useState } from 'react';
import { api, navigate, requestRefresh } from './lib.jsx';
import { Icon } from './icons.jsx';

// עדכון חי: השרת דוחף הודעה ברגע שמשהו משתנה (חיבור קבוע). אם החיבור נופל - בדיקה כל 15 שניות כגיבוי.
// המסכים מתרעננים בשקט, בלי לדרוס טופס פתוח, והתראות חדשות קופצות בפינת המסך
export function LiveUpdates() {
  const ver = useRef(null);
  const last = useRef(0);
  const [pops, setPops] = useState([]);
  useEffect(() => {
    let alive = true;
    let es = null;
    let streamOk = false;
    let retry = 5000;
    let retryTimer = null;
    let lastCheck = 0;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      lastCheck = Date.now();
      try {
        const r = await api(`/live?since=${last.current || 0}`);
        if (!alive) return;
        if (ver.current !== null && r.v !== ver.current) requestRefresh();
        ver.current = r.v;
        if (last.current && r.notifs?.length) {
          setPops((p) => [...r.notifs.map((n) => ({ ...n, key: `${n.id}` })), ...p].slice(0, 3));
          requestRefresh();
        }
        last.current = Math.max(last.current || 0, r.last || 0, ...(r.notifs || []).map((n) => n.id));
      } catch { /* בפעם הבאה */ }
    };
    const connect = () => {
      if (!alive || typeof EventSource === 'undefined') return;
      try { es = new EventSource('/api/live/stream'); } catch { return; }
      es.onopen = () => { streamOk = true; retry = 5000; };
      es.onmessage = (e) => {
        let d = null;
        try { d = JSON.parse(e.data); } catch { return; }
        // שינוי בגרסת הנתונים או התראה חדשה - מושכים את הפרטים פעם אחת
        if ((ver.current !== null && d.v !== ver.current) || (d.last && d.last > (last.current || 0))) check();
      };
      es.onerror = () => {
        streamOk = false;
        try { es.close(); } catch { /* */ }
        es = null;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30000);
      };
    };
    check();
    connect();
    // גיבוי: כשהחיבור הקבוע לא פעיל - כל 15 שניות; כשהוא פעיל - פעם בדקה ליתר ביטחון
    const t = setInterval(() => { if (!streamOk || Date.now() - lastCheck > 60000) check(); }, 15000);
    const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck > 10000) check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => {
      alive = false; clearInterval(t); clearTimeout(retryTimer);
      try { es?.close(); } catch { /* */ }
      document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onVis);
    };
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
