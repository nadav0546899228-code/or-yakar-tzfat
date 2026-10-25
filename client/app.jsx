import React, { useState, useEffect } from 'react';
import { Link, useRoute, api, toast, navigate, money, date, datetime, Logo, Field, Modal, AppCtx, useApi, matchPath, Spinner, qs } from './lib.jsx';
import { SOURCE_LABELS } from './labels.js';
import { ResourcePage, DonorCard, TransactionsPage, KevaPage, DocumentsPage } from './crm.jsx';
import { CallsPage, FieldPage, CalendarPage, EventPage, MessagesPage, ReportsPage, MasavPage, DuplicatesPage } from './ops.jsx';
import { DevPage, UsersPage, AuditPage, ProfilePage, SettingsPage } from './dev.jsx';
import { SettlementsPage } from './settlements.jsx';
import { InstallPrompt, HelpPage } from './onboarding.jsx';
import { Icon, SourceBadge } from './icons.jsx';
import { NewDonation, NewKeva, ResourceForm } from './crm.jsx';
import { LiveUpdates } from './live.jsx';
import { InboxPage, GlobalSearch, ViewToggle } from './inbox.jsx';

// תפריט לפי הרשאה. perm = המפתח בשרת (roles.js)
const MENU = [
  { grp: 'ראשי' },
  { to: '/app', label: 'לוח בקרה', short: 'לוח', icon: 'dashboard', perm: 'staff' },
  { to: '/app/donors', label: 'תורמים', icon: 'donors', perm: 'donors.read' },
  { to: '/app/transactions', label: 'יומן תנועות מאוחד', short: 'תנועות', icon: 'shekel', perm: 'tx.read' },
  { to: '/app/keva', label: 'הוראות קבע', short: 'הו"ק', icon: 'repeat', perm: 'keva.read' },
  { to: '/app/documents', label: 'קבלות ומסמכים', short: 'קבלות', icon: 'receipt', perm: 'docs.read' },
  { to: '/app/inbox', label: 'הודעות צוות', short: 'הודעות', icon: 'mail', perm: 'staff', badge: 'inbox' },
  { grp: 'גיוס ושימור' },
  { to: '/app/calls', label: 'מוקד טלפוני', short: 'מוקד', icon: 'phone', perm: 'calls.read', badge: 'tasks' },
  { to: '/app/field', label: 'אפליקציית שטח', short: 'שטח', icon: 'mobile', perm: 'field.use' },
  { to: '/app/calendar', label: 'לוח שנה עברי', short: 'לוח שנה', icon: 'calendar', perm: 'donors.read' },
  { to: '/app/messages', label: 'פילוח ותפוצה', short: 'תפוצה', icon: 'send', perm: 'messages.send' },
  { to: '/app/r/pledges', label: 'התחייבויות ונדרים', short: 'נדרים', icon: 'pen', perm: 'tx.read' },
  { to: '/app/r/tzedaka_boxes', label: 'קופות צדקה', short: 'קופות', icon: 'box', perm: 'boxes.read', badge: 'boxes' },
  { grp: 'קמפיינים ואירועים' },
  { to: '/app/r/campaigns', label: 'קמפיינים', icon: 'flag', perm: 'staff' },
  { to: '/app/r/spiritual_orders', label: 'מבצעים רוחניים', short: 'מבצעים', icon: 'candle', perm: 'spiritual.read', badge: 'spiritual' },
  { to: '/app/r/events', label: 'אירועים ודינרים', short: 'אירועים', icon: 'star', perm: 'events.read' },
  { to: '/app/r/aid_requests', label: 'מרכז הסיוע', short: 'סיוע', icon: 'heart', perm: 'aid.read', badge: 'aid' },
  { grp: 'בקרה' },
  { to: '/app/reports', label: 'מרכז דוחות', short: 'דוחות', icon: 'chart', perm: 'reports.read' },
  { to: '/app/masav', label: 'מס"ב והחזרות', short: 'מס"ב', icon: 'bank', perm: 'keva.actions' },
  { to: '/app/settlements', label: 'זיכויי חברות אשראי', short: 'זיכויים', icon: 'card', perm: 'settlements.read' },
  { to: '/app/r/contact_messages', label: 'פניות מהאתר', short: 'פניות', icon: 'inbox', perm: 'messages.send', badge: 'contact' },
  { grp: 'הגדרות' },
  { to: '/app/r/institutions', label: 'מוסדות ומטרות', short: 'מוסדות', icon: 'building', perm: 'campaigns.write' },
  { to: '/app/r/automations', label: 'אוטומציות', icon: 'bolt', perm: 'automations.write' },
  { to: '/app/r/materials', label: 'חומרים לתורמים', short: 'חומרים', icon: 'clip', perm: 'automations.write' },
  { to: '/app/users', label: 'משתמשים והרשאות', short: 'משתמשים', icon: 'key', perm: 'users.manage' },
  { to: '/app/settings', label: 'הגדרות העמותה', short: 'הגדרות', icon: 'gear', perm: 'settings.org' },
  { to: '/app/audit', label: 'יומן פעולות', short: 'יומן', icon: 'scroll', perm: 'audit.read' },
  { to: '/app/dev', label: 'מסך המתכנת', short: 'מתכנת', icon: 'code', perm: 'dev.only', dev: true },
  { grp: 'עזרה' },
  { to: '/app/help', label: 'מדריך שימוש והתקנה', short: 'מדריך', icon: 'help', perm: 'staff' },
];
const MENU_BY = Object.fromEntries(MENU.filter((m) => m.to).map((m) => [m.to, m]));

// סרגל תחתון לפי תפקיד - ארבעה קיצורים, והחמישי "עוד" פותח את התפריט המלא
const BOTTOM_BY_ROLE = {
  secretary: ['/app', '/app/donors', '/app/documents', '/app/r/contact_messages'],
  treasurer: ['/app', '/app/transactions', '/app/keva', '/app/settlements'],
  accountant: ['/app', '/app/transactions', '/app/documents', '/app/reports'],
  call_agent: ['/app/calls', '/app/donors', '/app/calendar', '/app'],
  recruiter: ['/app/field', '/app/donors', '/app/r/tzedaka_boxes', '/app'],
  aid_coordinator: ['/app', '/app/r/aid_requests', '/app/donors', '/app/r/spiritual_orders'],
  institution_manager: ['/app', '/app/donors', '/app/transactions', '/app/reports'],
};
const BOTTOM_DEFAULT = ['/app', '/app/donors', '/app/transactions', '/app/reports'];

// ההרשאות מגיעות מהשרת (מקור אמת אחד) ונטענות בכניסה
let PERMS = {};
export function setPerms(p) { PERMS = p || {}; }
export function can(user, perm) {
  if (!user) return false;
  if (user.active_role === 'developer') return true;
  return (PERMS[perm] || []).includes(user.active_role);
}

// כפתור כניסה עם Google - מוצג רק כשהוגדר GOOGLE_CLIENT_ID
function GoogleButton() {
  const ref = React.useRef();
  const [cfg, setCfg] = useState(null);
  useEffect(() => { api('/auth/google-config').then(setCfg).catch(() => setCfg({})); }, []);
  useEffect(() => {
    if (!cfg?.client_id) return;
    const init = () => {
      window.google.accounts.id.initialize({
        client_id: cfg.client_id,
        callback: async (resp) => {
          try { await api('/auth/google', { method: 'POST', body: { credential: resp.credential } }); window.location.href = '/app'; } catch (err) { toast(err.message, 'error'); }
        },
      });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'he', width: 300 });
    };
    if (window.google?.accounts?.id) { init(); return; }
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true;
    sc.onload = init;
    document.head.appendChild(sc);
  }, [cfg?.client_id]);
  if (!cfg?.client_id) return null;
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}><span className="small muted">או</span><div ref={ref} /></div>;
}

export function Login({ org }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api('/auth/login', { method: 'POST', body: { phone, pin } }); window.location.href = '/app'; } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={submit}>
        <div className="logo"><Logo src={org?.logo_url} alt={org?.name || 'אור יקר'} /></div>
        <h2 style={{ textAlign: 'center' }}>כניסה למערכת</h2>
        <Field label="טלפון"><input className="input" type="tel" autoComplete="username" required value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus /></Field>
        <Field label="קוד אישי"><input className="input" type="password" inputMode="numeric" autoComplete="current-password" required value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
        <button className="btn primary" disabled={busy}>{busy ? 'נכנס…' : 'כניסה'}</button>
        <GoogleButton />
        <Link to="/" className="small muted" style={{ textAlign: 'center' }}>חזרה לאתר</Link>
      </form>
    </div>
  );
}

function ForcePin({ onDone }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  return (
    <Modal title="יש לבחור קוד אישי חדש" onClose={() => {}} size="narrow" footer={
      <button className="btn primary" disabled={pin.length < 4 || pin !== pin2} onClick={async () => {
        try { await api('/auth/profile', { method: 'POST', body: { pin } }); toast('הקוד עודכן', 'ok'); onDone(); } catch (e) { toast(e.message, 'error'); }
      }}>שמירה</button>}>
      <p className="muted">זו כניסה ראשונה או שהקוד אופס. בחרו קוד של 4-8 ספרות.</p>
      <div className="stack">
        <Field label="קוד חדש"><input className="input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="אימות"><input className="input" type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
    </Modal>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi('/notifications');
  useEffect(() => { const t = setInterval(reload, 60000); return () => clearInterval(t); }, []);
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn ghost icon" onClick={() => setOpen(!open)} aria-label="התראות">🔔{data?.unread ? <span className="tag bad" style={{ marginInlineStart: 2 }}>{data.unread}</span> : null}</button>
      {open && <div className="notif-bg" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <div className="card notif-panel">
          <div className="row between"><b>התראות</b><button className="btn sm ghost" onClick={async () => { await api('/notifications/read', { method: 'POST', body: { all: true } }); reload(); }}>סימון הכל כנקרא</button></div>
          {(data?.rows || []).map((n) => (
            <div key={n.id} style={{ padding: '8px 4px', borderBottom: '1px solid var(--line)', opacity: n.read ? 0.6 : 1, cursor: n.link ? 'pointer' : 'default' }}
              onClick={() => { if (n.link) { navigate(n.link); setOpen(false); } api('/notifications/read', { method: 'POST', body: { ids: [n.id] } }).then(reload); }}>
              <b className="small">{n.title}</b><div className="small muted">{n.body}</div><div className="small muted">{datetime(n.at)}</div>
            </div>
          ))}
          {!data?.rows?.length && <div className="empty">אין התראות</div>}
        </div>
      )}
    </div>
  );
}

// ---------- כפתור "+" צף: פעולות מהירות לפי הרשאה ----------
const QUICK = [
  { key: 'donation', label: 'תרומה חדשה', icon: 'shekel', perm: 'tx.write', color: '#1f6f4a' },
  { key: 'donor', label: 'תורם חדש', icon: 'userPlus', perm: 'donors.write', color: '#16357a', res: 'donors' },
  { key: 'keva', label: 'הוראת קבע', icon: 'repeat', perm: 'keva.actions', color: '#2b6cb0' },
  { key: 'task', label: 'משימת שיחה', icon: 'phone', perm: 'calls.read', color: '#0f766e', res: 'call_tasks' },
  { key: 'log', label: 'תיעוד שיחה / פגישה', icon: 'note', perm: 'donors.write', color: '#5b6478', res: 'interactions' },
  { key: 'box', label: 'פריקת קופה', icon: 'box', perm: 'boxes.write', color: '#a16207', res: 'box_collections' },
  { key: 'spiritual', label: 'שם לתפילה', icon: 'candle', perm: 'spiritual.write', color: '#b8862b', res: 'spiritual_orders' },
  { key: 'aid', label: 'בקשת סיוע', icon: 'heart', perm: 'aid.write', color: '#9b2c6f', res: 'aid_requests' },
];
function QuickActions({ user, meta }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const items = QUICK.filter((q) => can(user, q.perm) && (!q.res || meta.resources?.[q.res]));
  if (!items.length) return null;
  const done = () => { setModal(null); window.dispatchEvent(new Event('oy:refresh')); };
  return (
    <>
      {open && <div className="fab-bg" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <div className="fab-menu" role="menu">
          {items.map((q) => (
            <button key={q.key} className="fab-item" role="menuitem" onClick={() => { setOpen(false); setModal(q); }}>
              <span className="fab-item-ico" style={{ background: q.color }}><Icon name={q.icon} size={19} /></span>{q.label}
            </button>
          ))}
        </div>
      )}
      <button className={`fab ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-label="פעולה חדשה" aria-expanded={open}><Icon name="plus" size={28} /></button>
      {modal?.key === 'donation' && <NewDonation onClose={() => setModal(null)} onDone={done} />}
      {modal?.key === 'keva' && <NewKeva onClose={() => setModal(null)} onDone={done} />}
      {modal?.res && <ResourceForm resKey={modal.res} onClose={() => setModal(null)} onSaved={(r) => { done(); if (modal.res === 'donors' && r?.id) navigate(`/app/donors/${r.id}`); }} />}
    </>
  );
}

// ---------- לוח בקרה ----------
function useDismissed() {
  const read = () => { try { return JSON.parse(localStorage.getItem('oy_dismiss') || '{}'); } catch { return {}; } };
  const [d, setD] = useState(read);
  const dismiss = (k, c) => { const n = { ...read(), [k]: c }; try { localStorage.setItem('oy_dismiss', JSON.stringify(n)); } catch { /* */ } setD(n); };
  return [d, dismiss];
}

function Tile({ icon, color, label, value, sub, onClick, tone }) {
  return (
    <button type="button" className={`tile ${tone || ''}`} onClick={onClick} disabled={!onClick}>
      <span className="tile-ico" style={{ background: color }}><Icon name={icon} size={22} /></span>
      <span className="tile-body"><span className="tile-label">{label}</span><span className="tile-value num">{value}</span>{sub && <span className="tile-sub">{sub}</span>}</span>
    </button>
  );
}

function Dashboard() {
  const { user, demoMode } = React.useContext(AppCtx);
  const { data, loading } = useApi(`/dashboard${qs({ demo: demoMode })}`);
  const [dismissed, dismiss] = useDismissed();
  if (loading && !data) return <Spinner />;
  if (!data) return <Spinner />;
  const go = (to) => () => navigate(to);
  const maxMonth = Math.max(1, ...(data.monthly || []).map((m) => Number(m.total)));
  const maxSrc = Math.max(1, ...(data.bySource || []).map((s) => Number(s.total)));
  const maxInst = Math.max(1, ...(data.byInstitution || []).map((s) => Number(s.total)));
  // "מה דורש טיפול עכשיו" - רק מה שיש בו משהו ושמותר לתפקיד לראות
  const todo = [
    data.failed && { k: 'failed', c: data.failed.c, tone: 'bad', icon: 'alert', text: 'חיובים שנכשלו ב-30 הימים האחרונים', sub: money(data.failed.total), btn: 'לטיפול', to: '/app/transactions?status=failed', perm: 'tx.read' },
    data.pendingApproval && { k: 'approve', c: data.pendingApproval.c, tone: 'warn', icon: 'check2', text: 'מזומן וצ׳קים שממתינים לאישור גזבר', btn: 'לאישור', to: '/app/transactions?pending_approval=true', perm: 'tx.approve' },
    data.noDocument && { k: 'nodoc', c: data.noDocument.c, tone: 'warn', icon: 'receipt', text: 'תרומות השנה שעדיין אין להן קבלה', btn: 'הפקת קבלות', to: '/app/transactions?no_document=true', perm: 'docs.issue' },
    data.notReported && { k: 'tax', c: data.notReported.c, tone: 'bad', icon: 'scroll', text: 'קבלות 46 שלא דווחו לרשות המסים', btn: 'לדיווח', to: '/app/documents?tax_report_status=pending', perm: 'docs.read' },
    data.kevaChurn && { k: 'churn', c: data.kevaChurn.c, tone: 'warn', icon: 'repeat', text: 'הוראות קבע שבוטלו או הסתיימו - לשיחת חידוש', btn: 'לרשימה', to: '/app/keva?churn=true', perm: 'keva.read' },
    { k: 'calls', c: data.tasks.c, tone: 'info', icon: 'phone', text: 'שיחות שממתינות במוקד', btn: 'למוקד', to: '/app/calls', perm: 'calls.read' },
    { k: 'contact', c: data.contactOpen.c, tone: 'info', icon: 'inbox', text: 'פניות חדשות מהאתר', btn: 'לפניות', to: '/app/r/contact_messages', perm: 'messages.send' },
    { k: 'boxes', c: data.boxesDue.c, tone: 'gold', icon: 'box', text: 'קופות צדקה שהגיע מועד הפריקה שלהן', btn: 'לקופות', to: '/app/r/tzedaka_boxes', perm: 'boxes.read' },
    { k: 'aid', c: data.aidOpen.c, tone: 'purple', icon: 'heart', text: 'בקשות סיוע פתוחות', btn: 'לבקשות', to: '/app/r/aid_requests', perm: 'aid.read' },
    { k: 'spiritual', c: data.spiritualPending.c, tone: 'gold', icon: 'candle', text: 'שמות לתפילה שממתינים לביצוע', btn: 'לרשימה', to: '/app/r/spiritual_orders?f_status=pending', perm: 'spiritual.read' },
    { k: 'pledges', c: data.openPledges.c, tone: 'info', icon: 'pen', text: `התחייבויות פתוחות (${money(data.openPledges.total)})`, btn: 'לגבייה', to: '/app/r/pledges', perm: 'tx.read' },
  ].filter((t) => t && t.c > 0 && can(user, t.perm) && dismissed[t.k] !== t.c);
  return (
    <div className="stack">
      <div className="page-head"><h1>שלום {user.name.split(' ')[0]}</h1><span className="muted">{new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      {data.finance && (
        <div className="tiles">
          <Tile icon="shekel" color="#1f6f4a" label="היום" value={money(data.totals.today)} onClick={go('/app/transactions')} />
          <Tile icon="calendar" color="#16357a" label="החודש" value={money(data.totals.month)} sub={`${data.totals.month_count} תרומות`} onClick={go('/app/transactions')} />
          <Tile icon="chart" color="#b8862b" label="מתחילת השנה" value={money(data.totals.year)} onClick={go('/app/reports')} />
          <Tile icon="repeat" color="#2b6cb0" label="הו״ק פעילות" value={data.keva.active} sub={`צפי ${money(data.keva.monthly)} בחודש`} onClick={go('/app/keva')} />
        </div>
      )}
      {!data.finance && (
        <div className="tiles">
          {can(user, 'calls.read') && <Tile icon="phone" color="#0f766e" label="שיחות בתור" value={data.tasks.c} onClick={go('/app/calls')} />}
          {can(user, 'boxes.read') && <Tile icon="box" color="#a16207" label="קופות לפריקה" value={data.boxesDue.c} onClick={go('/app/r/tzedaka_boxes')} />}
          {can(user, 'aid.read') && <Tile icon="heart" color="#9b2c6f" label="בקשות סיוע" value={data.aidOpen.c} onClick={go('/app/r/aid_requests')} />}
          {can(user, 'donors.read') && <Tile icon="donors" color="#16357a" label="תורמים" value={<Icon name="arrowLeft" />} onClick={go('/app/donors')} />}
        </div>
      )}
      <div className="card todo-card">
        <h3 className="row" style={{ gap: 8 }}><Icon name="task" />מה דורש טיפול עכשיו</h3>
        {todo.length ? todo.map((t) => (
          <div key={t.k} className={`todo ${t.tone}`}>
            <span className="todo-ico"><Icon name={t.icon} size={20} /></span>
            <button type="button" className="todo-text" onClick={go(t.to)}><b className="num">{t.c}</b> {t.text}{t.sub && <span className="muted small"> · {t.sub}</span>}</button>
            <button type="button" className="btn sm todo-btn" onClick={go(t.to)}>{t.btn}</button>
            <button type="button" className="btn ghost icon todo-x" title="הסתרה עד שיהיה שינוי" aria-label="הסתרה" onClick={() => dismiss(t.k, t.c)}><Icon name="x" size={16} /></button>
          </div>
        )) : <div className="todo-empty"><Icon name="check" /> הכול מטופל. אין משימות פתוחות</div>}
      </div>
      {data.finance && (
        <div className="grid2">
          <div className="card">
            <div className="row between"><h3>הכנסות 12 חודשים</h3><div className="legend"><span><i style={{ background: 'var(--primary)' }} />הו"ק</span><span><i style={{ background: 'var(--accent)' }} />חד-פעמי</span></div></div>
            <div className="colchart">
              {data.monthly.map((m) => (
                <div className="col" key={m.m} title={`${m.m}: ${money(m.total)}`}>
                  <div className="stack" style={{ height: `${(Number(m.total) / maxMonth) * 100}%`, marginTop: 0 }}>
                    <div className="seg-a" style={{ height: `${(Number(m.keva) / Math.max(1, Number(m.total))) * 100}%` }} />
                    <div className="seg-b" style={{ flex: 1 }} />
                  </div>
                  <div className="lbl">{m.m.slice(5)}/{m.m.slice(2, 4)}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>מאיפה הכסף מגיע (מתחילת השנה)</h3>
            <div className="bars">
              {data.bySource.map((s) => (
                <div className="bar-row" key={s.source}><SourceBadge s={s.source} label={SOURCE_LABELS[s.source] || s.source} /><div className="bar-track"><div className="bar-fill" style={{ width: `${(Number(s.total) / maxSrc) * 100}%` }} /></div><span className="num">{money(s.total)}</span></div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>לפי מוסד</h3>
            <div className="bars">
              {data.byInstitution.map((s) => (
                <div className="bar-row" key={s.name}><span>{s.name}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(Number(s.total) / maxInst) * 100}%`, background: s.color || 'var(--primary)' }} /></div><span className="num">{money(s.total)}</span></div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>תרומות גבוהות אחרונות - לשיחת תודה</h3>
            {data.large.map((t) => (
              <div key={t.id} className="large-row">
                <Link to={`/app/donors/${t.donor_id}`}>{t.donor}</Link>
                <span className="num muted small">{date(t.date)}</span>
                <b className="num">{money(t.amount_ils)}</b>
                <Link className="btn sm" to={`/app/donors/${t.donor_id}`} title="לכרטיס התורם לשיחת תודה"><Icon name="phone" size={16} /></Link>
              </div>
            ))}
            {!data.large.length && <div className="muted">אין</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const ROUTES = [
  ['/app', Dashboard],
  ['/app/donors', () => <ResourcePage res="donors" />],
  ['/app/donors/duplicates', DuplicatesPage],
  ['/app/donors/:id', DonorCard],
  ['/app/transactions', TransactionsPage],
  ['/app/keva', KevaPage],
  ['/app/documents', DocumentsPage],
  ['/app/calls', CallsPage],
  ['/app/field', FieldPage],
  ['/app/calendar', CalendarPage],
  ['/app/messages', MessagesPage],
  ['/app/reports', ReportsPage],
  ['/app/masav', MasavPage],
  ['/app/settlements', SettlementsPage],
  ['/app/events/:id', EventPage],
  ['/app/r/:res', ({ params }) => <ResourcePage res={params.res} />],
  ['/app/users', UsersPage],
  ['/app/audit', AuditPage],
  ['/app/settings', SettingsPage],
  ['/app/profile', ProfilePage],
  ['/app/dev', DevPage],
  ['/app/help', HelpPage],
  ['/app/inbox', InboxPage],
];

export function AppShell({ site }) {
  const { path } = useRoute();
  const [me, setMe] = useState(null);
  const [meta, setMeta] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(() => { try { return localStorage.getItem('oy_demo') || ''; } catch { return ''; } });
  const [counts, setCounts] = useState({});
  const [liveTick, setLiveTick] = useState(0);
  const loadMe = () => api('/auth/me').then((d) => { if (!d.user) { navigate('/login', { replace: true }); return; } setPerms(d.perms); setMe(d); });
  useEffect(() => { loadMe(); }, []);
  useEffect(() => { if (me?.user) api('/meta').then(setMeta).catch(() => {}); }, [me?.user?.active_role]);
  useEffect(() => {
    if (!me?.user) return;
    Promise.all([api('/dashboard').catch(() => ({})), api('/inbox').catch(() => ({}))]).then(([d, ib]) => setCounts({ tasks: d.tasks?.c, boxes: d.boxesDue?.c, aid: d.aidOpen?.c, contact: d.contactOpen?.c, spiritual: d.spiritualPending?.c, inbox: ib.unread }));
  }, [me?.user?.active_role, path, liveTick]);
  useEffect(() => { const on = () => setLiveTick((t) => t + 1); window.addEventListener('oy:refresh', on); return () => window.removeEventListener('oy:refresh', on); }, []);
  useEffect(() => setSideOpen(false), [path]);
  useEffect(() => { try { localStorage.setItem('oy_demo', demoMode); } catch { /* */ } }, [demoMode]);
  if (!me?.user || !meta) return <Spinner />;
  const user = me.user;
  const switchRole = async (role) => { await api('/auth/role', { method: 'POST', body: { role } }); window.location.href = '/app'; };
  let Page = null; let params = {};
  for (const [pattern, Comp] of ROUTES) { const m = matchPath(pattern, path); if (m) { Page = Comp; params = m; break; } }
  const items = MENU.filter((m) => m.grp || can(user, m.perm));
  const visible = items.filter((m, i) => !m.grp || (items[i + 1] && !items[i + 1].grp));
  const bottom = (BOTTOM_BY_ROLE[user.active_role] || BOTTOM_DEFAULT).map((to) => MENU_BY[to]).filter((m) => m && can(user, m.perm)).slice(0, 4);
  const org = site.org;
  return (
    <AppCtx.Provider value={{ user, meta, demoMode, reloadMe: loadMe, org }}>
      {site.env?.show_banner && <div className="env-bar">סביבת פיתוח{site.env.sandbox ? ' - כל החיבורים במצב הדמיה (Sandbox)' : ''}</div>}
      {me.impersonator && <div className="imp-bar">מצב התחזות: מחובר כ{user.name} (על ידי {me.impersonator.name}) - כל פעולה נרשמת ביומן<button className="btn sm" onClick={async () => { await api('/auth/impersonate-stop', { method: 'POST' }); window.location.href = '/app/users'; }}>סיום התחזות</button></div>}
      <div className="app">
        {sideOpen && <div className="side-bg" onClick={() => setSideOpen(false)} aria-hidden="true" />}
        <aside className={`side ${sideOpen ? 'open' : ''}`}>
          <div className="brand"><span className="logo-chip"><Logo src={org.logo_url} alt="אור יקר" /></span><div><b>{org.short_name}</b><span className="small">ניהול תורמים וגיוס</span></div></div>
          <nav>
            {visible.map((m, i) => m.grp ? <div className="grp" key={i}>{m.grp}</div> : (
              <Link key={m.to} to={m.to}><Icon name={m.icon} size={19} />{m.label}{m.dev && <span className="dev-tag">מתכנת</span>}{m.badge && counts[m.badge] ? <span className="badge">{counts[m.badge]}</span> : null}</Link>
            ))}
          </nav>
          <div style={{ padding: 10 }}><ViewToggle /><Link to="/" className="small" style={{ color: '#9fb0d3' }}>← לאתר הציבורי</Link></div>
        </aside>
        <div className="main">
          <div className="topbar">
            <button className="btn ghost icon burger" onClick={() => setSideOpen(!sideOpen)} aria-label="תפריט"><Icon name="menu" /></button>
            <div className="grow" />
            {(user.roles.includes('developer') || user.roles.includes('manager')) && (
              <select className="input" style={{ width: 'auto', minHeight: 34 }} value={demoMode} onChange={(e) => setDemoMode(e.target.value)} title="סינון נתוני דוגמה">
                <option value="">כל הנתונים</option><option value="hide">בלי נתוני דוגמה</option><option value="only">רק נתוני דוגמה</option>
              </select>
            )}
            {(user.view_roles || user.roles).length > 1 && (
              <select className="input" style={{ width: 'auto', minHeight: 34 }} value={user.active_role} onChange={(e) => switchRole(e.target.value)} title="מעבר בין תצוגות">
                {(user.view_roles || user.roles).map((r) => <option key={r} value={r}>תצוגת {me.roles[r]?.label}</option>)}
              </select>
            )}
            <GlobalSearch />
            <Notifications />
            <Link to="/app/profile" className="btn ghost sm topbar-name">{user.name}</Link>
            <button className="btn sm" onClick={async () => { await api('/auth/logout', { method: 'POST' }); window.location.href = '/login'; }}>יציאה</button>
          </div>
          <div className="content">{Page ? <Page params={params} /> : <div className="empty">העמוד לא נמצא</div>}</div>
        </div>
      </div>
      <nav className="bottom-nav">
        {bottom.map((m) => <Link key={m.to} to={m.to}><span className="bn-ico"><Icon name={m.icon} size={22} />{m.badge && counts[m.badge] ? <i className="bn-badge">{counts[m.badge]}</i> : null}</span>{m.short || m.label}</Link>)}
        <a href="#" onClick={(e) => { e.preventDefault(); setSideOpen(true); }}><span className="bn-ico"><Icon name="menu" size={22} /></span>עוד</a>
      </nav>
      <QuickActions user={user} meta={meta} />
      <LiveUpdates />
      {user.must_change_pin && !me.impersonator && <ForcePin onDone={loadMe} />}
      {!user.must_change_pin && !me.impersonator && <InstallPrompt user={user} />}
    </AppCtx.Provider>
  );
}
