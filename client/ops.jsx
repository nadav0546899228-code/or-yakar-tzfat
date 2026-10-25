import React, { useState, useContext, useEffect } from 'react';
import { api, useApi, toast, run, Modal, Field, RefPicker, UserPicker, Spinner, Tag, Link, navigate, money, date, datetime, today, qs, download, downloadPost, AppCtx, phoneHref, waHref, SignaturePad } from './lib.jsx';
import { CALL_REASON, DATE_KIND, SOURCE_LABELS } from './labels.js';
import { can } from './app.jsx';
import { NewDonation } from './crm.jsx';
import { Icon } from './icons.jsx';

// ---------- מוקד טלפוני ----------
export function CallsPage() {
  const { user } = useContext(AppCtx);
  const [all, setAll] = useState(false);
  const { data, reload } = useApi(`/calls/queue${qs({ all: all ? 'true' : '' })}`);
  const [idx, setIdx] = useState(0);
  const [gen, setGen] = useState(false);
  const [donate, setDonate] = useState(null);
  const [out, setOut] = useState({ summary: '', callback_date: '', new_amount: '' });
  const rows = data?.rows || [];
  const cur = rows[Math.min(idx, rows.length - 1)];
  useEffect(() => setOut({ summary: '', callback_date: '', new_amount: '' }), [cur?.id]);
  const finish = async (status, outcome) => {
    await run(() => api(`/calls/${cur.id}/outcome`, { method: 'POST', body: { status, outcome, ...out } }), 'נשמר');
    reload();
  };
  return (
    <div>
      <div className="page-head"><h1>מוקד טלפוני</h1>
        <div className="row">
          {can(user, 'calls.manage') && <label className="check small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />כל הנציגים</label>}
          {can(user, 'calls.manage') && <button className="btn" onClick={() => setGen(true)}>יצירת תור שיחות</button>}
          <Link className="btn" to="/app/r/call_tasks">כל המשימות</Link>
        </div>
      </div>
      {!data ? <Spinner /> : !rows.length ? <div className="card empty">אין שיחות בתור כרגע 🎉</div> : (
        <div className="grid2" style={{ gridTemplateColumns: 'minmax(260px, 1fr) 2fr' }}>
          <div className="stack call-list">
            {rows.map((r, i) => (
              <div key={r.id} className={`call-card ${i === idx ? 'active' : ''}`} style={{ cursor: 'pointer', padding: 10 }} onClick={() => { setIdx(i); if (window.innerWidth < 900) setTimeout(() => document.querySelector('.call-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}>
                <div className="row between"><b>{r.donor_name}</b><Tag kind={r.priority === 1 ? 'bad' : 'info'}>{CALL_REASON[r.reason]}</Tag></div>
                <div className="small muted"><bdi dir="ltr">{r.phone}</bdi> · {r.agent || 'לא משויך'} {r.status !== 'open' && `· ${r.status === 'callback' ? 'לחזור' : 'לא ענה'}`}</div>
              </div>
            ))}
          </div>
          {cur && (
            <div className="call-card active stack call-detail">
              <div className="row between">
                <div><h2 style={{ margin: 0 }}><Link to={`/app/donors/${cur.donor_id}`}>{cur.donor_name}</Link> {cur.is_vip && <Tag kind="purple">VIP</Tag>}</h2><div className="muted">{cur.city}</div></div>
                <div className="row"><a className="btn primary" href={phoneHref(cur.phone)}>☎ <bdi dir="ltr">{cur.phone}</bdi></a>{cur.phone && <a className="btn" href={waHref(cur.phone)} target="_blank" rel="noopener">💬</a>}</div>
              </div>
              <div className="kpis">
                <div className="kpi"><div className="label">סיבת השיחה</div><div className="value" style={{ fontSize: 17 }}>{CALL_REASON[cur.reason]}</div></div>
                <div className="kpi"><div className="label">תרם בשנה האחרונה</div><div className="value num" style={{ fontSize: 17 }}>{money(cur.year_total)}</div></div>
                <div className="kpi"><div className="label">תרומה אחרונה</div><div className="value" style={{ fontSize: 17 }}>{date(cur.last_donation) || '-'}</div></div>
                <div className="kpi"><div className="label">הו"ק פעילה</div><div className="value" style={{ fontSize: 17 }}>{cur.keva || 'אין'}</div></div>
              </div>
              {cur.notes && <div className="notice small">{cur.notes}</div>}
              {cur.last_note && <div className="small muted">תיעוד אחרון: {cur.last_note}</div>}
              {cur.reason === 'upgrade' && <div className="notice warn small">מבצע הגדלה: הציעו להגדיל את הו"ק. אם התורם הסכים - הזינו את הסכום החדש והוא יעודכן אצל הספק.</div>}
              <Field label="סיכום השיחה"><textarea className="input" value={out.summary} onChange={(e) => setOut({ ...out, summary: e.target.value })} /></Field>
              <div className="form-grid">
                <Field label="לחזור בתאריך"><input className="input" type="date" value={out.callback_date} onChange={(e) => setOut({ ...out, callback_date: e.target.value })} /></Field>
                {cur.standing_order_id && <Field label="סכום הו״ק חדש (בהגדלה)"><input className="input num" type="number" value={out.new_amount} onChange={(e) => setOut({ ...out, new_amount: e.target.value })} /></Field>}
              </div>
              <div className="row">
                <button className="btn primary" onClick={() => finish('done', 'בוצע')}>✓ בוצע</button>
                <button className="btn" onClick={() => finish('no_answer', 'לא ענה')}>לא ענה</button>
                <button className="btn" onClick={() => finish('callback', 'לחזור')} disabled={!out.callback_date}>לחזור בתאריך</button>
                <button className="btn gold" onClick={() => setDonate(cur)}>+ תרומה / הו"ק</button>
                <button className="btn danger" onClick={() => finish('cancelled', 'סירב / לא רלוונטי')}>סירב</button>
              </div>
            </div>
          )}
        </div>
      )}
      {gen && <GenerateCalls onClose={() => setGen(false)} onDone={() => { setGen(false); reload(); }} />}
      {donate && <NewDonation donorId={donate.donor_id} onClose={() => setDonate(null)} onDone={() => { setDonate(null); }} />}
    </div>
  );
}

function GenerateCalls({ onClose, onDone }) {
  const [f, setF] = useState({ kind: 'upgrade', min_amount: 50, max_amount: 500, months: 12, assigned_user_id: null, campaign_id: null });
  return (
    <Modal title="יצירת תור שיחות" onClose={onClose} footer={<button className="btn primary" onClick={() => run(() => api('/calls/generate', { method: 'POST', body: f }), (r) => `נוצרו ${r.created} משימות`).then(onDone)}>יצירה</button>}>
      <div className="form-grid">
        <Field label="סוג" full><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="upgrade">מבצע הגדלה לתורמי הו"ק קיימים</option><option value="renewal">חידוש הו"ק שבוטלו / מסתיימות</option><option value="dormant">תורמים רדומים</option><option value="failed">חיובים שנכשלו (30 יום)</option></select></Field>
        {f.kind === 'upgrade' && <><Field label="הו״ק מסכום"><input className="input" type="number" value={f.min_amount} onChange={(e) => setF({ ...f, min_amount: e.target.value })} /></Field><Field label="עד סכום"><input className="input" type="number" value={f.max_amount} onChange={(e) => setF({ ...f, max_amount: e.target.value })} /></Field></>}
        {f.kind === 'dormant' && <Field label="ללא תרומה (חודשים)"><input className="input" type="number" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></Field>}
        <Field label="שיוך לנציג"><UserPicker value={f.assigned_user_id} onChange={(v) => setF({ ...f, assigned_user_id: v })} /></Field>
        <Field label="קמפיין"><RefPicker res="campaigns" value={f.campaign_id} onChange={(v) => setF({ ...f, campaign_id: v })} /></Field>
      </div>
    </Modal>
  );
}

// ---------- אפליקציית שטח ----------
export function FieldPage() {
  const blank = { donor_id: null, first_name: '', last_name: '', phone: '', address: '', city: 'צפת', id_number: '', amount: '', method: 'cash', check_number: '', check_bank: '', check_due_date: '', bank_code: '', branch_code: '', account_number: '', day_of_month: 10, signature_data: null, dedication: '' };
  const [f, setF] = useState(blank);
  const [isNew, setIsNew] = useState(false);
  const [last, setLast] = useState(null);
  const [tab, setTab] = useState('collect');
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const submit = async () => {
    const r = await run(() => api('/field/collect', { method: 'POST', body: f }), 'נשמר בהצלחה');
    setLast(r); setF(blank); setIsNew(false);
  };
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="tabs"><button className={tab === 'collect' ? 'on' : ''} onClick={() => setTab('collect')}>גבייה בית לבית</button><button className={tab === 'boxes' ? 'on' : ''} onClick={() => setTab('boxes')}>סבב קופות</button></div>
      {tab === 'boxes' ? <BoxRound /> : (
        <div className="card stack">
          {last && <div className="notice">✓ נרשם {last.row ? `${money(last.row.amount)} (${last.row.serial})` : 'הו"ק בנקאית'} {!last.row?.approved && last.row && '- ממתין לאישור גזבר'}</div>}
          <div className="row"><button className={`btn sm ${!isNew ? 'primary' : ''}`} onClick={() => setIsNew(false)}>תורם קיים</button><button className={`btn sm ${isNew ? 'primary' : ''}`} onClick={() => { setIsNew(true); set('donor_id')(null); }}>תורם חדש</button></div>
          {!isNew ? <Field label="חיפוש תורם (שם / טלפון)"><RefPicker res="donors" value={f.donor_id} onChange={set('donor_id')} /></Field> : (
            <div className="form-grid">
              <Field label="שם פרטי *"><input className="input" value={f.first_name} onChange={set('first_name')} /></Field>
              <Field label="שם משפחה"><input className="input" value={f.last_name} onChange={set('last_name')} /></Field>
              <Field label="טלפון"><input className="input" type="tel" value={f.phone} onChange={set('phone')} /></Field>
              <Field label="ת.ז. (לקבלה)"><input className="input" inputMode="numeric" value={f.id_number} onChange={set('id_number')} /></Field>
              <Field label="כתובת" full><input className="input" value={f.address} onChange={set('address')} /></Field>
            </div>
          )}
          <div className="row">{[['cash', 'מזומן'], ['check', 'צ׳ק'], ['keva_bank', 'הו"ק בנקאית']].map(([k, l]) => <button key={k} className={`btn ${f.method === k ? 'primary' : ''}`} onClick={() => set('method')(k)}>{l}</button>)}</div>
          <Field label={f.method === 'keva_bank' ? 'סכום חודשי' : 'סכום'}><input className="input num" style={{ fontSize: 22 }} type="number" inputMode="decimal" value={f.amount} onChange={set('amount')} /></Field>
          <div className="row">{[18, 36, 50, 100, 180, 360].map((a) => <button key={a} className="btn sm" onClick={() => set('amount')(a)}>{a}</button>)}</div>
          {f.method === 'check' && <div className="form-grid"><Field label="מס׳ צ׳ק"><input className="input" value={f.check_number} onChange={set('check_number')} /></Field><Field label="בנק"><input className="input" value={f.check_bank} onChange={set('check_bank')} /></Field><Field label="פירעון"><input className="input" type="date" value={f.check_due_date} onChange={set('check_due_date')} /></Field></div>}
          {f.method === 'keva_bank' && <div className="form-grid"><Field label="בנק"><input className="input" inputMode="numeric" value={f.bank_code} onChange={set('bank_code')} /></Field><Field label="סניף"><input className="input" inputMode="numeric" value={f.branch_code} onChange={set('branch_code')} /></Field><Field label="חשבון"><input className="input" inputMode="numeric" value={f.account_number} onChange={set('account_number')} /></Field><Field label="יום חיוב"><select className="input" value={f.day_of_month} onChange={set('day_of_month')}>{[1, 10, 15, 20].map((d) => <option key={d}>{d}</option>)}</select></Field></div>}
          <Field label="הקדשה"><input className="input" value={f.dedication} onChange={set('dedication')} /></Field>
          <Field label="חתימת התורם"><SignaturePad onChange={set('signature_data')} /></Field>
          <button className="btn primary" style={{ minHeight: 48, fontSize: 17 }} disabled={!f.amount || (!f.donor_id && !f.first_name)} onClick={submit}>שמירה</button>
        </div>
      )}
    </div>
  );
}

function BoxRound() {
  const { data, reload } = useApi('/r/tzedaka_boxes?size=200');
  const [amounts, setAmounts] = useState({});
  if (!data) return <Spinner />;
  const due = data.rows.filter((b) => b.active);
  return (
    <div className="stack">
      {due.map((b) => {
        const late = !b.next_due || new Date(b.next_due) <= new Date();
        return (
          <div key={b.id} className="card" style={{ padding: 12 }}>
            <div className="row between"><b>{b.code} · {b.location_name}</b>{late ? <Tag kind="warn">לאיסוף</Tag> : <Tag>הבא: {date(b.next_due)}</Tag>}</div>
            <div className="small muted">{b.address} · {b.neighborhood} · אחרון: {date(b.last_collected_at) || 'אף פעם'}</div>
            <div className="row" style={{ marginTop: 6 }}>
              <input className="input num" style={{ width: 130 }} type="number" placeholder="סכום" value={amounts[b.id] || ''} onChange={(e) => setAmounts({ ...amounts, [b.id]: e.target.value })} />
              <button className="btn primary" disabled={!amounts[b.id]} onClick={async () => {
                await run(() => api('/r/box_collections', { method: 'POST', body: { box_id: b.id, amount: amounts[b.id], collected_at: today() } }), 'נרשם');
                await api(`/r/tzedaka_boxes/${b.id}`, { method: 'PUT', body: { last_collected_at: today() } });
                setAmounts({ ...amounts, [b.id]: '' }); reload();
              }}>נאסף</button>
              {b.address && <a className="btn" href={`https://waze.com/ul?q=${encodeURIComponent(b.address)}`} target="_blank" rel="noopener">ניווט</a>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- לוח שנה עברי ----------
export function CalendarPage() {
  const { demoMode, meta } = useContext(AppCtx);
  const [days, setDays] = useState(30);
  const [kind, setKind] = useState('');
  const { data } = useApi(`/calendar${qs({ days, demo: demoMode })}`);
  const items = (data?.items || []).filter((i) => !kind || i.kind === kind);
  return (
    <div>
      <div className="page-head"><h1>לוח שנה עברי</h1><div className="row"><span className="tag info" style={{ fontSize: 14 }}>היום: {data?.today.text}</span><Link className="btn" to="/app/r/automations">אוטומציות התראה</Link></div></div>
      <div className="toolbar">
        <select className="input" value={days} onChange={(e) => setDays(e.target.value)}><option value={7}>שבוע</option><option value={30}>30 יום</option><option value={60}>60 יום</option><option value={120}>120 יום</option></select>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">הכל</option>{Object.entries(DATE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      {!data ? <Spinner /> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>מתי</th><th>תאריך עברי</th><th>לועזי</th><th>סוג</th><th>תורם</th><th>שם</th><th /></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.days_left === 0 ? <Tag kind="bad">היום</Tag> : i.days_left === 1 ? <Tag kind="warn">מחר</Tag> : `בעוד ${i.days_left} ימים`}</td>
                <td><b>{i.hebrew}</b></td><td className="small">{date(i.date)}</td>
                <td><Tag kind={i.kind === 'yahrzeit' ? '' : 'ok'}>{DATE_KIND[i.kind]}</Tag></td>
                <td><Link to={`/app/donors/${i.donor_id}`}>{i.donor_name}</Link></td>
                <td>{i.person_name}{i.relation && <span className="muted small"> ({i.relation})</span>}</td>
                <td className="nowrap">{i.phone && <><a className="btn sm" href={phoneHref(i.phone)}>☎</a><a className="btn sm" target="_blank" rel="noopener" href={waHref(i.phone, i.kind === 'yahrzeit' ? `שלום, ביום ${i.hebrew} חל יום הזיכרון של ${i.person_name}. אברכי הכולל ילמדו לעילוי נשמתו.` : `מזל טוב! כל משפחת אור יקר מברכת אותך`)}>💬</a></>}</td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={7} className="empty">אין תאריכים בטווח</td></tr>}
          </tbody>
        </table></div>
      )}
      <p className="small muted">חודשי אדר: בשנה מעוברת יארצייט של "אדר" נחשב באדר ב׳. ל׳ בחודש חסר נחשב כ״ט.</p>
    </div>
  );
}

// ---------- אירוע / דינר בזמן אמת ----------
export function EventPage({ params }) {
  const { meta, user } = useContext(AppCtx);
  const { data, reload } = useApi(`/events/${params.id}/live`);
  const [invite, setInvite] = useState(false);
  const [editGuest, setEditGuest] = useState(null);
  const [live, setLive] = useState(false);
  useEffect(() => { if (!live) return undefined; const t = setInterval(reload, 10000); return () => clearInterval(t); }, [live]);
  if (!data) return <Spinner />;
  const { event: ev, guests, totals } = data;
  const pct = ev.goal ? Math.min(100, Math.round(((Number(totals.paid) + Number(data.live.total)) / ev.goal) * 100)) : 0;
  const upd = (g, body) => run(() => api(`/r/event_guests/${g.id}`, { method: 'PUT', body })).then(reload);
  return (
    <div className="stack">
      <div className="page-head"><h1>{ev.name}</h1><div className="row"><span className="muted">{date(ev.date)} · {ev.location}</span><label className="check small"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />רענון חי</label>{can(user, 'events.write') && <button className="btn" onClick={() => setInvite(true)}>הזמנת תורמים</button>}<button className="btn" onClick={() => setEditGuest({ event_id: ev.id })}>+ מוזמן</button></div></div>
      <div className="kpis">
        <div className="kpi"><div className="label">מגיעים</div><div className="value">{totals.yes} ({totals.seats} מקומות)</div></div>
        <div className="kpi"><div className="label">טרם השיבו</div><div className="value">{totals.pending}</div></div>
        <div className="kpi"><div className="label">הגיעו בפועל</div><div className="value">{totals.arrived}</div></div>
        <div className="kpi"><div className="label">התחייבויות</div><div className="value num">{money(totals.pledged)}</div></div>
        <div className="kpi"><div className="label">שולם + תרומות קמפיין</div><div className="value num">{money(Number(totals.paid) + Number(data.live.total))}</div></div>
      </div>
      {ev.goal > 0 && <div className="card"><div className="row between"><b>התקדמות ליעד {money(ev.goal)}</b><b>{pct}%</b></div><div className="bar-track" style={{ height: 22, marginTop: 8 }}><div className="bar-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} /></div></div>}
      <div className="table-wrap"><table className="t">
        <thead><tr><th>שם</th><th>טלפון</th><th>אישור</th><th>מקומות</th><th>שולחן</th><th>התחייב</th><th>שילם</th><th>הגיע</th></tr></thead>
        <tbody>
          {guests.map((g) => (
            <tr key={g.id}>
              <td>{g.donor_id ? <Link to={`/app/donors/${g.donor_id}`}>{g.display_name}</Link> : g.display_name}</td>
              <td className="num">{g.display_phone && <a href={waHref(g.display_phone, `שלום, נשמח לראותך ב${ev.name} ב-${date(ev.date)}. נא לאשר הגעה.`)} target="_blank" rel="noopener"><bdi dir="ltr">{g.display_phone}</bdi></a>}</td>
              <td><select className="input" style={{ minHeight: 32 }} value={g.rsvp} onChange={(e) => upd(g, { rsvp: e.target.value })}>{meta.options.rsvp.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
              <td>{g.seats}</td>
              <td><input className="input" style={{ width: 70, minHeight: 32 }} defaultValue={g.table_no || ''} onBlur={(e) => e.target.value !== (g.table_no || '') && upd(g, { table_no: e.target.value })} /></td>
              <td><input className="input num" style={{ width: 100, minHeight: 32 }} type="number" defaultValue={g.pledged_amount} onBlur={(e) => Number(e.target.value) !== Number(g.pledged_amount) && upd(g, { pledged_amount: e.target.value })} /></td>
              <td><input className="input num" style={{ width: 100, minHeight: 32 }} type="number" defaultValue={g.paid_amount} onBlur={(e) => Number(e.target.value) !== Number(g.paid_amount) && upd(g, { paid_amount: e.target.value })} /></td>
              <td><input type="checkbox" checked={g.arrived} onChange={(e) => upd(g, { arrived: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {invite && <InviteDonors eventId={ev.id} onClose={() => setInvite(false)} onDone={() => { setInvite(false); reload(); }} />}
      {editGuest && <GuestForm guest={editGuest} onClose={() => setEditGuest(null)} onDone={() => { setEditGuest(null); reload(); }} />}
    </div>
  );
}

function GuestForm({ guest, onClose, onDone }) {
  const [f, setF] = useState({ ...guest, rsvp: 'pending', seats: 1 });
  return (
    <Modal title="מוזמן" size="narrow" onClose={onClose} footer={<button className="btn primary" onClick={() => run(() => api('/r/event_guests', { method: 'POST', body: f }), 'נוסף').then(onDone)}>שמירה</button>}>
      <div className="stack"><Field label="תורם"><RefPicker res="donors" value={f.donor_id} onChange={(v) => setF({ ...f, donor_id: v })} /></Field>
        <Field label="או שם חופשי"><input className="input" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="טלפון"><input className="input" value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field></div>
    </Modal>
  );
}

function InviteDonors({ eventId, onClose, onDone }) {
  const [filter, setFilter] = useState({ is_vip: false, min_total: 1000 });
  const [rows, setRows] = useState(null);
  return (
    <Modal title="הזמנת תורמים לפי פילוח" onClose={onClose} footer={rows && <button className="btn primary" onClick={() => run(() => api(`/events/${eventId}/invite`, { method: 'POST', body: { donor_ids: rows.map((r) => r.id) } }), (r) => `נוספו ${r.added}`).then(onDone)}>הזמנת {rows.length}</button>}>
      <SegmentFilter value={filter} onChange={setFilter} />
      <button className="btn" style={{ marginTop: 10 }} onClick={() => api('/segments/preview', { method: 'POST', body: { filter } }).then((r) => setRows(r.rows))}>תצוגה מקדימה</button>
      {rows && <p>{rows.length} תורמים</p>}
    </Modal>
  );
}

// ---------- פילוח ותפוצה ----------
function SegmentFilter({ value: f, onChange }) {
  const set = (k) => (e) => onChange({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  return (
    <div className="form-grid">
      <label className="check"><input type="checkbox" checked={!!f.is_vip} onChange={set('is_vip')} />VIP</label>
      <label className="check"><input type="checkbox" checked={!!f.is_overseas} onChange={set('is_overseas')} />תורמי חו"ל</label>
      <Field label="סטטוס"><select className="input" value={f.status || ''} onChange={set('status')}><option value="">הכל</option><option value="active">פעיל</option><option value="dormant">רדום</option><option value="prospect">פוטנציאלי</option></select></Field>
      <Field label="רדומים - ללא תרומה X חודשים"><input className="input" type="number" value={f.dormant_months || ''} onChange={set('dormant_months')} /></Field>
      <Field label="תרם בשנה האחרונה - מינימום ₪"><input className="input" type="number" value={f.min_total || ''} onChange={set('min_total')} /></Field>
      <Field label="מקסימום ₪"><input className="input" type="number" value={f.max_total || ''} onChange={set('max_total')} /></Field>
      <Field label="הו״ק"><select className="input" value={f.has_keva || ''} onChange={set('has_keva')}><option value="">לא משנה</option><option value="yes">יש הו"ק פעילה</option><option value="no">אין הו"ק</option></select></Field>
      <Field label="תגית"><input className="input" value={f.tag || ''} onChange={set('tag')} /></Field>
      <Field label="עיר"><input className="input" value={f.city || ''} onChange={set('city')} /></Field>
      <Field label="שפה"><select className="input" value={f.language || ''} onChange={set('language')}><option value="">הכל</option><option value="he">עברית</option><option value="en">English</option><option value="fr">Français</option></select></Field>
      <Field label="תרם למוסד"><RefPicker res="institutions" value={f.institution_id} onChange={set('institution_id')} /></Field>
    </div>
  );
}

export function MessagesPage() {
  const [filter, setFilter] = useState({});
  const [rows, setRows] = useState(null);
  const [channel, setChannel] = useState('whatsapp');
  const [body, setBody] = useState('שלום {שם}, ');
  const [subject, setSubject] = useState('');
  const segs = useApi('/r/segments?size=100');
  const preview = () => run(() => api('/segments/preview', { method: 'POST', body: { filter } })).then((r) => setRows(r.rows));
  return (
    <div className="stack">
      <div className="page-head"><h1>פילוח ורשימות תפוצה</h1><Link className="btn" to="/app/r/messages_out">יומן הודעות</Link></div>
      <div className="card stack">
        <div className="row"><b>רשימות שמורות:</b>{segs.data?.rows.map((s) => <button key={s.id} className="btn sm" onClick={() => { setFilter(s.filter); setRows(null); }}>{s.name}</button>)}</div>
        <SegmentFilter value={filter} onChange={(v) => { setFilter(v); setRows(null); }} />
        <div className="row"><button className="btn primary" onClick={preview}>הצגת רשימה</button>
          <button className="btn" onClick={() => { const name = window.prompt('שם לרשימה'); if (name) run(() => api('/r/segments', { method: 'POST', body: { name, filter } }), 'נשמרה').then(segs.reload); }}>שמירת הרשימה</button></div>
      </div>
      {rows && (
        <div className="grid2">
          <div className="card"><h3>{rows.length} תורמים</h3>
            <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}><table className="t"><thead><tr><th>שם</th><th>טלפון</th><th>עיר</th><th>שנה אחרונה</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.id}><td><Link to={`/app/donors/${r.id}`}>{r.name}</Link></td><td className="num"><bdi dir="ltr">{r.phone}</bdi></td><td>{r.city}</td><td className="num">{money(r.year_total)}</td></tr>)}</tbody></table></div>
          </div>
          <div className="card stack"><h3>שליחה לרשימה</h3>
            <div className="row">{[['whatsapp', 'וואטסאפ'], ['sms', 'SMS'], ['email', 'מייל']].map(([k, l]) => <button key={k} className={`btn sm ${channel === k ? 'primary' : ''}`} onClick={() => setChannel(k)}>{l}</button>)}</div>
            {channel === 'email' && <Field label="נושא"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
            <Field label="נוסח ({שם} יוחלף בשם התורם)"><textarea className="input" style={{ minHeight: 140 }} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            <button className="btn primary" disabled={!rows.length} onClick={() => { if (window.confirm(`לשלוח ל-${rows.length} תורמים?`)) run(() => api('/messages/bulk', { method: 'POST', body: { donor_ids: rows.map((r) => r.id), channel, body, subject } }), (r) => `נשלחו ${r.sent}${r.sandbox ? ' (הדמיה - נרשמו ביומן)' : ''}`); }}>שליחה</button>
            <p className="small muted">תורמים שסומנו "לא ליצור קשר" מסוננים אוטומטית.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- דוחות ----------
const REPORTS = [
  ['by_source', 'הכנסות לפי מקור', 'coin', '#1f6f4a'], ['by_institution', 'הכנסות לפי מוסד', 'building', '#16357a'], ['by_month', 'הכנסות לפי חודש', 'chart', '#b8862b'],
  ['by_recruiter', 'ביצועים לפי נציג / מתרים', 'donors', '#0f766e'], ['forecast', 'תחזית הכנסות מהו"ק', 'repeat', '#2b6cb0'], ['churn', 'נטישת הו"ק', 'alert', '#c53030'],
  ['dormant', 'תורמים רדומים', 'user', '#7a3fb0'], ['campaigns', 'קמפיינים מול יעד', 'flag', '#d9465f'], ['boxes', 'קופות צדקה', 'box', '#a16207'],
  ['documents', 'מסמכים ודיווח לרשות המסים', 'receipt', '#5b6478'], ['accountant', 'ייצוא לרואה חשבון', 'download', '#334155'],
];
export function ReportsPage() {
  const { demoMode } = useContext(AppCtx);
  const [kind, setKind] = useState('by_source');
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(today());
  const { data, loading } = useApi(`/reports/${kind}${qs({ from, to, demo: demoMode })}`);
  const cols = data?.rows?.[0] ? Object.keys(data.rows[0]) : [];
  const numCol = cols.find((c) => c.includes('₪'));
  const max = numCol ? Math.max(1, ...data.rows.map((r) => Number(r[numCol]) || 0)) : 1;
  return (
    <div>
      <div className="page-head"><h1>מרכז דוחות</h1><button className="btn" onClick={() => run(() => download(`/reports/${kind}${qs({ from, to, format: 'csv', demo: demoMode })}`, `${kind}.csv`))}>ייצוא ל-Excel (CSV)</button></div>
      <div className="report-cards">{REPORTS.map(([k, l, ic, color]) => (
        <button type="button" key={k} className={`report-card ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
          <span className="report-ico" style={{ background: color }}><Icon name={ic} size={20} /></span><span>{l}</span>
        </button>
      ))}</div>
      <div className="toolbar"><span className="small muted">מתאריך</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="small muted">עד</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      {loading ? <Spinner /> : (
        <div className="card">
          <h3>{data?.title}</h3>
          {numCol && data.rows.length <= 24 && ['by_source', 'by_institution', 'by_month', 'by_recruiter', 'forecast'].includes(kind) && (
            <div className="bars" style={{ marginBottom: 16 }}>{data.rows.map((r, i) => <div className="bar-row" key={i}><span className="small">{r[cols[0]]}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(Number(r[numCol]) / max) * 100}%` }} /></div><span className="num small">{money(r[numCol])}</span></div>)}</div>
          )}
          <div className="table-wrap"><table className="t"><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{data?.rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={typeof r[c] === 'number' ? 'num' : ''}>{c.includes('₪') || c === 'סכום' ? money(r[c]) : c.includes('תאריך') || c.includes('איסוף') ? date(r[c]) : String(r[c] ?? '')}</td>)}</tr>)}
              {!data?.rows.length && <tr><td className="empty">אין נתונים</td></tr>}</tbody></table></div>
        </div>
      )}
    </div>
  );
}

// ---------- מס"ב ----------
export function MasavPage() {
  const [day, setDay] = useState(10);
  const [chargeDate, setChargeDate] = useState(today());
  const { data } = useApi(`/masav/preview?day=${day}`);
  const [returns, setReturns] = useState('');
  return (
    <div className="stack">
      <div className="page-head"><h1>מס"ב - הוראות קבע בנקאיות</h1></div>
      <div className="notice warn small">פורמט הקובץ מבוסס על מבנה מס"ב הסטנדרטי (128 תווים). לפני שימוש ראשון יש לאמת מול הבנק / ספק המס"ב של העמותה ולהזין קוד מוסד במסך המתכנת. בפיתוח - הקובץ לבדיקה בלבד.</div>
      <div className="card stack">
        <div className="row"><Field label="יום חיוב"><select className="input" value={day} onChange={(e) => setDay(e.target.value)}>{[1, 5, 10, 15, 20, 25].map((d) => <option key={d}>{d}</option>)}</select></Field>
          <Field label="תאריך ערך"><input className="input" type="date" value={chargeDate} onChange={(e) => setChargeDate(e.target.value)} /></Field></div>
        {data && <><p><b>{data.rows.length}</b> הוראות · סה"כ <b className="num">{money(data.total)}</b></p>
          <div className="table-wrap"><table className="t"><thead><tr><th>תורם</th><th>סכום</th><th>בנק</th><th>סניף</th><th>חשבון</th></tr></thead><tbody>{data.rows.map((r) => <tr key={r.id}><td>{r.donor_name}</td><td className="num">{money(r.amount)}</td><td>{r.bank}</td><td>{r.branch}</td><td className="num">{r.account}</td></tr>)}</tbody></table></div></>}
        <button className="btn primary" disabled={!data?.rows.length} onClick={() => run(() => downloadPost('/masav/file', { day, charge_date: chargeDate }, `masav-${chargeDate}.txt`), 'הקובץ הופק. התנועות נרשמו כממתינות לאישור הבנק')}>הפקת קובץ חיובים</button>
      </div>
      <div className="card stack">
        <h3>קליטת החזרות (סירובים)</h3>
        <p className="small muted">מזהה הו"ק וסיבה בכל שורה, מופרדים בפסיק. לדוגמה: 12, אין כיסוי. תנועות שלא חזרו תוך 5 ימים מסומנות כשולמו.</p>
        <textarea className="input" value={returns} onChange={(e) => setReturns(e.target.value)} />
        <button className="btn" onClick={() => run(() => api('/masav/returns', { method: 'POST', body: { items: returns.split('\n').filter(Boolean).map((l) => { const [id, ...r] = l.split(','); return { standing_order_id: id.trim(), reason: r.join(',').trim() }; }) } }), (r) => `טופלו ${r.processed} החזרות ונפתחו משימות במוקד`)}>קליטה</button>
      </div>
    </div>
  );
}

// ---------- כפילויות ----------
export function DuplicatesPage() {
  const { data, reload } = useApi('/donors/duplicates');
  return (
    <div>
      <div className="page-head"><h1>איתור ומיזוג כפילויות</h1></div>
      <p className="muted small">אותו אדם שהגיע מכמה מקורות (נדרים, JGive, משרד…) מאוחד לכרטיס אחד. כל התרומות, הו"ק והמסמכים עוברים לכרטיס שנשמר.</p>
      {!data ? <Spinner /> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>כרטיס א׳</th><th>כרטיס ב׳</th><th>התאמה לפי</th><th /></tr></thead>
          <tbody>{data.rows.map((r) => (
            <tr key={`${r.a_id}-${r.b_id}`}><td><Link to={`/app/donors/${r.a_id}`}>{r.a_name}</Link> <span className="muted small">#{r.a_id}</span></td><td><Link to={`/app/donors/${r.b_id}`}>{r.b_name}</Link> <span className="muted small">#{r.b_id}</span></td><td><Tag>{r.reason}</Tag></td>
              <td className="nowrap"><button className="btn sm" onClick={() => window.confirm(`למזג את #${r.b_id} לתוך #${r.a_id}?`) && run(() => api('/donors/merge', { method: 'POST', body: { keep_id: r.a_id, remove_id: r.b_id } }), 'מוזג').then(reload)}>מיזוג לא׳</button>
                <button className="btn sm" onClick={() => window.confirm(`למזג את #${r.a_id} לתוך #${r.b_id}?`) && run(() => api('/donors/merge', { method: 'POST', body: { keep_id: r.b_id, remove_id: r.a_id } }), 'מוזג').then(reload)}>מיזוג לב׳</button></td></tr>
          ))}{!data.rows.length && <tr><td colSpan={4} className="empty">לא נמצאו כפילויות</td></tr>}</tbody></table></div>
      )}
    </div>
  );
}
