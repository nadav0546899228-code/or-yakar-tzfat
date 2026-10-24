import React, { useState, useContext } from 'react';
import { api, useApi, toast, run, Modal, Spinner, Tag, Link, money, date, qs, AppCtx, Confirm } from './lib.jsx';
import { SOURCE_LABELS } from './labels.js';
import { can } from './app.jsx';

// פענוח CSV (כולל מרכאות ומפרידי ; או ,) - דוחות חברות האשראי נשמרים מ-Excel כ-CSV
export function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : (firstLine.includes('\t') ? '\t' : ',');
  const rows = [];
  let cur = ''; let row = []; let q = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (q) {
      if (ch === '"' && clean[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur.trim()); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c !== ''));
  // דוחות רבים מתחילים בשורות כותרת כלליות - מחפשים את השורה הראשונה שנראית כמו כותרות עמודות
  const headIdx = Math.max(0, nonEmpty.findIndex((r) => r.filter((c) => /סכום|amount|תאריך|date/i.test(c)).length >= 2));
  const head = nonEmpty[headIdx] || [];
  return nonEmpty.slice(headIdx + 1).map((r) => Object.fromEntries(head.map((h, i) => [h || `col${i}`, r[i] ?? ''])));
}

function ImportDialog({ acquirers, onClose, onDone }) {
  const [acquirer, setAcquirer] = useState(acquirers[0]?.key || 'isracard');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="קליטת דוח זיכויים" onClose={onClose} size="wide" footer={<>
      <button className="btn primary" disabled={!rows?.length || busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await api('/settlements/import', { method: 'POST', body: { acquirer, rows } });
          toast(`נקלטו ${r.added} זיכויים · הותאמו אוטומטית ${r.matched} · ללא התאמה ${r.unmatched}${r.duplicates ? ` · כפולים ${r.duplicates}` : ''}`, 'ok');
          onDone();
        } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
      }}>קליטה והתאמה</button>
      <button className="btn" onClick={onClose}>ביטול</button></>}>
      <div className="stack">
        <div className="notice small">
          1. נכנסים לאתר בית העסק של חברת האשראי ומורידים את <b>דוח הזיכויים / פירוט עסקאות</b> לתקופה הרצויה.<br />
          2. אם הקובץ הוא Excel: פותחים אותו ושומרים בשם ← <b>CSV UTF-8</b>.<br />
          3. בוחרים כאן את החברה ומעלים את הקובץ. המערכת מזהה את העמודות, מונעת כפילויות ומתאימה כל זיכוי לתרומה (סכום, תאריך ו-4 ספרות).
        </div>
        <div className="row">{acquirers.map((a) => <button key={a.key} className={`btn ${acquirer === a.key ? 'primary' : ''}`} onClick={() => setAcquirer(a.key)}>{a.label}</button>)}</div>
        <label className="btn" style={{ alignSelf: 'flex-start' }}>בחירת קובץ CSV
          <input type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => {
            const f = e.target.files[0]; if (!f) return;
            f.arrayBuffer().then((buf) => {
              let text = new TextDecoder('utf-8').decode(buf);
              if (text.includes('�')) text = new TextDecoder('windows-1255').decode(buf); // קבצי Excel ישנים בעברית
              const parsed = parseCsv(text);
              if (!parsed.length) toast('לא נמצאו שורות בקובץ', 'error');
              setRows(parsed);
            });
            e.target.value = '';
          }} /></label>
        {rows && (
          <>
            <div className="small muted">{rows.length} שורות. תצוגה מקדימה:</div>
            <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}><table className="t"><thead><tr>{Object.keys(rows[0] || {}).map((k) => <th key={k}>{k}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 8).map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className="small">{v}</td>)}</tr>)}</tbody></table></div>
          </>
        )}
      </div>
    </Modal>
  );
}

function MatchDialog({ s, onClose, onDone }) {
  const { data } = useApi(`/settlements/${s.id}/candidates`);
  return (
    <Modal title={`התאמת זיכוי ${money(s.amount_gross)} מ-${date(s.transaction_date || s.deposit_date)}`} onClose={onClose} size="wide">
      {!data ? <Spinner /> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>תאריך</th><th>תורם</th><th>סכום</th><th>מקור</th><th>כרטיס</th><th /></tr></thead>
          <tbody>
            {data.rows.map((t) => (
              <tr key={t.id}><td>{date(t.date)}</td><td>{t.donor_name}</td><td className="num">{money(t.amount, t.currency)}</td><td><span className="src">{SOURCE_LABELS[t.source] || t.source}</span></td><td className="num">{t.card_last4 ? `****${t.card_last4}` : ''}</td>
                <td><button className="btn sm primary" onClick={() => run(() => api(`/settlements/${s.id}/match`, { method: 'POST', body: { transaction_id: t.id } }), 'הותאם').then(onDone)}>התאמה</button></td></tr>
            ))}
            {!data.rows.length && <tr><td colSpan={6} className="empty">לא נמצאו תרומות מתאימות (סכום עד 5% ותאריך עד 10 ימים)</td></tr>}
          </tbody></table></div>
      )}
    </Modal>
  );
}

export function SettlementsPage() {
  const { user, demoMode } = useContext(AppCtx);
  const [f, setF] = useState({ acquirer: '', status: '', from: '', to: '' });
  const [tab, setTab] = useState('deposits');
  const [imp, setImp] = useState(false);
  const [match, setMatch] = useState(null);
  const [delBatch, setDelBatch] = useState(null);
  const { data, reload } = useApi(`/settlements${qs({ ...f, demo: demoMode })}`);
  const write = can(user, 'settlements.write');
  if (!data) return <Spinner />;
  const label = (k) => data.acquirers.find((a) => a.key === k)?.label || k;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>זיכויי חברות אשראי</h1>
        <div className="row">
          {write && <button className="btn" onClick={() => run(() => api('/settlements/rematch', { method: 'POST' }), (r) => `הותאמו ${r.matched} מתוך ${r.checked}`).then(reload)}>התאמה מחדש</button>}
          {write && <button className="btn primary" onClick={() => setImp(true)}>+ קליטת דוח זיכויים</button>}
        </div>
      </div>
      <p className="small muted" style={{ marginTop: -6 }}>מה הגיע בפועל מישראכרט, כאל ומקס לבנק - מול התרומות באשראי. כרטיסי ויזה ומאסטרקארד מגיעים דרך החברה שסולקת עבור המסוף.</p>
      <div className="kpis">
        {data.acquirers.map((a) => {
          const s = data.byAcquirer.find((x) => x.acquirer === a.key) || { c: 0, gross: 0, fee: 0, net: 0, unmatched: 0 };
          return (
            <div key={a.key} className={`kpi link ${f.acquirer === a.key ? 'active' : ''}`} style={f.acquirer === a.key ? { borderColor: 'var(--primary)' } : null} onClick={() => setF({ ...f, acquirer: f.acquirer === a.key ? '' : a.key })}>
              <div className="row between"><div className="label">{a.label}</div>{a.portal && <a className="small" href={a.portal} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>לאתר ←</a>}</div>
              <div className="value num">{money(s.net)}</div>
              <div className="small muted">{s.c} זיכויים · עמלות {money(s.fee)}{s.unmatched ? <> · <span style={{ color: 'var(--bad)' }}>{s.unmatched} ללא התאמה</span></> : ''}</div>
            </div>
          );
        })}
        <div className={`kpi ${data.pending.length ? 'warn' : ''}`}><div className="label">תרומות אשראי בלי זיכוי (7+ ימים)</div><div className="value">{data.pending.length}</div></div>
      </div>
      <div className="tabs">
        <button className={tab === 'deposits' ? 'on' : ''} onClick={() => setTab('deposits')}>זיכויים ({data.rows.length})</button>
        <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>תרומות שלא הגיע עליהן זיכוי ({data.pending.length})</button>
      </div>
      {tab === 'deposits' && (
        <>
          <div className="toolbar">
            <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">הכל</option><option value="matched">מותאם</option><option value="unmatched">ללא התאמה</option></select>
            <input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} title="מתאריך" />
            <input className="input" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} title="עד תאריך" />
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>חברה</th><th>תאריך עסקה</th><th>תאריך זיכוי</th><th>ברוטו</th><th>עמלה</th><th>נטו</th><th>כרטיס</th><th>שובר / אישור</th><th>תרומה</th><th /></tr></thead>
            <tbody>
              {data.rows.map((s) => (
                <tr key={s.id}>
                  <td><span className="src">{label(s.acquirer)}</span>{s.is_demo && <> <Tag kind="demo">דוגמה</Tag></>}</td>
                  <td className="small nowrap">{date(s.transaction_date)}</td><td className="small nowrap">{date(s.deposit_date)}</td>
                  <td className="num">{money(s.amount_gross, s.currency)}</td><td className="num small">{money(s.fee, s.currency)}</td><td className="num"><b>{money(s.amount_net, s.currency)}</b></td>
                  <td className="num small">{s.card_last4 ? `****${s.card_last4}` : ''} {s.card_brand}</td>
                  <td className="small num">{s.voucher_number}{s.approval_number ? ` / ${s.approval_number}` : ''}</td>
                  <td>{s.transaction_id ? <><Tag kind="ok">{s.match_status === 'manual' ? 'ידני' : 'אוטומטי'}</Tag> {s.donor_id ? <Link to={`/app/donors/${s.donor_id}`}>{s.donor_name}</Link> : s.serial}</> : <Tag kind="bad">ללא התאמה</Tag>}</td>
                  <td className="nowrap">{write && (s.transaction_id
                    ? <button className="btn sm" onClick={() => run(() => api(`/settlements/${s.id}/match`, { method: 'POST', body: { transaction_id: null } }), 'ההתאמה בוטלה').then(reload)}>ביטול התאמה</button>
                    : <button className="btn sm primary" onClick={() => setMatch(s)}>התאמה ידנית</button>)}
                    {write && s.batch && s.batch !== 'demo' && <button className="btn sm ghost" title="מחיקת כל הקליטה הזו" onClick={() => setDelBatch(s.batch)}>🗑</button>}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={10} className="empty">עוד לא נקלטו זיכויים. לחצו "קליטת דוח זיכויים"</td></tr>}
            </tbody>
          </table></div>
        </>
      )}
      {tab === 'pending' && (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>תאריך</th><th>תורם</th><th>סכום</th><th>מקור</th><th>כרטיס</th></tr></thead>
          <tbody>
            {data.pending.map((t) => <tr key={t.id}><td>{date(t.date)}</td><td>{t.donor_id ? <Link to={`/app/donors/${t.donor_id}`}>{t.donor_name}</Link> : ''}</td><td className="num">{money(t.amount, t.currency)}</td><td><span className="src">{SOURCE_LABELS[t.source] || t.source}</span></td><td className="num">{t.card_last4 ? `****${t.card_last4}` : ''}</td></tr>)}
            {!data.pending.length && <tr><td colSpan={5} className="empty">אין - כל תרומות האשראי קיבלו זיכוי (או שעוד לא נקלט דוח)</td></tr>}
          </tbody>
        </table></div>
      )}
      {imp && <ImportDialog acquirers={data.acquirers} onClose={() => setImp(false)} onDone={() => { setImp(false); reload(); }} />}
      {match && <MatchDialog s={match} onClose={() => setMatch(null)} onDone={() => { setMatch(null); reload(); }} />}
      {delBatch && <Confirm danger title="מחיקת קליטה" text="יימחקו כל הזיכויים שנקלטו בקובץ הזה (התרומות עצמן לא נפגעות). אפשר לקלוט שוב אחר כך." onClose={() => setDelBatch(null)}
        onYes={() => run(() => api(`/settlements/batch/${delBatch}`, { method: 'DELETE' }), (r) => `נמחקו ${r.deleted}`).then(() => { setDelBatch(null); reload(); })} />}
    </div>
  );
}
