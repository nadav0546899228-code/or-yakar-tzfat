// חיובים חודשיים יזומים: בכל חודש מסמנים את מי לחייב מבין התורמים שיש להם כרטיס שמור, ומאשרים.
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { Link, api, money, date, datetime, Modal, AppCtx, useApi, Spinner, qs, run, toast, Tag, useDebounced, navigate, phoneHref } from './lib.jsx';
import { SOURCE_LABELS } from './labels.js';
import { can } from './app.jsx';
import { Icon } from './icons.jsx';

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(m) {
  const [y, mo] = String(m).split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

const EXP = { expired: ['כרטיס פג', 'bad'], expiring: ['פג בקרוב', 'warn'], unknown: ['תוקף לא ידוע', ''], ok: null };
const ITEM_STATUS = { success: ['עבר', 'ok'], failed: ['נכשל', 'bad'], skipped: ['דולג', ''], processing: ['בתהליך', 'warn'] };
const BATCH_STATUS = { processing: 'בביצוע', completed: 'הסתיים', interrupted: 'נקטע - נדרשת בדיקה' };

function rowState(r) {
  if (r.paid_tx_id) return 'paid';
  if (r.exp_state === 'expired' || r.status === 'failed' || r.prev_status === 'failed') return 'problem';
  return 'ready';
}
const TONE = { paid: 'tone-off', problem: 'tone-bad', ready: 'tone-ok' };

export function MonthlyChargesPage() {
  const { user, demoMode } = useContext(AppCtx);
  const [month, setMonth] = useState(thisMonth());
  const [scope, setScope] = useState('manual');
  const [q, setQ] = useState('');
  const [show, setShow] = useState('');
  const dq = useDebounced(q);
  const { data, loading, reload } = useApi(`/monthly-charges${qs({ month, scope, demo: demoMode })}`);
  const [sel, setSel] = useState({});
  const [amounts, setAmounts] = useState({});
  const [issueDocs, setIssueDocs] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const canAct = can(user, 'keva.actions');

  // ברירת מחדל: מסומן כל מי שלא חויב החודש ואין לו בעיה בכרטיס
  useEffect(() => {
    if (!data) return;
    const s = {};
    for (const r of data.rows) if (rowState(r) === 'ready') s[r.id] = true;
    setSel(s);
    setAmounts({});
  }, [data?.month, data?.rows?.length, scope]);

  const rows = useMemo(() => {
    let list = data?.rows || [];
    if (dq) list = list.filter((r) => `${r.donor_name} ${r.donor_phone || ''}`.includes(dq));
    if (show) list = list.filter((r) => rowState(r) === show);
    return list;
  }, [data, dq, show]);

  const amountOf = (r) => Number(amounts[r.id] ?? r.amount);
  const chosen = (data?.rows || []).filter((r) => sel[r.id] && !r.paid_tx_id);
  const total = chosen.reduce((a, r) => a + amountOf(r), 0);
  const counts = useMemo(() => {
    const c = { paid: 0, problem: 0, ready: 0 };
    for (const r of data?.rows || []) c[rowState(r)]++;
    return c;
  }, [data]);

  const toggle = (id) => setSel((s) => ({ ...s, [id]: !s[id] }));
  const selectAll = () => setSel(Object.fromEntries(rows.filter((r) => !r.paid_tx_id).map((r) => [r.id, true]).concat(Object.entries(sel).filter(([, v]) => v))));
  const clearAll = () => setSel({});

  const execute = async (items) => {
    setBusy(true);
    try {
      let r = await api('/monthly-charges/run', { method: 'POST', body: { month, items, issue_documents: issueDocs } });
      setConfirm(false);
      setResult(r);
      // הסבב רץ בשרת ברקע - מתעדכנים כל שתי שניות עד שהוא מסתיים
      while (r?.batch?.status === 'processing') {
        await new Promise((ok) => setTimeout(ok, 2000));
        try { r = await api(`/monthly-charges/batches/${r.batch.id}`); setResult(r); } catch { /* ניסיון נוסף בסבב הבא */ }
      }
      reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const setMode = (r, mode) => run(() => api(`/monthly-charges/so/${r.id}`, { method: 'POST', body: { charge_mode: mode } }), mode === 'manual' ? 'הועבר לחיוב בהחלטה חודשית' : 'הוחזר להו"ק רגילה').then(reload);
  const setExp = (r) => {
    const v = window.prompt('תוקף הכרטיס (MM/YY)', r.card_exp || '');
    if (v === null) return;
    run(() => api(`/monthly-charges/so/${r.id}`, { method: 'POST', body: { card_exp: v } }), 'התוקף עודכן').then(reload);
  };

  return (
    <div style={{ paddingBottom: canAct ? 90 : 0 }}>
      <div className="page-head">
        <h1>חיובים חודשיים</h1>
        <div className="row">
          <input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 'auto' }} />
          <Link className="btn" to="/app/monthly-charges/history">היסטוריה</Link>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: -6 }}>חיוב יזום של כרטיסים שמורים אצל ספק הסליקה. אתה מחליט בכל חודש את מי לחייב ובכמה. פרטי הכרטיס עצמם לא נשמרים במערכת, רק מפתח (טוקן) שהספק החזיר.</p>

      {data?.sandbox && <div className="notice warn small" style={{ marginBottom: 12 }}>סביבת פיתוח: החיובים רצים בהדמיה ולא יורד כסף אמיתי. בערך 1 מכל 8 חיובים "נכשל" בכוונה, כדי לבדוק את דוח הנכשלים.</div>}

      {data && <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi link" onClick={() => setShow('ready')}><div className="label">מוכנים לחיוב</div><div className="value">{counts.ready}</div></div>
        <div className="kpi"><div className="label">מסומנים · סכום</div><div className="value num">{chosen.length} · {money(total)}</div></div>
        <div className="kpi link" onClick={() => setShow('paid')}><div className="label">כבר חויבו ב{monthLabel(month)}</div><div className="value">{counts.paid}</div></div>
        <div className={`kpi link ${counts.problem ? 'alert' : ''}`} onClick={() => setShow('problem')}><div className="label">דורשים טיפול</div><div className="value">{counts.problem}</div></div>
      </div>}

      <div className="toolbar">
        <input className="input search" placeholder="חיפוש שם / טלפון" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="">כולם</option><option value="ready">מוכנים לחיוב</option><option value="paid">חויבו החודש</option><option value="problem">דורשים טיפול</option>
        </select>
        <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="manual">רק חיוב בהחלטה חודשית</option><option value="all">כל הו"ק באשראי עם כרטיס שמור</option>
        </select>
        {canAct && <><button className="btn sm" onClick={selectAll}>סמן הכל</button><button className="btn sm" onClick={clearAll}>נקה סימון</button></>}
        {canAct && data?.sandbox && <button className="btn sm" onClick={() => run(() => api('/monthly-charges/demo', { method: 'POST' }), (r) => r.message).then(reload)}>+ תורמי בדיקה</button>}
      </div>

      {loading && !data ? <Spinner /> : (
        <div className="tx-list">
          {rows.map((r) => {
            const st = rowState(r);
            const exp = EXP[r.exp_state];
            return (
              <div key={r.id} className={`tx-row ${TONE[st]}`} style={{ gridTemplateColumns: '30px 1fr auto', cursor: 'default' }}>
                <span className="tx-src">
                  <input type="checkbox" style={{ width: 20, height: 20 }} disabled={!canAct || !!r.paid_tx_id} checked={!!sel[r.id] && !r.paid_tx_id} onChange={() => toggle(r.id)} />
                </span>
                <span className="tx-main">
                  <b className="tx-name"><a onClick={() => navigate(`/app/donors/${r.donor_id}`)} style={{ cursor: 'pointer' }}>{r.donor_name || 'תורם'}</a>{r.is_demo && <> <Tag kind="demo">דוגמה</Tag></>}</b>
                  <span className="small muted">
                    {SOURCE_LABELS[r.source] || r.source} · אשראי {r.card_last4 ? `****${r.card_last4}` : ''}{r.card_exp ? ` · תוקף ${r.card_exp}` : ''}{r.institution_name ? ` · ${r.institution_name}` : ''}
                  </span>
                  <span className="row" style={{ gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                    {st === 'paid' && <Tag kind="ok">חויב החודש</Tag>}
                    {exp && <Tag kind={exp[1]}>{exp[0]}</Tag>}
                    {r.status === 'failed' && <Tag kind="bad">ההוראה במצב נכשל</Tag>}
                    {r.prev_status === 'failed' && <Tag kind="warn">נכשל בחודש קודם</Tag>}
                    {r.charge_mode !== 'manual' && <Tag kind="info">הו"ק רגילה</Tag>}
                  </span>
                </span>
                <span className="tx-amt num">
                  {canAct && !r.paid_tx_id
                    ? <input className="input num" type="number" min="1" inputMode="decimal" style={{ width: 96, textAlign: 'center' }} value={amounts[r.id] ?? r.amount} onChange={(e) => setAmounts((a) => ({ ...a, [r.id]: e.target.value }))} />
                    : <b>{money(r.amount, r.currency)}</b>}
                </span>
                {canAct && <span className="tx-act row" style={{ gap: 4, justifyContent: 'flex-start' }}>
                  <button className="btn sm" onClick={() => setExp(r)}>תוקף</button>
                  {r.charge_mode === 'manual'
                    ? <button className="btn sm" onClick={() => setMode(r, 'auto')}>החזר להו"ק רגילה</button>
                    : <button className="btn sm" onClick={() => setMode(r, 'manual')}>העבר להחלטה חודשית</button>}
                  {r.donor_phone && <a className="btn sm" href={phoneHref(r.donor_phone)}><Icon name="phone" size={14} />חיוג</a>}
                </span>}
              </div>
            );
          })}
          {!rows.length && <div className="empty">
            {scope === 'manual' ? 'אין תורמים שמסומנים לחיוב בהחלטה חודשית. אפשר לבחור למעלה "כל הו"ק באשראי" ולהעביר תורמים בלחיצה, או להקים הו"ק באשראי חדשה עם הסימון "חיוב חודשי בהחלטה".' : 'אין הו"ק באשראי עם כרטיס שמור'}
          </div>}
        </div>
      )}

      {!!data?.batches?.length && <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>סבבי חיוב ב{monthLabel(month)}</h3>
        {data.batches.map((b) => <BatchLine key={b.id} b={b} onOpen={() => api(`/monthly-charges/batches/${b.id}`).then(setResult)} />)}
      </div>}

      {canAct && <div style={{ position: 'fixed', insetInline: 0, bottom: 'calc(64px + env(safe-area-inset-bottom))', zIndex: 30, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
        <div className="card row between" style={{ pointerEvents: 'auto', width: 'min(760px, calc(100% - 24px))', padding: '10px 14px', boxShadow: '0 6px 24px rgba(0,0,0,.18)', gap: 8, flexWrap: 'wrap' }}>
          <span><b>{chosen.length}</b> נבחרו · <b className="num">{money(total)}</b></span>
          <label className="check small"><input type="checkbox" checked={issueDocs} onChange={(e) => setIssueDocs(e.target.checked)} />קבלה אוטומטית למי שעבר</label>
          <button className="btn primary" disabled={!chosen.length || busy} onClick={() => setConfirm(true)}>בצע חיוב לנבחרים</button>
        </div>
      </div>}

      {confirm && (
        <Modal title="אישור חיוב" size="narrow" onClose={() => !busy && setConfirm(false)} footer={<>
          <button className="btn primary" disabled={busy} onClick={() => execute(chosen.map((r) => ({ so_id: r.id, amount: amountOf(r) })))}>{busy ? 'מחייב… נא לא לסגור' : 'אשר וחייב'}</button>
          <button className="btn" disabled={busy} onClick={() => setConfirm(false)}>ביטול</button>
        </>}>
          <p>לחייב <b>{chosen.length}</b> תורמים בסך הכל <b className="num">{money(total)}</b>, עבור <b>{monthLabel(month)}</b>?</p>
          {chosen.some((r) => r.exp_state === 'expired') && <div className="notice bad small">חלק מהנבחרים עם כרטיס שפג תוקפו. החיוב שלהם ייכשל.</div>}
          <p className="small muted">החיוב נשלח לספק הסליקה עם הכרטיס השמור של כל תורם. תורם שכבר חויב החודש ידולג אוטומטית, כך שאין חשש לחיוב כפול.{issueDocs ? ' קבלה תופק רק למי שהחיוב שלו עבר.' : ''}</p>
          {data?.sandbox && <div className="notice warn small">הדמיה: לא יורד כסף אמיתי.</div>}
        </Modal>
      )}

      {result && <BatchResult data={result} onClose={() => setResult(null)} onRetry={(it) => execute([{ so_id: it.standing_order_id, amount: it.amount }])} busy={busy} canAct={canAct} onChanged={() => { api(`/monthly-charges/batches/${result.batch.id}`).then(setResult).catch(() => {}); reload(); }} />}
    </div>
  );
}

function BatchLine({ b, onOpen }) {
  return (
    <div className="row between" style={{ padding: '8px 0', borderTop: '1px solid var(--line)', cursor: 'pointer' }} onClick={onOpen}>
      <span className="small">{datetime(b.created_at)} · {b.created_by_name || ''}{b.sandbox ? ' · הדמיה' : ''}</span>
      <span className="row" style={{ gap: 4 }}>
        <Tag kind="ok">{b.total_success} עברו</Tag>
        {b.total_failed > 0 && <Tag kind="bad">{b.total_failed} נכשלו</Tag>}
        {b.total_skipped > 0 && <Tag>{b.total_skipped} דולגו</Tag>}
        <b className="num">{money(b.amount_success)}</b>
      </span>
    </div>
  );
}

function BatchResult({ data, onClose, onRetry, busy, canAct, onChanged }) {
  const { batch, items } = data;
  const running = batch.status === 'processing';
  const done = (batch.total_success || 0) + (batch.total_failed || 0) + (batch.total_skipped || 0);
  const resolve = (i, outcome) => {
    const q = outcome === 'success' ? `לסמן שהחיוב של ${i.donor_name} עבר בפועל? (רק אחרי בדיקה מול הספק)` : `לסמן שהחיוב של ${i.donor_name} לא עבר? אחרי זה אפשר לחייב אותו שוב`;
    if (!window.confirm(q)) return;
    run(() => api(`/monthly-charges/items/${i.id}/resolve`, { method: 'POST', body: { outcome } }), (r) => r.message).then(() => onChanged && onChanged());
  };
  const failed = items.filter((i) => i.status === 'failed');
  const exportXlsx = (onlyFailed) => run(async () => {
    const { writeXlsx } = await import('./xlsx.js');
    const list = onlyFailed ? failed : items;
    await writeXlsx(onlyFailed ? `שיחות לנכשלים ${batch.batch_month}` : `סבב חיוב ${batch.batch_month}`,
      ['תורם', 'טלפון', 'סכום', 'סטטוס', 'מספר אישור', 'קבלה', 'הערה'],
      list.map((i) => [i.donor_name || '', i.donor_phone || '', Number(i.amount), (ITEM_STATUS[i.status] || [i.status])[0], i.confirmation || '', i.document_number || '', i.error_message || '']),
      'חיובים');
  });
  return (
    <Modal title={`תוצאות חיוב - ${monthLabel(batch.batch_month)}`} onClose={onClose} footer={<>
      {canAct && failed.length > 0 && <button className="btn" onClick={() => run(() => api(`/monthly-charges/batches/${batch.id}/call-tasks`, { method: 'POST' }), (r) => r.message)}>משימות מוקד לנכשלים</button>}
      {failed.length > 0 && <button className="btn" onClick={() => exportXlsx(true)}>רשימת שיחות</button>}
      <button className="btn" onClick={() => exportXlsx(false)}><Icon name="download" size={16} />אקסל</button>
      <button className="btn primary" onClick={onClose}>סגירה</button>
    </>}>
      {batch.sandbox && <div className="notice warn small" style={{ marginBottom: 10 }}>הדמיה - לא ירד כסף אמיתי</div>}
      {running && <div className="notice small" style={{ marginBottom: 10 }}>⏳ מבצע חיובים... {done} מתוך {batch.total_selected}. אפשר להשאיר את המסך פתוח - אין לסגור את הדפדפן באמצע.</div>}
      {batch.status === 'interrupted' && <div className="notice warn small" style={{ marginBottom: 10 }}>{BATCH_STATUS.interrupted}: הסבב הופסק באמצע. פריטים שמסומנים "בתהליך" חסומים לחיוב חוזר עד שתבדקו מול הספק ותסמנו אם עברו.</div>}
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="label">עברו</div><div className="value" style={{ color: 'var(--ok)' }}>{batch.total_success}</div></div>
        <div className={`kpi ${batch.total_failed ? 'alert' : ''}`}><div className="label">נכשלו</div><div className="value">{batch.total_failed}</div></div>
        <div className="kpi"><div className="label">דולגו</div><div className="value">{batch.total_skipped}</div></div>
        <div className="kpi"><div className="label">נגבה</div><div className="value num">{money(batch.amount_success)}</div></div>
      </div>
      <div className="tx-list">
        {items.map((i) => {
          const [l, k] = ITEM_STATUS[i.status] || [i.status, ''];
          return (
            <div key={i.id} className={`tx-row ${i.status === 'success' ? 'tone-ok' : i.status === 'failed' ? 'tone-bad' : 'tone-off'}`} style={{ cursor: 'default' }}>
              <span className="tx-src"><Tag kind={k}>{l}</Tag></span>
              <span className="tx-main">
                <b className="tx-name">{i.donor_name || 'תורם'}</b>
                <span className="small muted">
                  {i.confirmation ? `אישור ${i.confirmation}` : ''}{i.document_number ? ` · קבלה ${i.document_number}` : ''}{i.error_message ? ` ${i.error_message}` : ''}
                </span>
              </span>
              <span className="tx-amt num"><b>{money(i.amount, i.currency)}</b></span>
              {canAct && i.status === 'processing' && !running && <span className="tx-act row" style={{ gap: 4, justifyContent: 'flex-start' }}>
                <button className="btn sm" onClick={() => resolve(i, 'success')}>עבר בפועל</button>
                <button className="btn sm" onClick={() => resolve(i, 'failed')}>לא עבר</button>
              </span>}
              {canAct && i.status === 'failed' && <span className="tx-act row" style={{ gap: 4, justifyContent: 'flex-start' }}>
                <button className="btn sm" disabled={busy} onClick={() => { if (window.confirm(`לנסות שוב לחייב את ${i.donor_name} ב-${money(i.amount)}?`)) onRetry(i); }}>נסה שוב</button>
                {i.donor_phone && <a className="btn sm" href={phoneHref(i.donor_phone)}><Icon name="phone" size={14} />חיוג</a>}
              </span>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export function MonthlyHistoryPage() {
  const { data, loading } = useApi('/monthly-charges/history');
  const [result, setResult] = useState(null);
  return (
    <div>
      <div className="page-head"><h1>היסטוריית חיובים חודשיים</h1><Link className="btn" to="/app/monthly-charges">חזרה לחיובים</Link></div>
      {loading && !data ? <Spinner /> : (
        <div className="card">
          {(data?.rows || []).map((b) => (
            <div key={b.id}>
              <div className="small muted" style={{ marginTop: 8 }}>{monthLabel(b.batch_month)}</div>
              <BatchLine b={b} onOpen={() => api(`/monthly-charges/batches/${b.id}`).then(setResult)} />
            </div>
          ))}
          {!data?.rows?.length && <div className="empty">עדיין לא בוצעו סבבי חיוב</div>}
        </div>
      )}
      {result && <BatchResult data={result} onClose={() => setResult(null)} onRetry={() => {}} canAct={false} />}
    </div>
  );
}
