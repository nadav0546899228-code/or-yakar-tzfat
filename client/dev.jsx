import React, { useState, useContext, useEffect } from 'react';
import { api, useApi, toast, run, Modal, Field, Spinner, Tag, Link, money, date, datetime, qs, AppCtx, Confirm, UserPicker, RefPicker } from './lib.jsx';
import { can } from './app.jsx';

// ---------- חיבורים ו-API ----------
function ProviderCard({ p, caps, onChange }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(p.config || {});
  const [sec, setSec] = useState({});
  const [enabled, setEnabled] = useState(p.enabled);
  const [autoSync, setAutoSync] = useState(p.auto_sync);
  const dot = p.last_status === 'ok' ? 'ok' : p.last_status === 'error' ? 'bad' : p.last_status === 'simulated' ? 'sim' : '';
  const save = () => run(() => api(`/providers/${p.key}`, { method: 'PUT', body: { enabled, auto_sync: autoSync, config: cfg, secrets: sec } }), 'נשמר').then(() => { setSec({}); onChange(); });
  return (
    <div className={`provider-card ${p.enabled ? 'on' : ''}`}>
      <div className="row between">
        <b>{p.label}</b>
        <div className="row" style={{ gap: 4 }}>
          <span className={`dot ${dot}`} title={p.last_error || p.last_status || 'לא נבדק'} />
          {p.status === 'real'
            ? (p.enabled ? <Tag kind="ok">מחובר</Tag> : <Tag kind="warn">לא מחובר - ממתין למפתחות</Tag>)
            : <Tag kind="warn">הדמיה עד קבלת API</Tag>}
        </div>
      </div>
      <div className="row" style={{ gap: 4 }}>{p.capabilities.map((c) => <span key={c} className="tag" style={{ fontSize: 11 }}>{caps[c] || c}</span>)}</div>
      {p.last_sync_at && <div className="small muted">פעולה אחרונה: {datetime(p.last_sync_at)} {p.last_error && <span style={{ color: 'var(--bad)' }}>· {p.last_error}</span>}</div>}
      <div className="row">
        <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'סגירה' : 'הגדרות ומפתחות'}</button>
        <button className="btn sm" onClick={() => run(() => api(`/providers/${p.key}/test`, { method: 'POST' }), (r) => r.message).then(onChange)}>בדיקת חיבור</button>
        {p.capabilities.some((c) => ['pull_transactions', 'pull_keva', 'webhook'].includes(c)) && <button className="btn sm" onClick={() => run(() => api(`/providers/${p.key}/sync`, { method: 'POST' }), (r) => r.message).then(onChange)}>סנכרון עכשיו</button>}
        {p.docs && <a className="btn sm ghost" href={p.docs} target="_blank" rel="noopener">תיעוד</a>}
        {(p.config?.portal_url || p.portal) && <a className="btn sm ghost" href={p.config?.portal_url || p.portal} target="_blank" rel="noopener">לאתר בית העסק</a>}
        {p.capabilities.includes('settlement_import') && <Link className="btn sm" to="/app/settlements">קליטת דוח זיכויים</Link>}
      </div>
      {open && (
        <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          {p.note && <div className="notice small">{p.note}</div>}
          <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />חיבור פעיל</label>
          {p.capabilities.includes('pull_transactions') && <label className="check"><input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />סנכרון אוטומטי</label>}
          {p.fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.secret ? (p.secrets_set[f.key] ? '✓ שמור ומוצפן. השאירו ריק כדי לא לשנות' : 'לא הוזן') : null}>
              {f.secret
                ? <input className="input" type="password" dir="ltr" autoComplete="new-password" placeholder={p.secrets_set[f.key] ? '••••••••' : ''} value={sec[f.key] || ''} onChange={(e) => setSec({ ...sec, [f.key]: e.target.value })} />
                : <input className="input" dir="ltr" placeholder={f.placeholder} value={cfg[f.key] || ''} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })} />}
            </Field>
          ))}
          {p.capabilities.includes('webhook') && <Field label="כתובת Webhook להגדרה אצל הספק"><code className="input" style={{ direction: 'ltr', fontSize: 12, wordBreak: 'break-all' }}>{`${window.location.origin}/api/webhooks/${p.key}?secret=<סוד ה-Webhook>`}</code></Field>}
          <div className="row"><button className="btn primary sm" onClick={save}>שמירה</button></div>
        </div>
      )}
    </div>
  );
}

function ProvidersTab() {
  const { data, reload } = useApi('/providers');
  const [cat, setCat] = useState('');
  if (!data) return <Spinner />;
  const list = data.providers.filter((p) => !cat || p.category === cat);
  return (
    <div className="stack">
      <div className={`notice ${data.env.sandbox ? 'warn' : ''}`}><b>{data.env.label}.</b> מפתחות נשמרים מוצפנים במסד (AES-256) ולא מוצגים שוב. במצב פיתוח כל פעולה מול ספק מבוצעת בהדמיה או מול סביבת ה-Sandbox של הספק, ולא נוגעת בכסף אמיתי.</div>
      <div className="row"><button className={`btn sm ${!cat ? 'primary' : ''}`} onClick={() => setCat('')}>הכל ({data.providers.length})</button>{Object.entries(data.categories).map(([k, l]) => <button key={k} className={`btn sm ${cat === k ? 'primary' : ''}`} onClick={() => setCat(k)}>{l}</button>)}</div>
      <div className="grid2">{list.map((p) => <ProviderCard key={p.key} p={p} caps={data.capabilities} onChange={reload} />)}</div>
      <div className="card"><h3>ריצות סנכרון אחרונות</h3>
        <div className="table-wrap"><table className="t"><thead><tr><th>מתי</th><th>ספק</th><th>סטטוס</th><th>נקלטו</th><th>עודכנו</th><th>הודעה</th></tr></thead>
          <tbody>{data.runs.map((r) => <tr key={r.id}><td className="small">{datetime(r.started_at)}</td><td>{data.providers.find((p) => p.key === r.provider)?.label}</td><td><Tag kind={r.status === 'ok' ? 'ok' : r.status === 'error' ? 'bad' : 'warn'}>{r.status}</Tag></td><td>{r.imported}</td><td>{r.updated}</td><td className="small">{r.message}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
}

// ---------- תוכן האתר ----------
function SiteTab() {
  const [key, setKey] = useState('org');
  const { data, reload } = useApi(`/settings/${key}`);
  const [text, setText] = useState('');
  useEffect(() => { if (data) setText(JSON.stringify(data.value, null, 2)); }, [data]);
  const labels = { org: 'פרטי העמותה, טלפונים, לוגו וקישור תרומה', theme: 'צבעים', site: 'תפריט ותוכן כל העמודים', rates: 'שערי מטבע', documents: 'הגדרות קבלות' };
  return (
    <div className="stack">
      <div className="row">{Object.entries(labels).map(([k, l]) => <button key={k} className={`btn sm ${key === k ? 'primary' : ''}`} onClick={() => setKey(k)}>{l}</button>)}</div>
      {key === 'org' && data && <OrgForm value={data.value} onSaved={reload} />}
      {key === 'theme' && data && <ThemeForm value={data.value} onSaved={reload} />}
      <div className="card stack">
        <div className="row between"><h3>עריכה מתקדמת (JSON)</h3><div className="row">
          <button className="btn sm" onClick={() => { if (window.confirm('לשחזר את ברירת המחדל?')) setText(JSON.stringify(data.defaults, null, 2)); }}>ברירת מחדל</button>
          <button className="btn sm primary" onClick={() => { let v; try { v = JSON.parse(text); } catch { toast('JSON לא תקין', 'error'); return; } run(() => api(`/settings/${key}`, { method: 'PUT', body: { value: v } }), 'נשמר. רעננו את האתר לראות שינויים').then(reload); }}>שמירה</button></div></div>
        <textarea className="input json-edit" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <p className="small muted">כל הטקסטים, הקישורים, התמונות וקבצי השמע של האתר הציבורי נערכים כאן - בלי לגעת בקוד. עמודים: home, story, rabbi, mostod, assistance, classes, ahuza, contact, terms. סוגי מקטע: heading, sub, text, cards, chips, quote, image, gallery, audio, videos, options, facts, link.</p>
      </div>
    </div>
  );
}

function OrgForm({ value, onSaved }) {
  const [v, setV] = useState(value);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="card">
      <h3>פרטי העמותה (משמשים בכל האתר)</h3>
      <div className="form-grid">
        {[['name', 'שם'], ['short_name', 'שם קצר'], ['legal_name', 'שם משפטי'], ['email', 'מייל'], ['whatsapp', 'וואטסאפ'], ['fax', 'פקס'], ['address', 'כתובת'], ['po_box', 'ת.ד.'], ['nedarim_mosad', 'מוסד בנדרים']].map(([k, l]) => <Field key={k} label={l}><input className="input" value={v[k] || ''} onChange={set(k)} /></Field>)}
        <Field label="טלפונים (מופרדים בפסיק)"><input className="input" value={(v.phones || []).join(', ')} onChange={(e) => setV({ ...v, phones: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Field>
        <Field label="קישור תרומה" full><input className="input" dir="ltr" value={v.donation_url || ''} onChange={set('donation_url')} /></Field>
        <Field label="כתובת הלוגו" full hint="הלוגו מוצג ביחס המקורי שלו בלבד (גובה קבוע, רוחב אוטומטי) - בלי מתיחה או עיוות"><input className="input" dir="ltr" value={v.logo_url || ''} onChange={set('logo_url')} /></Field>
        {v.logo_url && <div className="full" style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 12, height: 110, display: 'flex', alignItems: 'center' }}><img src={v.logo_url} alt="לוגו" style={{ height: '100%', width: 'auto', objectFit: 'contain' }} /></div>}
      </div>
      <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(() => api('/settings/org', { method: 'PUT', body: { value: v } }), 'נשמר').then(onSaved)}>שמירה</button>
    </div>
  );
}

function ThemeForm({ value, onSaved }) {
  const [v, setV] = useState(value);
  return (
    <div className="card"><h3>צבעי האתר והמערכת</h3>
      <div className="row">{Object.entries({ primary: 'ראשי', primary_dark: 'ראשי כהה', accent: 'זהב / הדגשה', sky: 'רקע בהיר', ink: 'טקסט' }).map(([k, l]) => <Field key={k} label={l}><input type="color" className="input" style={{ width: 90 }} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}</div>
      <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(() => api('/settings/theme', { method: 'PUT', body: { value: v } }), 'נשמר').then(() => { onSaved(); window.location.reload(); })}>שמירה</button>
    </div>
  );
}

// ---------- נתוני דוגמה ----------
function DemoTab() {
  const { data, reload } = useApi('/demo/preview');
  const [clear, setClear] = useState(false);
  const [seedRes, setSeedRes] = useState(null);
  if (!data) return <Spinner />;
  return (
    <div className="stack">
      <div className="notice small">נתוני דוגמה מסומנים טכנית (is_demo) ולא לפי שם. הניקוי מוחק רק אותם - לא נוגע בקוד, במבנה המסד, במפתחות, בהגדרות, בחשבון המתכנת או בנתונים אמיתיים.</div>
      <div className="card">
        <h3>מצב נוכחי</h3>
        <p>נתוני דוגמה: <b>{data.total}</b> רשומות · נתונים אמיתיים (תורמים + תנועות): <b>{data.realRecords}</b></p>
        {data.total > 0 && <div className="row">{Object.entries(data.counts).map(([k, c]) => <Tag key={k}>{k}: {c}</Tag>)}</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={data.total > 0} onClick={() => run(() => api('/demo/seed', { method: 'POST', body: {} }), 'נוצרו נתוני דוגמה').then((r) => { setSeedRes(r); reload(); })}>יצירת נתוני דוגמה</button>
          <button className="btn danger" disabled={!data.total} onClick={() => setClear(true)}>ניקוי נתוני דוגמה</button>
        </div>
        {seedRes && <div className="notice small" style={{ marginTop: 10 }}>משתמשי דוגמה {seedRes.demoPin ? `(קוד ${seedRes.demoPin})` : '(קודים זמניים - מוצגים פעם אחת בלבד, יש להחליף בכניסה)'}: {seedRes.demoUsers.map((u) => `${u.name} $<bdi dir="ltr">{u.phone}</bdi>${!seedRes.demoPin && u.pin ? ` - ${u.pin}` : ''}`).join(' · ')}</div>}
      </div>
      {clear && <Confirm danger confirmWord="מחק נתוני דוגמה" title="ניקוי נתוני דוגמה" text={`יימחקו ${data.total} רשומות מסומנות. נתונים אמיתיים (${data.realRecords}) לא יושפעו.`} onClose={() => setClear(false)}
        onYes={() => run(() => api('/demo/clear', { method: 'POST', body: { confirm: 'מחק נתוני דוגמה' } }), (r) => `נמחקו ${r.total} רשומות`).then(() => { setClear(false); reload(); })} />}
    </div>
  );
}

function SystemTab() {
  const { data } = useApi('/system/status');
  if (!data) return <Spinner />;
  return (
    <div className="grid2">
      <div className="card"><h3>סביבה</h3><dl className="dl">
        <dt>מצב</dt><dd>{data.env.label}</dd><dt>Node</dt><dd>{data.node}</dd><dt>זמן פעילות</dt><dd>{Math.round(data.uptime / 60)} דקות</dd>
        <dt>מסד</dt><dd className="small">{data.db.name} · {data.db.size}</dd>
        {Object.entries(data.secrets).map(([k, v]) => <React.Fragment key={k}><dt className="num">{k}</dt><dd>{v === true ? '✓ מוגדר' : v === false ? <Tag kind="bad">חסר</Tag> : v}</dd></React.Fragment>)}
      </dl></div>
      <div className="card"><h3>רשומות</h3><dl className="dl">{Object.entries(data.counts).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl></div>
      <div className="card"><h3>כלים</h3><div className="stack">
        <button className="btn" onClick={() => run(() => api('/automations/run', { method: 'POST' }), (r) => `אוטומציות: ${r.messages} הודעות, ${r.ended} הו"ק הסתיימו`)}>הרצת אוטומציות יומיות עכשיו</button>
        <Link className="btn" to="/app/r/messages_out">יומן הודעות יוצאות</Link>
        <Link className="btn" to="/app/audit">יומן פעולות</Link>
      </div></div>
      <div className="card"><h3>מעבר לייצור (בעתיד)</h3><p className="small">כרגע הכל רץ בסביבת פיתוח גם כשהאתר מפורסם. כדי לעבור לייצור יש להגדיר ב-Secrets של Replit:</p>
        <pre className="input json-edit" style={{ minHeight: 0 }}>{'APP_MODE=production\nFORCE_SANDBOX=false'}</pre><p className="small muted">ולהזין מפתחות ייצור לכל ספק. לפני כן - בדיקה מלאה מול ה-Sandbox של כל ספק.</p></div>
    </div>
  );
}

function DiagTab() {
  const { data, reload } = useApi('/diag/key');
  const [report, setReport] = useState(null);
  const url = data ? `${window.location.origin}/api/diag?key=${data.key}` : '';
  const load = () => fetch(url).then((r) => r.json()).then(setReport).catch((e) => toast(e.message, 'error'));
  useEffect(() => { if (data) load(); }, [data?.key]);
  return (
    <div className="stack">
      <div className="notice small">דוח מצב לקריאה בלבד: גרסה, סביבה, ספירת רשומות, מצב החיבורים, שגיאות שרת ודפדפן אחרונות ופעולות אחרונות. ללא פרטי תורמים, טלפונים, מיילים או מפתחות. מי שמחזיק בקישור יכול לקרוא את הדוח - אפשר להחליף מפתח בכל רגע.</div>
      <div className="card stack">
        <h3>קישור הדוח</h3>
        <code className="input" style={{ direction: 'ltr', wordBreak: 'break-all', fontSize: 12 }}>{url || '...'}</code>
        <div className="row">
          <button className="btn primary" onClick={() => { navigator.clipboard?.writeText(url); toast('הקישור הועתק', 'ok'); }}>העתקת הקישור</button>
          <button className="btn" onClick={load}>רענון</button>
          <button className="btn danger" onClick={() => window.confirm('להחליף מפתח? הקישור הקודם יפסיק לעבוד') && run(() => api('/diag/rotate', { method: 'POST' }), 'הוחלף').then(reload)}>החלפת מפתח</button>
          <button className="btn" onClick={() => run(() => api('/diag/clear-errors', { method: 'POST' }), 'יומן השגיאות נוקה').then(load)}>ניקוי שגיאות</button>
        </div>
      </div>
      {report && (
        <div className="card">
          <h3>שגיאות אחרונות ({report.errors?.length || 0})</h3>
          {(report.errors || []).map((e, i) => <div key={i} className="small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}><Tag kind={e.source === 'client' ? 'info' : 'bad'}>{e.source}</Tag> {datetime(e.last_at)} · ×{e.count} · <span className="num">{e.path}</span><div style={{ direction: 'ltr', textAlign: 'left' }}>{e.message}</div></div>)}
          {!report.errors?.length && <div className="muted small">אין שגיאות 🎉</div>}
          <p className="small muted">גרסה: {report.build?.built_at || 'לא ידוע'} · {report.env?.label}</p>
        </div>
      )}
    </div>
  );
}


// ---------- בדיקות נדרים פלוס ----------
function NedarimTab() {
  const { data, reload } = useApi('/nedarim/tests');
  const [clear, setClear] = useState(false);
  if (!data) return <Spinner />;
  const m = data.mode;
  const st = { paid: ['ok', 'הצליח'], failed: ['bad', 'נכשל'], pending: ['warn', 'ממתין'], cancelled: ['', 'בוטל'] };
  return (
    <div className="stack">
      <div className={`notice ${m.test ? 'warn' : ''}`}>
        <b>{m.test ? 'מצב בדיקה - אין חיוב אמיתי' : 'מצב אמיתי - חיובים אמיתיים'}</b> · מוסד <bdi dir="ltr">{m.mosad}</bdi>.
        {m.test && ' מעבר למוסד האמיתי (7000318) נעול עד אישור: נדרשים APP_MODE=production, FORCE_SANDBOX=false, NEDARIM_LIVE=true ו-NEDARIM_API_VALID_LIVE ב-Secrets של האתר המפורסם.'}
      </div>
      <div className="card">
        <h3>כתובת CallBack</h3>
        <code className="input" style={{ direction: 'ltr', fontSize: 12, wordBreak: 'break-all' }}>{data.callback_url}</code>
        <div className="small muted">נשלחת אוטומטית בכל עסקה, יחד עם CallBackMailError במוסד הבדיקות.</div>
      </div>
      <div className="card">
        <h3>לקוחות דמה ותרחישים</h3>
        <p>לקוחות דמה קיימים: <b>{data.dummies}</b> · ת.ז לבדיקה: <bdi dir="ltr">{data.test_id}</bdi></p>
        <div className="row">
          <button className="btn primary" disabled={m.published} onClick={() => run(() => api('/nedarim/dummies', { method: 'POST' }), (r) => r.message).then(reload)}>יצירת לקוחות דמה</button>
          <button className="btn danger" onClick={() => setClear(true)}>מחיקת כל נתוני הבדיקה</button>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="t"><thead><tr><th>#</th><th>תרחיש</th><th>סכום</th><th>כרטיס להקלדה</th><th></th></tr></thead>
          <tbody>{data.scenarios.map((s) => {
            const c = data.cards[s.card ?? 0];
            return <tr key={s.id}><td>{s.id}</td><td>{s.title}</td><td>{s.amount ? money(s.amount) : '-'}</td>
              <td className="small">{s.redirect ? 'בדף התשלום של נדרים: לכתוב בשדה השם "בדיקת הפניה"' : s.double ? 'אוטומטי, בלי כרטיס' : <>{c.brand} <bdi dir="ltr">{c.number}</bdi> · <bdi dir="ltr">{s.bad_tokef || c.tokef}</bdi> · CVV <bdi dir="ltr">{c.cvv}</bdi></>}</td>
              <td>{s.redirect ? <a className="btn sm" href={`https://www.matara.pro/nedarimplus/online/?mosad=${m.mosad}`} target="_blank" rel="noopener">פתיחה</a>
                : s.double ? <button className="btn sm" onClick={() => run(() => api('/nedarim/double-test', { method: 'POST' }), (r) => r.message).then(reload)}>הרצה</button>
                : <a className="btn sm" href={`/donate?scenario=${s.id}`} target="_blank" rel="noopener">פתיחה</a>}</td></tr>;
          })}</tbody></table></div>
      </div>
      <div className="card">
        <div className="row between"><h3>תוצאות אחרונות</h3><button className="btn sm" onClick={reload}>רענון</button></div>
        <div className="table-wrap"><table className="t"><thead><tr><th>מתי</th><th>תרחיש</th><th>תורם</th><th>סכום</th><th>תשובת נדרים</th><th>סטטוס במערכת</th><th>CallBack</th></tr></thead>
          <tbody>{data.rows.map((r) => <tr key={r.id}><td className="small">{datetime(r.at)}</td><td>{r.scenario || '-'}{r.test && <Tag kind="warn">בדיקה</Tag>}</td><td>{r.donor}</td>
            <td>{money(r.amount)}{r.installments > 1 ? ` (${r.installments} תש׳)` : ''}{r.kind === 'keva' ? ' הו"ק' : ''}</td>
            <td className="small">{r.response || r.reason || '-'}</td>
            <td><Tag kind={(st[r.status] || [])[0]}>{(st[r.status] || [r.status, r.status])[1]}</Tag></td>
            <td>{r.callback ? <Tag kind="ok">התקבל</Tag> : <Tag>לא</Tag>}</td></tr>)}
          {!data.rows.length && <tr><td colSpan={7} className="muted">עוד לא בוצעו בדיקות</td></tr>}</tbody></table></div>
      </div>
      {clear && <Confirm danger confirmWord="מחק בדיקות" title="מחיקת נתוני בדיקה" text="יימחקו כל תנועות מוסד הבדיקות ולקוחות הדמה של נדרים. נתונים אמיתיים לא יושפעו." onClose={() => setClear(false)}
        onYes={() => run(() => api('/nedarim/dummies/clear', { method: 'POST' }), (r) => r.message).then(() => { setClear(false); reload(); })} />}
    </div>
  );
}

export function DevPage() {
  const [tab, setTab] = useState('providers');
  const tabs = [['providers', 'חיבורים ו-API'], ['nedarim', 'בדיקות נדרים פלוס'], ['site', 'תוכן האתר והגדרות'], ['demo', 'נתוני דוגמה'], ['diag', 'דוח מצב'], ['system', 'מערכת']];
  return (
    <div>
      <div className="page-head"><h1>מסך המתכנת</h1></div>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'providers' && <ProvidersTab />}
      {tab === 'nedarim' && <NedarimTab />}
      {tab === 'site' && <SiteTab />}
      {tab === 'demo' && <DemoTab />}
      {tab === 'diag' && <DiagTab />}
      {tab === 'system' && <SystemTab />}
    </div>
  );
}

export function SettingsPage() {
  const docs = useApi('/settings/documents');
  const rates = useApi('/settings/rates');
  const [d, setD] = useState(null);
  const [r, setR] = useState(null);
  useEffect(() => { if (docs.data) setD(docs.data.value); }, [docs.data]);
  useEffect(() => { if (rates.data) setR(rates.data.value); }, [rates.data]);
  if (!d || !r) return <Spinner />;
  return (
    <div className="stack">
      <div className="page-head"><h1>הגדרות העמותה</h1></div>
      <div className="card stack"><h3>קבלות</h3>
        <Field label="ספק ברירת מחדל להפקת קבלות"><select className="input" value={d.default_provider} onChange={(e) => setD({ ...d, default_provider: e.target.value })}>{[['greeninvoice', 'חשבונית ירוקה'], ['icount', 'iCount'], ['ezcount', 'EZcount'], ['rivhit', 'ריווחית'], ['sumit', 'סאמיט']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="סף תרומה גבוהה (התראה למנהל) ₪"><input className="input" type="number" value={d.large_donation_threshold} onChange={(e) => setD({ ...d, large_donation_threshold: e.target.value })} /></Field>
        <button className="btn primary" onClick={() => run(() => api('/settings/documents', { method: 'PUT', body: { value: d } }), 'נשמר')}>שמירה</button>
      </div>
      <div className="card stack"><h3>שערי מטבע (להמרה לשקלים בדוחות)</h3>
        <div className="row">{Object.keys(r).map((k) => <Field key={k} label={k}><input className="input" type="number" step="0.01" style={{ width: 110 }} value={r[k]} onChange={(e) => setR({ ...r, [k]: Number(e.target.value) })} /></Field>)}</div>
        <button className="btn primary" onClick={() => run(() => api('/settings/rates', { method: 'PUT', body: { value: r } }), 'נשמר')}>שמירה</button>
      </div>
      <Link className="btn" to="/app/r/institutions">מוסדות ומטרות</Link>
    </div>
  );
}

// ---------- משתמשים ----------
export function UsersPage() {
  const { user } = useContext(AppCtx);
  const { data, reload } = useApi('/users');
  const me = useApi('/auth/me');
  const [edit, setEdit] = useState(null);
  const [pinShow, setPinShow] = useState(null);
  const ROLES = me.data?.roles || {};
  if (!data) return <Spinner />;
  return (
    <div>
      <div className="page-head"><h1>משתמשים והרשאות</h1><button className="btn primary" onClick={() => setEdit({ roles: [] })}>+ משתמש</button></div>
      <p className="small muted">היררכיה: מתכנת ← מנהל ← צוות. משתמש יכול להחזיק כמה תפקידים ולעבור ביניהם בלחיצה. כניסה בטלפון + קוד אישי; אחרי 5 ניסיונות שגויים נעילה ל-15 דקות, ואחרי 5 נעילות - נעילה קבועה עד שחרור.</p>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>שם</th><th>טלפון</th><th>תפקידים</th><th>כניסה אחרונה</th><th>מצב</th><th /></tr></thead>
        <tbody>{data.rows.map((u) => (
          <tr key={u.id}>
            <td>{u.name} {u.is_owner && <Tag kind="purple">בעלים</Tag>}</td><td className="num">{u.phone || 'לא הוזן'}</td>
            <td>{u.roles.map((r) => <Tag key={r} kind={r === 'developer' ? 'warn' : 'info'}>{ROLES[r]?.label || r}</Tag>)}</td>
            <td className="small">{datetime(u.last_login_at)}</td>
            <td>{!u.active ? <Tag>מושבת</Tag> : u.locked_permanent ? <Tag kind="bad">נעול</Tag> : u.locked_until && new Date(u.locked_until) > new Date() ? <Tag kind="warn">נעול זמנית</Tag> : <Tag kind="ok">פעיל</Tag>}{u.must_change_pin && <> <Tag>קוד זמני</Tag></>}</td>
            <td className="nowrap">
              <button className="btn sm" onClick={() => setEdit(u)}>עריכה</button>
              {(u.locked_permanent || u.locked_until) && <button className="btn sm" onClick={() => run(() => api(`/users/${u.id}/unlock`, { method: 'POST' }), 'שוחרר').then(reload)}>שחרור</button>}
              <button className="btn sm" onClick={() => run(() => api(`/users/${u.id}/reset-pin`, { method: 'POST' })).then((r) => setPinShow({ name: u.name, pin: r.temp_pin }))}>איפוס קוד</button>
              {user.active_role === 'developer' && u.id !== user.id && u.active && <button className="btn sm" onClick={() => window.confirm(`להתחבר כ${u.name}? הפעולה תתועד`) && run(() => api(`/auth/impersonate/${u.id}`, { method: 'POST' })).then(() => { window.location.href = '/app'; })}>התחזות</button>}
            </td>
          </tr>
        ))}</tbody>
      </table></div>
      {edit && <UserForm u={edit} roles={ROLES} actor={user} onClose={() => setEdit(null)} onDone={(r) => { setEdit(null); reload(); if (r?.temp_pin) setPinShow({ name: 'המשתמש החדש', pin: r.temp_pin }); }} />}
      {pinShow && <Modal title="קוד זמני" size="narrow" onClose={() => setPinShow(null)}><p>הקוד הזמני של {pinShow.name}:</p><pre className="input num" style={{ fontSize: 26, textAlign: 'center' }}>{pinShow.pin}</pre><p className="small muted">יוצג פעם אחת בלבד. המשתמש יתבקש להחליף אותו בכניסה הראשונה.</p></Modal>}
    </div>
  );
}

function UserForm({ u, roles, actor, onClose, onDone }) {
  const [f, setF] = useState({ name: u.name || '', phone: u.phone || '', email: u.email || '', roles: u.roles || [], institution_id: u.institution_id || null, active: u.active !== false });
  const toggle = (r) => setF({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] });
  const save = async (confirm_developer) => {
    try {
      const res = u.id ? await api(`/users/${u.id}`, { method: 'PUT', body: { ...f, confirm_developer } }) : await api('/users', { method: 'POST', body: { ...f, confirm_developer } });
      toast('נשמר', 'ok'); onDone(res);
    } catch (e) {
      if (e.status === 409 && e.data?.needConfirm === 'developer') { if (window.confirm('אזהרה: הרשאת מתכנת נותנת שליטה מלאה כולל מפתחות API. לאשר?')) save(true); } else toast(e.message, 'error');
    }
  };
  return (
    <Modal title={u.id ? 'עריכת משתמש' : 'משתמש חדש'} onClose={onClose} footer={<><button className="btn primary" onClick={() => save(false)}>שמירה</button><button className="btn" onClick={onClose}>ביטול</button></>}>
      <div className="form-grid">
        <Field label="שם *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="טלפון (לכניסה בקוד)"><input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="מייל Google (לכניסה עם Google)"><input className="input" type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="מוסד (למנהל מוסד)"><RefPicker res="institutions" value={f.institution_id} onChange={(v) => setF({ ...f, institution_id: v })} /></Field>
        <div className="full"><label className="small muted">תפקידים</label><div className="row" style={{ marginTop: 6 }}>
          {Object.entries(roles).filter(([k]) => k !== 'donor' && (k !== 'developer' || actor.active_role === 'developer')).map(([k, r]) => <label key={k} className="check" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '4px 10px' }}><input type="checkbox" checked={f.roles.includes(k)} onChange={() => toggle(k)} />{r.label}</label>)}
        </div></div>
        {u.id && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />פעיל (ביטול = ניתוק מיידי)</label>}
      </div>
    </Modal>
  );
}

const AUDIT_ACTIONS = {
  login: 'כניסה למערכת', login_google: 'כניסה עם Google', login_failed: 'ניסיון כניסה שנכשל', google_login_denied: 'כניסת Google נדחתה',
  pin_reset: 'איפוס קוד', profile_update: 'עדכון פרופיל', impersonate_start: 'תחילת התחזות', impersonate_stop: 'סיום התחזות',
  user_create: 'יצירת משתמש', user_create_invite: 'משתמש חדש מהזמנה', user_update: 'עדכון משתמש', user_unlock: 'שחרור נעילה',
  create: 'יצירה', update: 'עדכון', delete: 'מחיקה', export: 'ייצוא', import_donors: 'ייבוא תורמים', donor_merge: 'איחוד כפילויות',
  tx_create: 'רישום תרומה', tx_update: 'עדכון תרומה', keva_create: 'הוראת קבע חדשה', document_issue: 'הפקת קבלה', document_cancel: 'ביטול קבלה',
  masav_file: 'קובץ מס"ב', masav_returns: 'החזרות מס"ב', settlements_import: 'ייבוא דוח זיכויים', settlements_batch_delete: 'מחיקת דוח זיכויים',
  bulk_message: 'שליחת הודעה לקבוצה', call_outcome: 'תיעוד שיחה', calls_generate: 'יצירת רשימת שיחות', field_collect: 'גבייה בשטח', field_keva: 'הו"ק מהשטח',
  automations_run: 'הרצת אוטומציות', provider_save: 'שמירת הגדרות ספק', provider_sync: 'סנכרון ספק', provider_test: 'בדיקת חיבור ספק', webhook: 'עדכון מספק',
  settings_update: 'עדכון הגדרות', demo_seed: 'יצירת נתוני דוגמה', demo_clear: 'מחיקת נתוני דוגמה', diag_rotate: 'החלפת מפתח דוח מצב', diag_clear_errors: 'ניקוי יומן שגיאות',
};
const AUDIT_ENTITIES = {
  user: 'משתמש', donor: 'תורם', donors: 'תורמים', transaction: 'תרומה', standing_order: 'הוראת קבע', document: 'קבלה', provider: 'ספק',
  settings: 'הגדרות', masav: 'מס"ב', settlements: 'זיכויי אשראי', call_task: 'שיחה', call_tasks: 'שיחות', messages: 'הודעות', automations: 'אוטומציות',
  demo: 'נתוני דוגמה', diag: 'דוח מצב', institutions: 'מוסד', purposes: 'מטרה', campaigns: 'קמפיין', donor_dates: 'תאריך', interactions: 'תיעוד',
  pledges: 'התחייבות', tzedaka_boxes: 'קופת צדקה', box_collections: 'פריקת קופה', spiritual_orders: 'מבצע רוחני', events: 'אירוע', event_guests: 'מוזמן',
  aid_requests: 'בקשת סיוע', materials: 'חומר לתורמים', segments: 'פילוח', contact_messages: 'פנייה מהאתר', messages_out: 'הודעה',
};
const AUDIT_KEYS = {
  email: 'מייל', roles: 'תפקידים', target: 'יעד', name: 'שם', phone: 'טלפון', amount: 'סכום', count: 'כמות', rows: 'שורות', provider: 'ספק',
  reason: 'סיבה', number: 'מספר', status: 'סטטוס', ok: 'הצליח', error: 'שגיאה', imported: 'יובאו', matched: 'הותאמו', duplicates: 'כפולים', batch: 'דוח',
};
function auditValue(k, v, roles) {
  if (v === null || v === undefined || v === '') return '-';
  if (k === 'roles' && Array.isArray(v)) return v.map((r) => roles?.[r]?.label || r).join(', ');
  if (typeof v === 'boolean') return v ? 'כן' : 'לא';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return Object.entries(v).map(([a, b]) => `${AUDIT_KEYS[a] || a}: ${typeof b === 'object' ? JSON.stringify(b) : b}`).join(' · ');
  return String(v);
}
function AuditDetails({ details, roles }) {
  if (!details || typeof details !== 'object') return null;
  const entries = Object.entries(details).filter(([, v]) => v !== undefined);
  if (!entries.length) return null;
  return (
    <div className="audit-details">
      {entries.slice(0, 8).map(([k, v]) => (
        <div key={k}><span className="muted">{AUDIT_KEYS[k] || k}:</span> <bdi>{auditValue(k, v, roles)}</bdi></div>
      ))}
    </div>
  );
}

export function AuditPage() {
  const { meta } = useContext(AppCtx);
  const [roles, setRoles] = useState(null);
  useEffect(() => { api('/auth/me').then((d) => setRoles(d.roles)).catch(() => {}); }, []);
  const [f, setF] = useState({ action: '', entity: '', from: '', impersonated: '' });
  const [page, setPage] = useState(1);
  const { data } = useApi(`/audit${qs({ ...f, page })}`);
  const entityLabel = (e) => AUDIT_ENTITIES[e] || meta?.resources?.[e]?.label || e || '';
  return (
    <div>
      <div className="page-head"><h1>יומן פעולות</h1></div>
      <div className="toolbar">
        <select className="input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          <option value="">כל הפעולות</option>
          {Object.entries(AUDIT_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}>
          <option value="">כל הנושאים</option>
          {Object.entries(AUDIT_ENTITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} title="מתאריך" />
        <label className="check small"><input type="checkbox" checked={f.impersonated === 'true'} onChange={(e) => setF({ ...f, impersonated: e.target.checked ? 'true' : '' })} />רק בהתחזות</label>
      </div>
      {!data ? <Spinner /> : !data.rows.length ? <div className="empty">אין פעולות להצגה</div> : (
        <div className="audit-list">
          {data.rows.map((a) => (
            <div key={a.id} className="audit-item">
              <div className="audit-top">
                <Tag kind={/failed|denied|delete|cancel/.test(a.action) ? 'bad' : /login/.test(a.action) ? 'info' : ''}>{AUDIT_ACTIONS[a.action] || a.action}</Tag>
                <span className="small muted num">{datetime(a.at)}</span>
              </div>
              <div className="audit-who">
                <b>{a.user_name || 'מערכת'}</b>
                {a.entity && <span className="muted"> · {entityLabel(a.entity)}{a.entity_id ? ` #${a.entity_id}` : ''}</span>}
              </div>
              {a.impersonator_name && <div className="small" style={{ color: 'var(--bad)' }}>בהתחזות על ידי {a.impersonator_name}</div>}
              <AuditDetails details={a.details} roles={roles} />
            </div>
          ))}
        </div>
      )}
      <div className="pager"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>הקודם</button><span className="small">עמוד {page}</span><button className="btn sm" disabled={!data || data.rows.length < 100} onClick={() => setPage(page + 1)}>הבא</button></div>
    </div>
  );
}

export function ProfilePage() {
  const { user, reloadMe } = useContext(AppCtx);
  const [open, setOpen] = useState(null);
  const [f, setF] = useState({ phone: user.phone || '', email: user.email || '', current_pin: '', pin: '' });
  const save = (body) => run(() => api('/auth/profile', { method: 'POST', body }), 'עודכן').then(() => { setOpen(null); reloadMe(); });
  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <div className="page-head"><h1>הפרופיל שלי</h1></div>
      <div className="card stack">
        <dl className="dl"><dt>שם</dt><dd>{user.name}</dd><dt>טלפון</dt><dd className="num"><bdi dir="ltr">{user.phone}</bdi></dd><dt>מייל</dt><dd>{user.email || '-'}</dd></dl>
        <div className="row"><button className="btn" onClick={() => setOpen('phone')}>עריכת טלפון ומייל</button><button className="btn" onClick={() => setOpen('pin')}>החלפת קוד</button></div>
        {open === 'phone' && <div className="stack"><Field label="טלפון"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field><Field label="מייל"><input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field><button className="btn primary" onClick={() => save({ phone: f.phone, email: f.email })}>שמירה</button></div>}
        {open === 'pin' && <div className="stack"><Field label="קוד נוכחי"><input className="input" type="password" inputMode="numeric" value={f.current_pin} onChange={(e) => setF({ ...f, current_pin: e.target.value })} /></Field><Field label="קוד חדש (4-8 ספרות)"><input className="input" type="password" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} /></Field><button className="btn primary" onClick={() => save({ current_pin: f.current_pin, pin: f.pin })}>שמירה</button></div>}
      </div>
    </div>
  );
}
