import React, { useState, useEffect, useContext } from 'react';
import {
  api, useApi, toast, run, Modal, Field, RefPicker, UserPicker, Confirm, Spinner, ErrorBox, Tag, Link, navigate, useRoute,
  money, date, datetime, today, qs, download, useDebounced, AppCtx, phoneHref, waHref, SignaturePad,
} from './lib.jsx';
import { SOURCE_LABELS, TX_STATUS, SO_STATUS, TAX_STATUS, DOC_TYPES, KIND_LABELS, METHOD_LABELS, CALL_REASON, DATE_KIND } from './labels.js';
import { can } from './app.jsx';
import { Icon, SourceBadge } from './icons.jsx';

function optLabel(meta, optKey, v) {
  const o = meta.options[optKey]?.find((x) => x.value === v);
  return o ? o.label : v;
}

export function renderValue(meta, f, row, labels = {}) {
  const v = row[f.key];
  if (v === null || v === undefined || v === '') return '';
  switch (f.type) {
    case 'money': return <span className="num">{money(v, row.currency || 'ILS')}</span>;
    case 'date': return date(v);
    case 'datetime': return datetime(v);
    case 'bool': return v ? '✓' : '';
    case 'select': return optLabel(meta, f.options, v);
    case 'ref': case 'user': return labels[f.key]?.[v] || `#${v}`;
    case 'tags': return (v || []).map((t) => <Tag key={t} kind={t === 'VIP' ? 'purple' : 'info'}>{t}</Tag>);
    case 'url': return <a href={v} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>קישור</a>;
    case 'phone': return <a className="num" href={phoneHref(v)} onClick={(e) => e.stopPropagation()}>{v}</a>;
    case 'json': return JSON.stringify(v);
    case 'file': return v ? '📎' : '';
    default: return String(v).length > 80 ? `${String(v).slice(0, 80)}…` : String(v);
  }
}

const COMPUTED_LABELS = {
  total_ils: ['סה"כ תרם', 'money'], last_donation: ['תרומה אחרונה', 'date'], active_keva: ['הו"ק', 'number'], raised: ['גויס', 'money'],
  next_due: ['איסוף הבא', 'date'], total_collected: ['נאסף', 'money'], guests: ['מגיעים', 'number'], pledged: ['התחייבויות', 'money'],
};

export function FieldInput({ f, value, onChange, meta }) {
  switch (f.type) {
    case 'textarea': return <textarea className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number': return <input className="input" type="number" min={f.min} max={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'money': return <input className="input num" type="number" step="0.01" min="0" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'date': return <input className="input" type="date" value={value ? String(value).slice(0, 10) : ''} onChange={(e) => onChange(e.target.value)} />;
    case 'bool': return <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />{f.label}</label>;
    case 'select': return (
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(meta.options[f.options] || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
    case 'ref': return <RefPicker res={f.ref} value={value} onChange={onChange} />;
    case 'user': return <UserPicker value={value} onChange={onChange} />;
    case 'tags': return <input className="input" placeholder="מופרדות בפסיק" value={Array.isArray(value) ? value.join(', ') : value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'color': return <input className="input" type="color" value={value || '#16357a'} onChange={(e) => onChange(e.target.value)} />;
    case 'json': return <textarea className="input json-edit" style={{ minHeight: 120 }} value={typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2)} onChange={(e) => onChange(e.target.value)} />;
    case 'file': return <input className="input" type="file" onChange={(e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { toast('הקובץ גדול מ-5MB', 'error'); return; }
      const r = new FileReader(); r.onload = () => onChange(r.result, file.name); r.readAsDataURL(file);
    }} />;
    case 'phone': return <input className="input num" type="tel" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'email': return <input className="input" type="email" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'url': return <input className="input" type="url" dir="ltr" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    default: return <input className="input" placeholder={f.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function ResourceForm({ resKey, row, preset = {}, onClose, onSaved }) {
  const { meta } = useContext(AppCtx);
  const def = meta.resources[resKey];
  const [form, setForm] = useState(() => {
    const init = { ...preset };
    if (row) Object.assign(init, row);
    else def.fields.forEach((f) => { if (init[f.key] === undefined && f.default !== undefined) init[f.key] = f.default === 'today' ? today() : f.default; });
    return init;
  });
  const [adv, setAdv] = useState(!!row);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const hasAdv = def.fields.some((f) => f.advanced);
  const save = async (force) => {
    setBusy(true);
    try {
      const body = { ...form, force };
      const r = row ? await api(`/r/${resKey}/${row.id}`, { method: 'PUT', body }) : await api(`/r/${resKey}`, { method: 'POST', body });
      toast('נשמר', 'ok');
      onSaved?.(r.row);
    } catch (e) {
      if (e.status === 409 && e.data?.duplicate) {
        if (window.confirm(`${e.message}\nלפתוח את הכרטיס הקיים? (ביטול = ליצור בכל זאת)`)) navigate(`/app/donors/${e.data.duplicate.id}`);
        else save(true);
      } else toast(e.message, 'error');
    } finally { setBusy(false); }
  };
  const fields = def.fields.filter((f) => !f.advanced || adv);
  return (
    <Modal title={`${row ? 'עריכת' : 'הוספת'} ${def.one}`} onClose={onClose} footer={<>
      <button className="btn primary" disabled={busy || def.readonly} onClick={() => save(false)}>שמירה</button>
      <button className="btn" onClick={onClose}>ביטול</button>
      <div className="grow" />
      {row && !def.readonly && <button className="btn danger" onClick={() => setDel(true)}>מחיקה</button>}
    </>}>
      <div className="form-grid">
        {fields.map((f) => (
          f.type === 'bool' ? <div key={f.key} className="field" style={{ justifyContent: 'flex-end' }}><FieldInput f={f} meta={meta} value={form[f.key]} onChange={(v) => setForm({ ...form, [f.key]: v })} /></div>
            : <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} full={['textarea', 'json'].includes(f.type)}>
              <FieldInput f={f} meta={meta} value={form[f.key]} onChange={(v, name) => setForm({ ...form, [f.key]: v, ...(name ? { file_name: name } : {}) })} />
            </Field>
        ))}
      </div>
      {hasAdv && !adv && <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setAdv(true)}>+ פרטים נוספים</button>}
      {!row && resKey === 'donors' && <p className="small muted" style={{ marginTop: 8 }}>הזנה מהירה: שם וטלפון מספיקים. השאר אפשר להשלים אחר כך.</p>}
      {del && <Confirm title="מחיקה" danger needReason={['donors', 'institutions'].includes(resKey)} text="הפעולה תירשם ביומן. להמשיך?" onClose={() => setDel(false)}
        onYes={async (reason) => { await run(() => api(`/r/${resKey}/${row.id}`, { method: 'DELETE', body: { reason } }), 'נמחק'); setDel(false); onSaved?.(null); }} />}
    </Modal>
  );
}

export function ResourcePage({ res }) {
  const { meta, demoMode, user } = useContext(AppCtx);
  const { query } = useRoute();
  const def = meta.resources[res];
  const [q, setQ] = useState(query.q || '');
  const dq = useDebounced(q);
  const [filters, setFilters] = useState(() => Object.fromEntries(Object.entries(query).filter(([k]) => k.startsWith('f_'))));
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null);
  const [tab, setTab] = useState(res);
  const effectiveRes = res === 'institutions' ? tab : res;
  const effDef = meta.resources[effectiveRes] || def;
  const { data, loading, error, reload } = useApi(def ? `/r/${effectiveRes}${qs({ q: dq, page, demo: demoMode, ...filters })}` : null);
  useEffect(() => { setPage(1); }, [dq, JSON.stringify(filters), effectiveRes]);
  if (!def) return <div className="empty">מודול לא קיים</div>;
  const listFields = effDef.list.map((k) => effDef.fields.find((f) => f.key === k) || effDef.readonlyFields.find((f) => f.key === k) || (COMPUTED_LABELS[k] && { key: k, label: COMPUTED_LABELS[k][0], type: COMPUTED_LABELS[k][1] })).filter(Boolean);
  const canWrite = !effDef.readonly && can(user, effDef.perms.write);
  const open = (row) => {
    if (effDef.detailPath) navigate(effDef.detailPath.replace(':id', row.id));
    else setEdit(row);
  };
  return (
    <div>
      <div className="page-head">
        <h1>{res === 'institutions' ? 'מוסדות ומטרות' : def.label}</h1>
        <div className="row">
          {res === 'donors' && can(user, 'donors.merge') && <Link className="btn" to="/app/donors/duplicates">איתור כפילויות</Link>}
          {res === 'donors' && <ImportButton onDone={reload} />}
          <button className="btn" onClick={() => run(() => download(`/export/${effectiveRes}`, `${effectiveRes}.csv`))}>ייצוא</button>
          {canWrite && <button className="btn primary" onClick={() => setEdit({})}>+ {effDef.one}</button>}
        </div>
      </div>
      {res === 'institutions' && <div className="tabs"><button className={tab === 'institutions' ? 'on' : ''} onClick={() => setTab('institutions')}>מוסדות</button><button className={tab === 'purposes' ? 'on' : ''} onClick={() => setTab('purposes')}>מטרות תרומה</button></div>}
      <div className="toolbar">
        <input className="input search" placeholder="חיפוש…" value={q} onChange={(e) => setQ(e.target.value)} />
        {(effDef.filters || []).map((k) => {
          const f = effDef.fields.find((x) => x.key === k);
          if (!f) return null;
          if (f.type === 'bool') return <select key={k} className="input" value={filters[`f_${k}`] || ''} onChange={(e) => setFilters({ ...filters, [`f_${k}`]: e.target.value })}><option value="">{f.label}: הכל</option><option value="true">כן</option><option value="false">לא</option></select>;
          if (f.type === 'select') return <select key={k} className="input" value={filters[`f_${k}`] || ''} onChange={(e) => setFilters({ ...filters, [`f_${k}`]: e.target.value })}><option value="">{f.label}: הכל</option>{meta.options[f.options].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
          if (f.type === 'user') return <div key={k} style={{ minWidth: 160 }}><UserPicker value={filters[`f_${k}`]} onChange={(v) => setFilters({ ...filters, [`f_${k}`]: v || '' })} /></div>;
          return <input key={k} className="input" placeholder={f.label} value={filters[`f_${k}`] || ''} onChange={(e) => setFilters({ ...filters, [`f_${k}`]: e.target.value })} />;
        })}
        {data && <span className="muted small">{data.total} רשומות</span>}
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table className="t">
          <thead><tr>{listFields.map((f) => <th key={f.key}>{f.label}</th>)}{res === 'donors' && <th />}</tr></thead>
          <tbody>
            {loading && !data ? <tr><td colSpan={9}><Spinner /></td></tr> : data?.rows.map((row) => (
              <tr key={row.id} className="click" onClick={() => open(row)}>
                {listFields.map((f, i) => <td key={f.key}>{renderValue(meta, f, row, data.labels)}{i === 0 && row.is_demo && <> <Tag kind="demo">דוגמה</Tag></>}</td>)}
                {res === 'donors' && <td className="nowrap" onClick={(e) => e.stopPropagation()}>{row.phone && <><a className="btn sm ghost" href={phoneHref(row.phone)}>☎</a><a className="btn sm ghost" href={waHref(row.phone)} target="_blank" rel="noopener">💬</a></>}</td>}
              </tr>
            ))}
            {data && !data.rows.length && <tr><td colSpan={9} className="empty">אין נתונים</td></tr>}
          </tbody>
        </table>
      </div>
      {data && data.total > data.size && (
        <div className="pager"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>הקודם</button><span className="small">עמוד {page} מתוך {Math.ceil(data.total / data.size)}</span><button className="btn sm" disabled={page * data.size >= data.total} onClick={() => setPage(page + 1)}>הבא</button></div>
      )}
      {edit && <ResourceForm resKey={effectiveRes} row={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={(r) => { setEdit(null); reload(); if (r && !edit.id && effDef.detailPath) navigate(effDef.detailPath.replace(':id', r.id)); }} />}
    </div>
  );
}

// ייבוא תורמים מ-CSV (עמודות בעברית או באנגלית)
function ImportButton({ onDone }) {
  const [rows, setRows] = useState(null);
  const MAP = { 'שם פרטי': 'first_name', 'שם משפחה': 'last_name', 'טלפון': 'phone', 'נייד': 'phone', 'מייל': 'email', 'דוא"ל': 'email', 'ת.ז.': 'id_number', 'תז': 'id_number', 'עיר': 'city', 'כתובת': 'address', 'תואר': 'title', 'תגיות': 'tags', 'מדינה': 'country', 'הערות': 'notes' };
  const parse = (text) => {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const split = (l) => { const out = []; let cur = ''; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((s) => s.trim()); };
    const head = split(lines[0]).map((h) => MAP[h] || h);
    return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
  };
  return (
    <>
      <label className="btn">ייבוא CSV<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files[0]; if (!f) return; f.text().then((t) => setRows(parse(t))); e.target.value = ''; }} /></label>
      {rows && (
        <Modal title={`ייבוא ${rows.length} תורמים`} onClose={() => setRows(null)} footer={<>
          <button className="btn primary" onClick={async () => { const r = await run(() => api('/import/donors', { method: 'POST', body: { rows } })); toast(`נוצרו ${r.created}, קיימים ${r.linked}, דולגו ${r.skipped}`, 'ok'); setRows(null); onDone(); }}>ייבוא</button>
          <button className="btn" onClick={() => setRows(null)}>ביטול</button></>}>
          <p className="small muted">תורמים קיימים (לפי טלפון או ת.ז.) לא ישוכפלו. עמודות מוכרות: שם פרטי, שם משפחה, טלפון, מייל, ת.ז., עיר, כתובת, תגיות.</p>
          <div className="table-wrap"><table className="t"><thead><tr>{Object.keys(rows[0] || {}).map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 8).map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>
        </Modal>
      )}
    </>
  );
}

// ---------- רכיבי כסף ----------
export function TxStatus({ s }) { const [l, k] = TX_STATUS[s] || [s, '']; return <Tag kind={k}>{l}</Tag>; }
export function SoStatus({ s }) { const [l, k] = SO_STATUS[s] || [s, '']; return <Tag kind={k}>{l}</Tag>; }
export function Src({ s, short }) { return <SourceBadge s={s} label={SOURCE_LABELS[s] || s} withText={!short} />; }

export function NewDonation({ donorId, preset = {}, onClose, onDone }) {
  const { user } = useContext(AppCtx);
  const [f, setF] = useState({ donor_id: donorId || null, method: 'cash', amount: '', currency: 'ILS', date: today(), issue_document: true, document_type: 'receipt46', ...preset });
  const [mode, setMode] = useState('record');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'record') {
        const r = await api('/transactions', { method: 'POST', body: f });
        toast(r.needsApproval ? 'נרשם - ממתין לאישור גזבר' : r.document?.error ? `נרשם. קבלה לא הופקה: ${r.document.error}` : `נרשם${r.document?.number ? `, קבלה ${r.document.number}` : ''}`, r.document?.error ? 'error' : 'ok');
      } else {
        const r = await api('/charge', { method: 'POST', body: { ...f, recurring: mode === 'keva' } });
        toast(r.message, 'ok');
      }
      onDone?.();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="תרומה חדשה" onClose={onClose} footer={<><button className="btn primary" disabled={busy || !f.donor_id || !f.amount} onClick={submit}>{mode === 'record' ? 'רישום' : mode === 'keva' ? 'הקמת הו"ק באשראי' : 'חיוב'}</button><button className="btn" onClick={onClose}>ביטול</button></>}>
      <div className="tabs">
        <button className={mode === 'record' ? 'on' : ''} onClick={() => setMode('record')}>רישום (מזומן / צ׳ק / העברה)</button>
        {can(user, 'tx.write') && <button className={mode === 'charge' ? 'on' : ''} onClick={() => setMode('charge')}>חיוב אשראי</button>}
        {can(user, 'tx.write') && <button className={mode === 'keva' ? 'on' : ''} onClick={() => setMode('keva')}>הו"ק באשראי</button>}
      </div>
      <div className="form-grid">
        {!donorId && <Field label="תורם *" full><RefPicker res="donors" value={f.donor_id} onChange={set('donor_id')} /></Field>}
        <Field label="סכום *" full>
          <div className="amount-chips">{[18, 36, 52, 100, 180, 360, 500, 1000].map((v) => <button type="button" key={v} className={`chip-amt ${Number(f.amount) === v ? 'on' : ''}`} onClick={() => set('amount')(String(v))}>{v.toLocaleString('he-IL')}</button>)}</div>
          <input className="input num" type="number" min="1" inputMode="decimal" placeholder="או סכום אחר" value={f.amount} onChange={set('amount')} />
        </Field>
        <Field label="מטבע"><select className="input" value={f.currency} onChange={set('currency')}><option value="ILS">₪</option><option value="USD">$</option><option value="EUR">€</option><option value="GBP">£</option></select></Field>
        {mode === 'record' && <>
          <Field label="אמצעי תשלום" full>
            <div className="seg-btns">{[['cash', 'cash'], ['check', 'check2'], ['transfer', 'transfer'], ['bit', 'mobile'], ['other', 'coin']].map(([m, ic]) => <button type="button" key={m} className={`seg-btn ${f.method === m ? 'on' : ''}`} onClick={() => set('method')(m)}><Icon name={ic} size={18} />{METHOD_LABELS[m]}</button>)}</div>
          </Field>
          <Field label="תאריך"><input className="input" type="date" value={f.date} onChange={set('date')} /></Field>
          {f.method === 'check' && <>
            <Field label="מספר צ׳ק"><input className="input" value={f.check_number || ''} onChange={set('check_number')} /></Field>
            <Field label="בנק"><input className="input" value={f.check_bank || ''} onChange={set('check_bank')} /></Field>
            <Field label="תאריך פירעון"><input className="input" type="date" value={f.check_due_date || ''} onChange={set('check_due_date')} /></Field>
          </>}
        </>}
        {mode === 'charge' && <>
          <Field label="ספק סליקה"><select className="input" value={f.provider || 'cardcom'} onChange={set('provider')}>{['cardcom', 'tranzila', 'grow', 'payplus', 'hyp', 'nedarim'].map((p) => <option key={p} value={p}>{SOURCE_LABELS[p]}</option>)}</select></Field>
          <Field label="תשלומים"><input className="input" type="number" min="1" max="36" value={f.installments || 1} onChange={set('installments')} /></Field>
        </>}
        {mode === 'keva' && <>
          <Field label="ספק סליקה"><select className="input" value={f.provider || 'cardcom'} onChange={set('provider')}>{['cardcom', 'tranzila', 'grow', 'payplus', 'nedarim'].map((p) => <option key={p} value={p}>{SOURCE_LABELS[p]}</option>)}</select></Field>
          <Field label="יום חיוב בחודש"><input className="input" type="number" min="1" max="28" value={f.day_of_month || 10} onChange={set('day_of_month')} /></Field>
          <Field label="מספר חודשים (ריק = ללא הגבלה)"><input className="input" type="number" value={f.months_total || ''} onChange={set('months_total')} /></Field>
        </>}
        <Field label="מוסד"><RefPicker res="institutions" value={f.institution_id} onChange={set('institution_id')} /></Field>
        <Field label="קמפיין"><RefPicker res="campaigns" value={f.campaign_id} onChange={set('campaign_id')} /></Field>
        <Field label="הקדשה / לעילוי נשמת" full><input className="input" value={f.dedication || ''} onChange={set('dedication')} /></Field>
        {mode === 'record' && <div className="full row">
          <label className="check"><input type="checkbox" checked={f.issue_document} onChange={(e) => set('issue_document')(e.target.checked)} />הפקת קבלה</label>
          {f.issue_document && <select className="input" style={{ width: 'auto' }} value={f.document_type} onChange={set('document_type')}><option value="receipt46">קבלה על תרומה (46)</option><option value="receipt">קבלה רגילה</option></select>}
        </div>}
        {mode !== 'record' && <div className="full notice warn small">סביבת פיתוח: החיוב מתבצע בהדמיה. בייצור ייפתח דף הסליקה המאובטח של הספק ופרטי הכרטיס לא עוברים במערכת.</div>}
      </div>
    </Modal>
  );
}

// ---------- כרטיס תורם 360 ----------
export function DonorCard({ params }) {
  const { meta, user } = useContext(AppCtx);
  const { data, loading, error, reload } = useApi(`/donors/${params.id}/full`);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [msg, setMsg] = useState(null);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const d = data.donor;
  const name = `${d.title ? `${d.title} ` : ''}${d.first_name || ''} ${d.last_name || ''}`.trim();
  const tabs = [['overview', 'סקירה'], ...(data.showFinance ? [['tx', `תרומות (${data.transactions.length})`], ['keva', `הו"ק (${data.keva.length})`], ['docs', `קבלות (${data.documents.length})`]] : []),
    ['timeline', 'ציר זמן'], ['log', `תיעוד (${data.interactions.length})`], ['dates', `תאריכים (${data.dates.length})`], ['more', 'עוד']];
  return (
    <div className="stack">
      <div className="card">
        <div className="donor-head">
          <div className="avatar">{(d.first_name || '?')[0]}</div>
          <div className="grow">
            <h1 style={{ fontSize: 22, margin: 0 }}>{name}</h1>
            <div className="row chips" style={{ marginTop: 6 }}>
              {d.is_vip && <button type="button" className="chip purple" onClick={() => navigate('/app/donors?f_is_vip=true')}>VIP</button>}
              {d.is_overseas && <button type="button" className="chip info" onClick={() => navigate('/app/donors?f_is_overseas=true')}><Icon name="globe" size={14} />חו"ל</button>}
              {d.no_contact && <span className="chip bad">לא ליצור קשר</span>}
              {d.is_demo && <span className="chip demo">דוגמה</span>}
              {(d.tags || []).map((t) => <button type="button" key={t} className="chip" onClick={() => navigate(`/app/donors?q=${encodeURIComponent(t)}`)}>{t}</button>)}
            </div>
            <div className="row small muted" style={{ marginTop: 4 }}>
              {d.phone && <a className="num" href={phoneHref(d.phone)}><bdi dir="ltr">{d.phone}</bdi></a>}
              {d.email && <a href={`mailto:${d.email}`}>{d.email}</a>}
              {d.city && <span>{d.city}</span>}
              {d.recruiter_name && <span>נציג: {d.recruiter_name}</span>}
              {data.links.map((l) => <Src key={l.source + l.external_id} s={l.source} />)}
            </div>
          </div>
        </div>
        <div className="action-bar">
          {d.phone && !d.no_contact && <a className="act" href={phoneHref(d.phone)}><span className="act-ico" style={{ background: '#0f766e' }}><Icon name="phone" /></span>חיוג</a>}
          {d.phone && !d.no_contact && <button type="button" className="act" onClick={() => setMsg('whatsapp')}><span className="act-ico" style={{ background: '#1f8a4c' }}><Icon name="chat" /></span>וואטסאפ</button>}
          {d.email && !d.no_contact && <button type="button" className="act" onClick={() => setMsg('email')}><span className="act-ico" style={{ background: '#2b6cb0' }}><Icon name="mail" /></span>מייל</button>}
          {can(user, 'tx.write') && <button type="button" className="act" onClick={() => setModal({ type: 'donation' })}><span className="act-ico" style={{ background: '#1f6f4a' }}><Icon name="shekel" /></span>תרומה</button>}
          {can(user, 'keva.actions') && <button type="button" className="act" onClick={() => setModal({ type: 'keva' })}><span className="act-ico" style={{ background: '#16357a' }}><Icon name="repeat" /></span>הו"ק</button>}
          {data.showFinance && <button type="button" className="act" onClick={() => setTab('docs')}><span className="act-ico" style={{ background: '#b8862b' }}><Icon name="receipt" /></span>קבלות</button>}
          <button type="button" className="act" onClick={() => setModal({ type: 'res', res: 'call_tasks', preset: { donor_id: d.id } })}><span className="act-ico" style={{ background: '#7a3fb0' }}><Icon name="task" /></span>משימה</button>
          <button type="button" className="act" onClick={() => setModal({ type: 'res', res: 'interactions', preset: { donor_id: d.id } })}><span className="act-ico" style={{ background: '#5b6478' }}><Icon name="note" /></span>תיעוד</button>
          {can(user, 'donors.write') && <button type="button" className="act" onClick={() => setModal({ type: 'res', res: 'donors', row: d })}><span className="act-ico" style={{ background: '#475569' }}><Icon name="pen" /></span>עריכה</button>}
        </div>
        {data.stats && (
          <div className="kpis" style={{ marginTop: 14 }}>
            <div className="kpi"><div className="label">סה"כ תרם</div><div className="value num">{money(data.stats.total)}</div></div>
            <div className="kpi"><div className="label">השנה</div><div className="value num">{money(data.stats.this_year)}</div></div>
            <div className="kpi"><div className="label">מספר תרומות</div><div className="value">{data.stats.count}</div></div>
            <div className="kpi"><div className="label">תרומה אחרונה</div><div className="value" style={{ fontSize: 18 }}>{date(data.stats.last) || '-'}</div></div>
            <div className="kpi"><div className="label">הו"ק פעילות</div><div className="value num">{money(data.keva.filter((k) => k.status === 'active').reduce((a, k) => a + Number(k.amount), 0))}</div></div>
          </div>
        )}
      </div>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'overview' && (
        <div className="grid2">
          <div className="card"><h3>פרטים</h3>
            <dl className="dl">
              {['id_number', 'phone2', 'address', 'country', 'language', 'currency', 'spouse_name', 'father_name', 'mother_name', 'status'].map((k) => {
                const f = meta.resources.donors.fields.find((x) => x.key === k);
                return d[k] ? <React.Fragment key={k}><dt>{f.label}</dt><dd>{renderValue(meta, f, d)}</dd></React.Fragment> : null;
              })}
              {d.institution_name && <><dt>מוסד מועדף</dt><dd>{d.institution_name}</dd></>}
              <dt>נוסף</dt><dd>{date(d.created_at)}</dd>
            </dl>
            {d.notes && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{d.notes}</p>}
          </div>
          <div className="card"><div className="row between"><h3>תיעוד אחרון</h3><button className="btn sm" onClick={() => setModal({ type: 'res', res: 'interactions', preset: { donor_id: d.id } })}>+ תיעוד</button></div>
            <Timeline items={data.interactions.slice(0, 6)} />
          </div>
          <div className="card"><div className="row between"><h3>משימות פתוחות</h3><button className="btn sm" onClick={() => setModal({ type: 'res', res: 'call_tasks', preset: { donor_id: d.id } })}>+ משימה</button></div>
            {data.tasks.filter((t) => !['done', 'cancelled'].includes(t.status)).map((t) => <div key={t.id} className="row between small" style={{ padding: '4px 0' }}><span>{CALL_REASON[t.reason]} · {date(t.due_date)}</span><span className="muted">{t.agent || 'לא משויך'}</span></div>)}
            {!data.tasks.some((t) => !['done', 'cancelled'].includes(t.status)) && <div className="muted small">אין</div>}
          </div>
          <div className="card"><div className="row between"><h3>תאריכים קרובים</h3><button className="btn sm" onClick={() => setModal({ type: 'res', res: 'donor_dates', preset: { donor_id: d.id } })}>+ תאריך</button></div>
            {data.dates.map((x) => <div key={x.id} className="small" style={{ padding: '3px 0' }}>{DATE_KIND[x.kind]}: {x.person_name} · {x.hebrew_day} {meta.options.hebMonth.find((m) => m.value === x.hebrew_month)?.label}</div>)}
            {!data.dates.length && <div className="muted small">אין</div>}
          </div>
        </div>
      )}
      {tab === 'timeline' && <DonorTimeline data={data} />}
      {tab === 'tx' && <TxTable rows={data.transactions} onChange={reload} hideDonor />}
      {tab === 'keva' && <KevaTable rows={data.keva} onChange={reload} hideDonor />}
      {tab === 'docs' && (
        <div className="stack">
          <div className="row">{can(user, 'docs.issue') && <button className="btn" onClick={() => run(() => api('/documents/annual', { method: 'POST', body: { donor_id: d.id, year: new Date().getFullYear() } }), (r) => `הופקה קבלה מרוכזת על ${r.count} תרומות`).then(reload)}>קבלה מרוכזת לשנה הנוכחית</button>}</div>
          <DocsTable rows={data.documents.map((x) => ({ ...x, donor_name: name }))} onChange={reload} />
        </div>
      )}
      {tab === 'log' && <div className="card"><div className="row between"><h3>תיעוד שיחות, פגישות וקבצים</h3><button className="btn sm primary" onClick={() => setModal({ type: 'res', res: 'interactions', preset: { donor_id: d.id } })}>+ תיעוד</button></div><Timeline items={data.interactions} /></div>}
      {tab === 'dates' && (
        <div className="card"><div className="row between"><h3>תאריכים עבריים</h3><button className="btn sm primary" onClick={() => setModal({ type: 'res', res: 'donor_dates', preset: { donor_id: d.id } })}>+ תאריך</button></div>
          <div className="table-wrap"><table className="t"><thead><tr><th>סוג</th><th>שם</th><th>קרבה</th><th>תאריך עברי</th><th>התראה</th></tr></thead><tbody>
            {data.dates.map((x) => <tr key={x.id} className="click" onClick={() => setModal({ type: 'res', res: 'donor_dates', row: x })}><td>{DATE_KIND[x.kind]}</td><td>{x.person_name}</td><td>{x.relation}</td><td>{x.hebrew_day} {meta.options.hebMonth.find((m) => m.value === x.hebrew_month)?.label}</td><td>{x.notify ? '✓' : ''}</td></tr>)}
          </tbody></table></div>
        </div>
      )}
      {tab === 'more' && (
        <div className="grid2">
          <div className="card"><div className="row between"><h3>התחייבויות</h3><button className="btn sm" onClick={() => setModal({ type: 'res', res: 'pledges', preset: { donor_id: d.id } })}>+</button></div>
            {data.pledges.map((p) => <div key={p.id} className="row between small" style={{ padding: '4px 0' }}><span>{p.reason} · {money(p.amount, p.currency)}</span>{p.status === 'open' && can(user, 'tx.write') ? <button className="btn sm" onClick={() => setModal({ type: 'donation', preset: { amount: p.amount, currency: p.currency, pledge_id: p.id } })}>גבייה</button> : <Tag>{p.status === 'paid' ? 'שולמה' : p.status}</Tag>}</div>)}
          </div>
          <div className="card"><h3>מבצעים רוחניים</h3>{data.spiritual.map((s) => <div key={s.id} className="small">{optLabel(meta, 'spiritualKind', s.kind)}: {s.name_for} {s.mother_name ? `בן/בת ${s.mother_name}` : ''} · {s.request}</div>)}{!data.spiritual.length && <div className="muted small">אין</div>}</div>
          <div className="card"><h3>אירועים</h3>{data.guests.map((g) => <div key={g.id} className="small">{g.event_name} · {date(g.event_date)} · {optLabel(meta, 'rsvp', g.rsvp)} {Number(g.pledged_amount) > 0 && `· ${money(g.pledged_amount)}`}</div>)}{!data.guests.length && <div className="muted small">אין</div>}</div>
          <div className="card"><h3>הודעות שנשלחו</h3>{data.messages.map((m) => <div key={m.id} className="small" style={{ padding: '3px 0' }}><Tag>{m.channel}</Tag> {datetime(m.at)} · {String(m.body).slice(0, 70)}</div>)}{!data.messages.length && <div className="muted small">אין</div>}</div>
        </div>
      )}
      {modal?.type === 'res' && <ResourceForm resKey={modal.res} row={modal.row} preset={modal.preset} onClose={() => setModal(null)} onSaved={(r) => { setModal(null); if (modal.res === 'donors' && r === null) navigate('/app/donors'); else reload(); }} />}
      {modal?.type === 'donation' && <NewDonation donorId={d.id} preset={modal.preset} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal?.type === 'keva' && <NewKeva donorId={d.id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {msg && <SendMessage donorId={d.id} channel={msg} name={name} onClose={() => setMsg(null)} onDone={() => { setMsg(null); reload(); }} />}
    </div>
  );
}

// ציר זמן אחד לכל מה שקרה עם התורם: תרומות, קבלות, שיחות, הודעות
function DonorTimeline({ data }) {
  const items = [
    ...(data.transactions || []).map((t) => ({ at: t.date, icon: 'shekel', color: ['failed', 'bounced'].includes(t.status) ? '#c53030' : '#1f6f4a', title: `תרומה ${money(t.amount, t.currency)}`, sub: `${SOURCE_LABELS[t.source] || t.source} · ${(TX_STATUS[t.status] || [t.status])[0]}` })),
    ...(data.documents || []).map((x) => ({ at: x.issued_at || x.created_at || x.date, icon: 'receipt', color: '#b8862b', title: `${DOC_TYPES[x.type] || 'מסמך'} ${x.number || ''}`, sub: x.status === 'cancelled' ? 'בוטלה' : money(x.amount) })),
    ...(data.interactions || []).map((i) => ({ at: i.at, icon: i.kind === 'call' ? 'phone' : i.kind === 'meeting' ? 'donors' : 'note', color: '#5b6478', title: i.summary, sub: i.user_name || '' })),
    ...(data.messages || []).map((m) => ({ at: m.at, icon: m.channel === 'email' ? 'mail' : 'chat', color: '#2b6cb0', title: String(m.body || '').slice(0, 80), sub: m.channel })),
    ...(data.keva || []).map((k) => ({ at: k.created_at || k.start_date, icon: 'repeat', color: '#16357a', title: `הוראת קבע ${money(k.amount, k.currency)} בחודש`, sub: (SO_STATUS[k.status] || [k.status])[0] })),
  ].filter((x) => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 80);
  if (!items.length) return <div className="card muted">אין עדיין פעילות</div>;
  return (
    <div className="card">
      <div className="tl2">
        {items.map((x, i) => (
          <div key={i} className="tl2-item">
            <span className="tl2-ico" style={{ background: x.color }}><Icon name={x.icon} size={16} /></span>
            <div className="tl2-body"><div>{x.title}</div><div className="small muted">{date(x.at)}{x.sub ? ` · ${x.sub}` : ''}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SendMessage({ donorId, channel, name, onClose, onDone }) {
  const [body, setBody] = useState(`שלום ${name}, `);
  const [subject, setSubject] = useState('');
  const { data } = useApi('/r/materials?size=50');
  return (
    <Modal title={channel === 'email' ? 'שליחת מייל' : 'שליחת וואטסאפ'} onClose={onClose} footer={<><button className="btn primary" onClick={() => run(() => api(`/donors/${donorId}/message`, { method: 'POST', body: { channel, body, subject } }), (r) => (r.sandbox ? 'נרשם ביומן ההודעות (הדמיה)' : 'נשלח')).then(onDone)}>שליחה</button><button className="btn" onClick={onClose}>ביטול</button></>}>
      <div className="stack">
        {channel === 'email' && <Field label="נושא"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
        <Field label="תוכן"><textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        {data?.rows?.length > 0 && <div className="row small">צירוף חומר: {data.rows.map((m) => <button key={m.id} className="btn sm" onClick={() => setBody(`${body}\n${m.title}: ${m.url}`)}>{m.title}</button>)}</div>}
      </div>
    </Modal>
  );
}

function Timeline({ items }) {
  if (!items.length) return <div className="muted small">אין תיעוד</div>;
  return (
    <div className="timeline">
      {items.map((i) => (
        <div key={i.id} className={`tl-item ${i.kind}`}>
          <div className="small muted">{datetime(i.at)} · {i.user_name || ''} · {{ call: 'שיחה', meeting: 'פגישה', whatsapp: 'וואטסאפ', email: 'מייל', note: 'הערה', visit: 'ביקור', file: 'קובץ' }[i.kind] || i.kind}</div>
          <div>{i.summary}</div>
          {i.follow_up_date && <div className="small">מעקב: {date(i.follow_up_date)}</div>}
          {i.file_name && <div className="small">📎 {i.file_name}</div>}
        </div>
      ))}
    </div>
  );
}

// ---------- טבלת תנועות ----------
function TxActions({ t, onChange }) {
  const { user } = useContext(AppCtx);
  const [confirm, setConfirm] = useState(null);
  const act = (action, extra = {}) => run(() => api(`/transactions/${t.id}/action`, { method: 'POST', body: { action, ...extra } }), (r) => r.message).then(onChange);
  return (
    <div className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
      {t.status === 'paid' && !t.document_id && can(user, 'docs.issue') && <button className="btn sm" onClick={() => run(() => api(`/transactions/${t.id}/document`, { method: 'POST', body: {} }), (r) => `הופקה ${r.document.number}`).then(onChange)}>קבלה</button>}
      {!t.approved && can(user, 'tx.approve') && <button className="btn sm primary" onClick={() => act('approve')}>אישור</button>}
      {['failed', 'bounced'].includes(t.status) && can(user, 'tx.actions') && <button className="btn sm" onClick={() => act('retry')}>חיוב חוזר</button>}
      {t.status === 'paid' && can(user, 'tx.actions') && <button className="btn sm danger" onClick={() => setConfirm('refund')}>זיכוי</button>}
      {t.method === 'check' && t.status !== 'bounced' && can(user, 'tx.actions') && <button className="btn sm danger" onClick={() => setConfirm('bounce')}>צ׳ק חזר</button>}
      {confirm && <Confirm danger title={confirm === 'refund' ? 'זיכוי תנועה' : 'סימון צ׳ק שחזר'} needReason={confirm === 'bounce'}
        text={confirm === 'refund' ? `הזיכוי יישלח ל${SOURCE_LABELS[t.source] || 'מקור'} ויירשם ביומן. אם הופקה קבלה - יש להפיק לה זיכוי.` : 'התנועה תסומן כחזרה.'}
        onClose={() => setConfirm(null)} onYes={(reason) => { setConfirm(null); act(confirm, { reason }); }} />}
    </div>
  );
}

// צבע שורה לפי מצב: ירוק = שולם עם קבלה, צהוב = שולם בלי קבלה, אדום = נכשל, אפור = בוטל/זוכה
function txTone(t) {
  if (['failed', 'bounced'].includes(t.status)) return 'tone-bad';
  if (['cancelled', 'refunded'].includes(t.status)) return 'tone-off';
  if (!t.approved) return 'tone-warn';
  if (t.status === 'paid') return t.document_id || t.document_number ? 'tone-ok' : 'tone-warn';
  return 'tone-info';
}
// כותרות תאריך בסגנון וואטסאפ: היום, אתמול, שם היום עד שבוע, ואחר כך תאריך
export function dayLabel(v) {
  if (!v) return '';
  const d = new Date(String(v).slice(0, 10) + 'T00:00:00');
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return 'היום';
  if (diff === 1) return 'אתמול';
  if (diff > 1 && diff < 7) return `יום ${d.toLocaleDateString('he-IL', { weekday: 'long' }).replace('יום ', '')}`;
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: d.getFullYear() !== t.getFullYear() ? 'numeric' : undefined });
}

function TxList({ rows, hideDonor, onOpen, onChange }) {
  let lastDay = null;
  return (
    <div className="tx-list">
      {rows.map((t) => {
        const day = String(t.date).slice(0, 10);
        const head = day !== lastDay ? <div className="day-head" key={`h${day}`}>{dayLabel(t.date)}</div> : null;
        lastDay = day;
        return (
          <React.Fragment key={t.id}>
            {head}
            <div className={`tx-row ${txTone(t)}`} onClick={() => onOpen(t)}>
              <span className="tx-src"><Src s={t.source} short /></span>
              <span className="tx-main">
                <b className="tx-name">{hideDonor ? (KIND_LABELS[t.kind] || t.kind) : (t.donor_name || '-')}</b>
                <span className="small muted">{SOURCE_LABELS[t.source] || t.source} · {METHOD_LABELS[t.method] || t.method}{t.institution_name ? ` · ${t.institution_name}` : ''}</span>
              </span>
              <span className="tx-amt num"><b>{money(t.amount, t.currency)}</b><span className="small">{(TX_STATUS[t.status] || [t.status])[0]}{t.document_number ? ' · קבלה' : ''}</span></span>
              <span className="tx-act" onClick={(e) => e.stopPropagation()}><TxActions t={t} onChange={onChange} /></span>
            </div>
          </React.Fragment>
        );
      })}
      {!rows.length && <div className="empty">אין תנועות</div>}
    </div>
  );
}

export function TxTable({ rows, onChange, hideDonor, selectable, selected, setSelected }) {
  const [open, setOpen] = useState(null);
  return (
    <>
    <div className="only-mobile"><TxList rows={rows} hideDonor={hideDonor} onOpen={setOpen} onChange={onChange} /></div>
    <div className="table-wrap only-desktop">
      <table className="t">
        <thead><tr>{selectable && <th />}<th>תאריך</th>{!hideDonor && <th>תורם</th>}<th>סכום</th><th>מקור</th><th>סוג</th><th>מוסד</th><th>סטטוס</th><th>קבלה</th><th /></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className={`click ${txTone(t)} ${selected?.includes(t.id) ? 'sel' : ''}`} onClick={() => setOpen(t)}>
              {selectable && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.includes(t.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id))} /></td>}
              <td className="nowrap">{date(t.date)}</td>
              {!hideDonor && <td>{t.donor_id ? <Link to={`/app/donors/${t.donor_id}`} onClick={(e) => e.stopPropagation()}>{t.donor_name}</Link> : '-'}{t.is_demo && <> <Tag kind="demo">דוגמה</Tag></>}</td>}
              <td className="num nowrap"><b>{money(t.amount, t.currency)}</b>{t.currency !== 'ILS' && <div className="small muted">{money(t.amount_ils)}</div>}</td>
              <td><Src s={t.source} /></td>
              <td className="small">{KIND_LABELS[t.kind] || t.kind} · {METHOD_LABELS[t.method] || t.method}{t.installments > 1 && ` · ${t.installments} תש׳`}</td>
              <td className="small">{t.institution_name}</td>
              <td><TxStatus s={t.status} />{!t.approved && <> <Tag kind="warn">לאישור</Tag></>}</td>
              <td className="small">{t.document_number || t.document_id ? <span>{t.document_number}{t.tax_report_status && <> <Tag kind={(TAX_STATUS[t.tax_report_status] || [])[1]}>{(TAX_STATUS[t.tax_report_status] || [])[0]}</Tag></>}</span> : <span className="muted">—</span>}</td>
              <td><TxActions t={t} onChange={onChange} /></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={10} className="empty">אין תנועות</td></tr>}
        </tbody>
      </table>
    </div>
    {open && <TxDetail t={open} onClose={() => setOpen(null)} onChange={() => { setOpen(null); onChange?.(); }} />}
    </>
  );
}

function TxDetail({ t, onClose, onChange }) {
  const { user } = useContext(AppCtx);
  const [f, setF] = useState({ institution_id: t.institution_id, campaign_id: t.campaign_id, dedication: t.dedication || '', notes: t.notes || '' });
  return (
    <Modal title={`תנועה ${t.serial || t.id}`} onClose={onClose} footer={can(user, 'tx.actions') ? <><button className="btn primary" onClick={() => run(() => api(`/transactions/${t.id}`, { method: 'PUT', body: f }), 'עודכן').then(onChange)}>שמירה</button><button className="btn" onClick={onClose}>סגירה</button></> : null}>
      <dl className="dl">
        <dt>תורם</dt><dd>{t.donor_name}</dd>
        <dt>סכום</dt><dd className="num">{money(t.amount, t.currency)} {t.currency !== 'ILS' && `(${money(t.amount_ils)})`}</dd>
        <dt>מקור</dt><dd><Src s={t.source} /> {t.external_id && <span className="small muted num">מזהה אצל הספק: {t.external_id}</span>}</dd>
        <dt>סטטוס</dt><dd><TxStatus s={t.status} /> {t.failure_reason}</dd>
        {t.card_last4 && <><dt>כרטיס</dt><dd className="num">****{t.card_last4}</dd></>}
        {t.check_number && <><dt>צ׳ק</dt><dd>{t.check_number} · {t.check_bank} · פירעון {date(t.check_due_date)}</dd></>}
        {t.recruiter_name && <><dt>מתרים</dt><dd>{t.recruiter_name}</dd></>}
      </dl>
      <div className="form-grid" style={{ marginTop: 14 }}>
        <Field label="מוסד"><RefPicker res="institutions" value={f.institution_id} onChange={(v) => setF({ ...f, institution_id: v })} /></Field>
        <Field label="קמפיין"><RefPicker res="campaigns" value={f.campaign_id} onChange={(v) => setF({ ...f, campaign_id: v })} /></Field>
        <Field label="הקדשה" full><input className="input" value={f.dedication} onChange={(e) => setF({ ...f, dedication: e.target.value })} /></Field>
        <Field label="הערות" full><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function TransactionsPage() {
  const { query } = useRoute();
  const { demoMode, user } = useContext(AppCtx);
  const [f, setF] = useState({ q: '', source: '', status: query.status || '', kind: '', institution_id: '', campaign_id: '', from: '', to: '', no_document: query.no_document || '', pending_approval: query.pending_approval || '' });
  const dq = useDebounced(f.q);
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState([]);
  const [add, setAdd] = useState(false);
  const { data, reload, loading } = useApi(`/transactions${qs({ ...f, q: dq, page, demo: demoMode })}`);
  const set = (k) => (e) => { setPage(1); setF({ ...f, [k]: e?.target ? e.target.value : e }); };
  return (
    <div>
      <div className="page-head">
        <h1>יומן תנועות מאוחד</h1>
        <div className="row">
          {sel.length > 0 && can(user, 'docs.issue') && <button className="btn" onClick={() => run(() => api('/transactions/bulk-documents', { method: 'POST', body: { ids: sel } }), (r) => `הופקו ${r.results.filter((x) => x.ok).length} מתוך ${r.results.length}`).then(() => { setSel([]); reload(); })}>הפקת קבלות ל-{sel.length} מסומנות</button>}
          <button className="btn" onClick={() => run(() => download(`/reports/accountant${qs({ from: f.from, to: f.to, format: 'csv', demo: demoMode })}`, 'transactions.csv'))}>ייצוא</button>
          {can(user, 'tx.write') && <button className="btn primary" onClick={() => setAdd(true)}>+ תרומה</button>}
        </div>
      </div>
      <p className="muted small" style={{ marginTop: -6 }}>כל תנועה מכל ספק - עם המקור שממנו ירדה. פעולות (זיכוי, חיוב חוזר, קבלה) נשלחות לספק המקורי.</p>
      {data?.bySource && (
        <div className="row" style={{ marginBottom: 10 }}>
          <button className={`btn sm ${!f.source ? 'primary' : ''}`} onClick={() => set('source')('')}>כל המקורות · {money(data.total)}</button>
          {data.bySource.map((s) => <button key={s.source} className={`btn sm ${f.source === s.source ? 'primary' : ''}`} onClick={() => set('source')(s.source)}>{data.sourceLabels[s.source]} · {money(s.total)} ({s.c})</button>)}
        </div>
      )}
      <div className="toolbar">
        <input className="input search" placeholder="תורם, טלפון, אסמכתא, מזהה ספק, מס׳ צ׳ק…" value={f.q} onChange={set('q')} />
        <select className="input" value={f.status} onChange={set('status')}><option value="">כל הסטטוסים</option>{Object.entries(TX_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" value={f.kind} onChange={set('kind')}><option value="">כל הסוגים</option>{Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <div style={{ minWidth: 170 }}><RefPicker res="institutions" value={f.institution_id} onChange={set('institution_id')} placeholder="מוסד" /></div>
        <div style={{ minWidth: 170 }}><RefPicker res="campaigns" value={f.campaign_id} onChange={set('campaign_id')} placeholder="קמפיין" /></div>
        <input className="input" type="date" value={f.from} onChange={set('from')} title="מתאריך" />
        <input className="input" type="date" value={f.to} onChange={set('to')} title="עד תאריך" />
        <label className="check small"><input type="checkbox" checked={f.no_document === 'true'} onChange={(e) => set('no_document')(e.target.checked ? 'true' : '')} />ללא קבלה</label>
        <label className="check small"><input type="checkbox" checked={f.pending_approval === 'true'} onChange={(e) => set('pending_approval')(e.target.checked ? 'true' : '')} />לאישור</label>
      </div>
      {loading && !data ? <Spinner /> : <TxTable rows={data?.rows || []} onChange={reload} selectable selected={sel} setSelected={setSel} />}
      {data && <div className="pager"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>הקודם</button><span className="small">{data.count} תנועות · עמוד {page}</span><button className="btn sm" disabled={page * data.size >= data.count} onClick={() => setPage(page + 1)}>הבא</button></div>}
      {add && <NewDonation onClose={() => setAdd(false)} onDone={() => { setAdd(false); reload(); }} />}
    </div>
  );
}

// ---------- הוראות קבע ----------
function KevaActions({ k, onChange }) {
  const { user } = useContext(AppCtx);
  const [dlg, setDlg] = useState(null);
  const [amount, setAmount] = useState(k.amount);
  if (!can(user, 'keva.actions')) return null;
  const act = (action, extra = {}) => run(() => api(`/keva/${k.id}/action`, { method: 'POST', body: { action, ...extra } }), (r) => r.message).then(() => { setDlg(null); onChange(); });
  return (
    <div className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
      {k.status === 'active' && <button className="btn sm" onClick={() => act('freeze')}>הקפאה</button>}
      {['frozen', 'failed'].includes(k.status) && <button className="btn sm" onClick={() => act('resume')}>הפעלה</button>}
      {['active', 'frozen', 'failed'].includes(k.status) && <button className="btn sm" onClick={() => setDlg('amount')}>סכום</button>}
      {['active', 'failed'].includes(k.status) && <button className="btn sm" onClick={() => setDlg('charge')}>חיוב בודד</button>}
      {!['cancelled', 'ended'].includes(k.status) && <button className="btn sm danger" onClick={() => setDlg('cancel')}>ביטול</button>}
      {dlg === 'cancel' && <Confirm danger needReason title="ביטול הוראת קבע" text={`הביטול יישלח ל${SOURCE_LABELS[k.source] || 'ספק'}, ותיפתח משימת חידוש במוקד.`} onClose={() => setDlg(null)} onYes={(reason) => act('cancel', { reason })} />}
      {(dlg === 'amount' || dlg === 'charge') && (
        <Modal title={dlg === 'amount' ? 'שינוי סכום הו"ק' : 'חיוב בודד'} size="narrow" onClose={() => setDlg(null)} footer={<button className="btn primary" onClick={() => act(dlg === 'amount' ? 'amount' : 'charge_once', { amount })}>אישור</button>}>
          <Field label="סכום"><input className="input num" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <p className="small muted">הפעולה תבוצע ב{SOURCE_LABELS[k.source]}.</p>
        </Modal>
      )}
    </div>
  );
}

export function KevaTable({ rows, onChange, hideDonor }) {
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr>{!hideDonor && <th>תורם</th>}<th>סכום</th><th>מקור</th><th>סוג</th><th>יום</th><th>שולמו</th><th>סיום</th><th>מוסד</th><th>סטטוס</th><th /></tr></thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k.id}>
              {!hideDonor && <td><Link to={`/app/donors/${k.donor_id}`}>{k.donor_name}</Link>{k.is_demo && <> <Tag kind="demo">דוגמה</Tag></>}</td>}
              <td className="num"><b>{money(k.amount, k.currency)}</b></td>
              <td><Src s={k.source} /></td>
              <td className="small">{k.type === 'bank' ? `בנק ${k.bank_code || ''}-${k.branch_code || ''} ${k.account_masked || ''}` : `אשראי ${k.card_last4 ? `****${k.card_last4}` : ''}`}</td>
              <td>{k.day_of_month}</td>
              <td>{k.months_paid}{k.months_total ? `/${k.months_total}` : ''}</td>
              <td className="small">{date(k.end_date)}</td>
              <td className="small">{k.institution_name}</td>
              <td><SoStatus s={k.status} />{k.failures > 0 && <> <Tag kind="bad">{k.failures} כשלונות</Tag></>}{k.cancel_reason && <div className="small muted">{k.cancel_reason}</div>}</td>
              <td><KevaActions k={k} onChange={onChange} /></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={10} className="empty">אין הוראות קבע</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function KevaPage() {
  const { query } = useRoute();
  const { demoMode, user } = useContext(AppCtx);
  const [f, setF] = useState({ q: '', status: '', source: '', type: '', churn: query.churn || '', ending: '' });
  const dq = useDebounced(f.q);
  const { data, reload, loading } = useApi(`/keva${qs({ ...f, q: dq, demo: demoMode })}`);
  const [add, setAdd] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  return (
    <div>
      <div className="page-head"><h1>הוראות קבע - כל הספקים</h1>
        <div className="row">{can(user, 'keva.actions') && <><Link className="btn" to="/app/masav">קובץ מס"ב</Link><button className="btn primary" onClick={() => setAdd(true)}>+ הו"ק בנקאית</button></>}</div>
      </div>
      {data && <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="label">פעילות</div><div className="value">{data.summary.active}</div></div>
        <div className="kpi"><div className="label">צפי חודשי</div><div className="value num">{money(data.summary.monthly)}</div></div>
        <div className="kpi"><div className="label">מוקפאות</div><div className="value">{data.summary.frozen}</div></div>
        <div className={`kpi ${data.summary.failed ? 'alert' : ''}`}><div className="label">נכשלו</div><div className="value">{data.summary.failed}</div></div>
      </div>}
      <div className="toolbar">
        <input className="input search" placeholder="חיפוש תורם / טלפון" value={f.q} onChange={set('q')} />
        <select className="input" value={f.status} onChange={set('status')}><option value="">כל הסטטוסים</option>{Object.entries(SO_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" value={f.source} onChange={set('source')}><option value="">כל הספקים</option>{['nedarim', 'jgive', 'kehilot', 'masav', 'cardcom', 'tranzila', 'grow', 'payplus', 'manual'].map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}</select>
        <select className="input" value={f.type} onChange={set('type')}><option value="">אשראי + בנק</option><option value="credit">אשראי</option><option value="bank">בנקאית</option></select>
        <label className="check small"><input type="checkbox" checked={f.churn === 'true'} onChange={(e) => set('churn')(e.target.checked ? 'true' : '')} />נטישה (90 יום)</label>
        <label className="check small"><input type="checkbox" checked={f.ending === 'true'} onChange={(e) => set('ending')(e.target.checked ? 'true' : '')} />מסתיימות בקרוב</label>
      </div>
      {loading && !data ? <Spinner /> : <KevaTable rows={data?.rows || []} onChange={reload} />}
      {add && <NewKeva onClose={() => setAdd(false)} onDone={() => { setAdd(false); reload(); }} />}
    </div>
  );
}

export function NewKeva({ donorId, onClose, onDone, field }) {
  const [f, setF] = useState({ donor_id: donorId || null, type: 'bank', amount: '', day_of_month: 10, bank_code: '', branch_code: '', account_number: '', start_date: today() });
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  return (
    <Modal title="הוראת קבע בנקאית חדשה" onClose={onClose} footer={<><button className="btn primary" disabled={!f.donor_id || !f.amount || !f.account_number} onClick={() => run(() => api('/keva', { method: 'POST', body: f }), 'הו"ק נרשמה').then(onDone)}>שמירה</button><button className="btn" onClick={onClose}>ביטול</button></>}>
      <div className="form-grid">
        {!donorId && <Field label="תורם *" full><RefPicker res="donors" value={f.donor_id} onChange={set('donor_id')} /></Field>}
        <Field label="סכום חודשי *" full>
          <div className="amount-chips">{[36, 50, 100, 180, 360, 500].map((v) => <button type="button" key={v} className={`chip-amt ${Number(f.amount) === v ? 'on' : ''}`} onClick={() => set('amount')(String(v))}>{v.toLocaleString('he-IL')}</button>)}</div>
          <input className="input num" type="number" inputMode="decimal" placeholder="או סכום אחר" value={f.amount} onChange={set('amount')} />
        </Field>
        <Field label="יום חיוב"><select className="input" value={f.day_of_month} onChange={set('day_of_month')}>{[1, 5, 10, 15, 20, 25].map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="בנק"><input className="input num" value={f.bank_code} onChange={set('bank_code')} /></Field>
        <Field label="סניף"><input className="input num" value={f.branch_code} onChange={set('branch_code')} /></Field>
        <Field label="חשבון *"><input className="input num" value={f.account_number} onChange={set('account_number')} /></Field>
        <Field label="תאריך התחלה"><input className="input" type="date" value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="מספר חודשים (ריק = ללא הגבלה)"><input className="input" type="number" value={f.months_total || ''} onChange={set('months_total')} /></Field>
        <Field label="מוסד"><RefPicker res="institutions" value={f.institution_id} onChange={set('institution_id')} /></Field>
        <div className="full notice small">מספר החשבון נשמר בצד השרת לצורך הפקת קובץ מס"ב בלבד, ומוצג במסכים בצורה מוסתרת. יש לצרף כתב הרשאה חתום מהתורם.</div>
      </div>
    </Modal>
  );
}

// ---------- מסמכים ----------
export function DocsTable({ rows, onChange }) {
  const { user } = useContext(AppCtx);
  const [cancel, setCancel] = useState(null);
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>מספר</th><th>סוג</th><th>תאריך</th><th>תורם</th><th>סכום</th><th>ספק</th><th>דיווח לרשות המסים</th><th>סטטוס</th><th /></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td className="num">{d.number}{d.sandbox && <> <Tag kind="demo">Sandbox</Tag></>}</td>
              <td className="small">{DOC_TYPES[d.type]}{d.is_annual && ' (שנתית)'}</td>
              <td className="small nowrap">{date(d.issued_at)}</td>
              <td>{d.donor_id ? <Link to={`/app/donors/${d.donor_id}`}>{d.donor_name}</Link> : '-'}</td>
              <td className="num">{money(d.amount, d.currency)}</td>
              <td><Src s={d.provider} /></td>
              <td>{(() => { const [l, k] = TAX_STATUS[d.tax_report_status] || ['', '']; return <><Tag kind={k}>{l}</Tag> <span className="small muted num">{d.tax_report_number}</span></>; })()}</td>
              <td>{d.status === 'cancelled' ? <Tag kind="bad">בוטל</Tag> : <Tag kind="ok">בתוקף</Tag>}</td>
              <td className="nowrap">
                {d.pdf_url && <a className="btn sm" href={d.pdf_url} target="_blank" rel="noopener">PDF</a>}
                {d.status === 'active' && can(user, 'docs.issue') && <><button className="btn sm" onClick={() => run(() => api(`/documents/${d.id}/send`, { method: 'POST', body: { channel: 'email' } }), 'נשלח במייל').then(onChange)}>מייל</button><button className="btn sm" onClick={() => run(() => api(`/documents/${d.id}/send`, { method: 'POST', body: { channel: 'whatsapp' } }), 'נשלח בוואטסאפ').then(onChange)}>וואטסאפ</button></>}
                {d.status === 'active' && d.type !== 'credit' && can(user, 'docs.cancel') && <button className="btn sm danger" onClick={() => setCancel(d)}>ביטול</button>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={9} className="empty">אין מסמכים</td></tr>}
        </tbody>
      </table>
      {cancel && <Confirm danger needReason title={`ביטול מסמך ${cancel.number}`} text="לפי חוק ניהול ספרים מסמך לא נמחק: הוא יסומן כמבוטל ויופק מסמך זיכוי בספק. הביטול ידווח גם ל'תרומות ישראל'." onClose={() => setCancel(null)}
        onYes={(reason) => run(() => api(`/documents/${cancel.id}/cancel`, { method: 'POST', body: { reason } }), 'בוטל והופק זיכוי').then(() => { setCancel(null); onChange?.(); })} />}
    </div>
  );
}

export function DocumentsPage() {
  const { query } = useRoute();
  const { demoMode } = useContext(AppCtx);
  const [f, setF] = useState({ q: '', type: '', tax_report_status: query.tax_report_status || '', status: '', from: '', to: '' });
  const dq = useDebounced(f.q);
  const { data, reload } = useApi(`/documents${qs({ ...f, q: dq, demo: demoMode })}`);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div>
      <div className="page-head"><h1>קבלות ומסמכים</h1><button className="btn" onClick={() => run(() => download(`/reports/documents${qs({ from: f.from, to: f.to, format: 'csv' })}`, 'documents.csv'))}>ייצוא</button></div>
      <div className="notice small" style={{ marginBottom: 12 }}>מ-1.1.2026 כל קבלה לפי סעיף 46 חייבת מספר דיווח מ"תרומות ישראל". המסמכים מופקים דרך ספק מחובר (חשבונית ירוקה וכו׳) שמחזיר את מספר הדיווח.</div>
      <div className="toolbar">
        <input className="input search" placeholder="תורם / מספר מסמך" value={f.q} onChange={set('q')} />
        <select className="input" value={f.type} onChange={set('type')}><option value="">כל הסוגים</option>{Object.entries(DOC_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" value={f.tax_report_status} onChange={set('tax_report_status')}><option value="">כל מצבי הדיווח</option>{Object.entries(TAX_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" value={f.status} onChange={set('status')}><option value="">בתוקף + בוטלו</option><option value="active">בתוקף</option><option value="cancelled">בוטלו</option></select>
        <input className="input" type="date" value={f.from} onChange={set('from')} /><input className="input" type="date" value={f.to} onChange={set('to')} />
      </div>
      {data ? <DocsTable rows={data.rows} onChange={reload} /> : <Spinner />}
    </div>
  );
}

export { SignaturePad };
