// עוזר AI לשאלות על הנתונים - קריאה בלבד. השרת בונה תמונת מצב קבועה ושולח אותה למודל יחד עם השאלה.
import React, { useContext, useEffect, useRef, useState } from 'react';
import { api, AppCtx, datetime } from './lib.jsx';
import { Icon } from './icons.jsx';

const SUGGESTIONS = [
  'כמה נתרם החודש לעומת החודש שעבר?',
  'אילו הו״ק נכשלו לאחרונה?',
  'מי התורמים הגדולים השנה?',
  'איך מתחלקות ההכנסות השנה לפי מקור?',
  'מה מצב הקמפיינים מול היעד?',
  'אילו ימי זיכרון חלים בשבועיים הקרובים?',
];

const CSS = `
.as-wrap { display: flex; flex-direction: column; min-height: calc(100vh - 170px); max-width: 860px; }
.as-list { flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 4px 0 12px; }
.as-msg { max-width: 85%; padding: 10px 14px; border-radius: 14px; white-space: pre-wrap; line-height: 1.6; word-break: break-word; }
.as-msg.user { align-self: flex-start; background: var(--primary); color: #fff; border-bottom-right-radius: 4px; }
.as-msg.assistant { align-self: flex-end; background: #fff; border: 1px solid var(--line); border-bottom-left-radius: 4px; }
.as-msg.error { align-self: flex-end; background: #fff1f1; border: 1px solid #f3c7c7; color: #8b1f1f; }
.as-meta { font-size: 11.5px; opacity: .7; margin-top: 6px; }
.as-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.as-chip { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 13.5px; cursor: pointer; color: var(--ink); }
.as-chip:hover { border-color: var(--primary); }
.as-chip:disabled { opacity: .5; cursor: default; }
.as-input { position: sticky; bottom: 0; background: var(--bg); padding: 10px 0 8px; display: flex; gap: 8px; align-items: flex-end; }
.as-input textarea { resize: none; min-height: 46px; max-height: 160px; }
.as-dots span { display: inline-block; width: 7px; height: 7px; margin: 0 2px; border-radius: 50%; background: var(--muted); animation: as-b 1.2s infinite ease-in-out; }
.as-dots span:nth-child(2) { animation-delay: .15s; } .as-dots span:nth-child(3) { animation-delay: .3s; }
@keyframes as-b { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
@media (max-width: 700px) { .as-msg { max-width: 94%; } .as-wrap { min-height: calc(100vh - 210px); } }
`;

export function AssistantPage() {
  const { demoMode } = useContext(AppCtx);
  const [msgs, setMsgs] = useState([]); // {role:'user'|'assistant'|'error', content, at}
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notConfigured, setNotConfigured] = useState(null);
  const endRef = useRef();
  const inputRef = useRef();

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);

  const ask = async (q) => {
    const question = String(q ?? text).trim();
    if (!question || busy) return;
    const history = msgs.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: question, at: new Date().toISOString() }]);
    setText('');
    setBusy(true);
    try {
      const r = await api(`/ai/ask${demoMode === 'only' ? '?demo=only' : ''}`, { method: 'POST', body: { question, history }, timeout: 60000 });
      if (r.configured === false) {
        setNotConfigured(r.message);
        setMsgs((m) => m.slice(0, -1));
        setText(question);
        return;
      }
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, at: r.data_as_of }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'error', content: e.message || 'שגיאה בקבלת תשובה', at: new Date().toISOString() }]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); }
  };

  return (
    <div className="as-wrap">
      <style>{CSS}</style>
      <div className="page-head"><h1>עוזר נתונים</h1>
        {msgs.length > 0 && <button type="button" className="btn sm ghost" disabled={busy} onClick={() => setMsgs([])}>שיחה חדשה</button>}</div>
      <div className="notice small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Icon name="eye" size={18} />
        <div>העוזר <b>קורא נתונים בלבד</b> - הוא לא יכול לשנות, לשלוח או לחייב דבר. התשובות מבוססות על תמונת מצב מסוכמת של המערכת (סכומים, הו״ק, כשלים, תורמים מובילים, קמפיינים ועוד) ועלולות להיות חלקיות. לבדיקה מדויקת - מרכז הדוחות.
          {demoMode === 'only' ? ' כרגע מוצגים נתוני דוגמה בלבד.' : ' נתוני דוגמה אינם נכללים.'}</div>
      </div>

      {notConfigured && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>העוזר עדיין לא הופעל</h3>
          <p>{notConfigured}</p>
          <ol className="steps-list">
            <li>פתחו ב-Replit את לשונית <b>Secrets</b> (מנעול בסרגל הכלים).</li>
            <li>הוסיפו מפתח בשם <code dir="ltr">ANTHROPIC_API_KEY</code> עם המפתח מ-console.anthropic.com.</li>
            <li>אפשר להוסיף גם <code dir="ltr">ANTHROPIC_MODEL</code> כדי לבחור מודל אחר (רשות).</li>
            <li>הפעילו מחדש את השרת ונסו שוב.</li>
          </ol>
        </div>
      )}

      <div className="as-list" aria-live="polite">
        {msgs.length === 0 && !notConfigured && (
          <div className="empty" style={{ textAlign: 'right', padding: '18px 0' }}>
            <div style={{ marginBottom: 10 }}>שאלו שאלה על התרומות, הוראות הקבע או הקמפיינים. לדוגמה:</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`as-msg ${m.role}`}>
            {m.role === 'error' && <b>שגיאה: </b>}{m.content}
            {m.role === 'assistant' && m.at && <div className="as-meta">נכון ל-{datetime(m.at)}</div>}
            {m.role === 'error' && i === msgs.length - 1 && !busy && (
              <div style={{ marginTop: 6 }}><button type="button" className="btn sm" onClick={() => { const lastQ = [...msgs].reverse().find((x) => x.role === 'user'); if (lastQ) { setMsgs((x) => x.slice(0, -2)); ask(lastQ.content); } }}>נסו שוב</button></div>
            )}
          </div>
        ))}
        {busy && <div className="as-msg assistant" aria-label="העוזר כותב"><span className="as-dots"><span /><span /><span /></span></div>}
        <div ref={endRef} />
      </div>

      {msgs.length < 2 && (
        <div className="as-chips" style={{ marginBottom: 6 }}>
          {SUGGESTIONS.map((s) => <button key={s} type="button" className="as-chip" disabled={busy} onClick={() => ask(s)}>{s}</button>)}
        </div>
      )}
      <div className="as-input">
        <textarea ref={inputRef} className="input" rows={1} maxLength={1000} placeholder="כתבו שאלה… (Enter לשליחה, Shift+Enter לשורה חדשה)" value={text}
          onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`; }}
          onKeyDown={onKey} disabled={busy} aria-label="שאלה לעוזר" />
        <button type="button" className="btn primary" style={{ minHeight: 46 }} disabled={busy || !text.trim()} onClick={() => ask()}><Icon name="send" size={18} />שליחה</button>
      </div>
    </div>
  );
}
