import React, { useState, useEffect } from 'react';
import { Link, useRoute, api, toast, navigate, money, date, datetime, Logo, Field, Modal, AppCtx, useApi, matchPath, Spinner, qs } from './lib.jsx';
import { SOURCE_LABELS } from './labels.js';
import { ResourcePage, DonorCard, TransactionsPage, KevaPage, DocumentsPage } from './crm.jsx';
import { CallsPage, FieldPage, CalendarPage, EventPage, MessagesPage, ReportsPage, MasavPage, DuplicatesPage } from './ops.jsx';
import { DevPage, UsersPage, AuditPage, ProfilePage, SettingsPage } from './dev.jsx';
import { SettlementsPage } from './settlements.jsx';
import { InstallPrompt, HelpPage } from './onboarding.jsx';

// תפריט לפי הרשאה. perm = המפתח בשרת (roles.js)
const MENU = [
  { grp: 'ראשי' },
  { to: '/app', label: 'לוח בקרה', icon: '◧', perm: 'staff' },
  { to: '/app/donors', label: 'תורמים', icon: '👥', perm: 'donors.read' },
  { to: '/app/transactions', label: 'יומן תנועות מאוחד', icon: '₪', perm: 'tx.read' },
  { to: '/app/keva', label: 'הוראות קבע', icon: '↻', perm: 'keva.read' },
  { to: '/app/documents', label: 'קבלות ומסמכים', icon: '🧾', perm: 'docs.read' },
  { grp: 'גיוס ושימור' },
  { to: '/app/calls', label: 'מוקד טלפוני', icon: '☎', perm: 'calls.read', badge: 'tasks' },
  { to: '/app/field', label: 'אפליקציית שטח', short: 'שטח', icon: '📱', perm: 'field.use' },
  { to: '/app/calendar', label: 'לוח שנה עברי', icon: '📅', perm: 'donors.read' },
  { to: '/app/messages', label: 'פילוח ותפוצה', icon: '✉', perm: 'messages.send' },
  { to: '/app/r/pledges', label: 'התחייבויות ונדרים', icon: '✍', perm: 'tx.read' },
  { to: '/app/r/tzedaka_boxes', label: 'קופות צדקה', icon: '🪙', perm: 'boxes.read', badge: 'boxes' },
  { grp: 'קמפיינים ואירועים' },
  { to: '/app/r/campaigns', label: 'קמפיינים', icon: '⚑', perm: 'staff' },
  { to: '/app/r/spiritual_orders', label: 'מבצעים רוחניים', icon: '🕯', perm: 'spiritual.read', badge: 'spiritual' },
  { to: '/app/r/events', label: 'אירועים ודינרים', icon: '★', perm: 'events.read' },
  { to: '/app/r/aid_requests', label: 'מרכז הסיוע', icon: '♥', perm: 'aid.read', badge: 'aid' },
  { grp: 'בקרה' },
  { to: '/app/reports', label: 'מרכז דוחות', icon: '📊', perm: 'reports.read' },
  { to: '/app/masav', label: 'מס"ב והחזרות', icon: '🏦', perm: 'keva.actions' },
  { to: '/app/settlements', label: 'זיכויי חברות אשראי', icon: '💳', perm: 'settlements.read' },
  { to: '/app/r/contact_messages', label: 'פניות מהאתר', icon: '📥', perm: 'messages.send', badge: 'contact' },
  { grp: 'הגדרות' },
  { to: '/app/r/institutions', label: 'מוסדות ומטרות', icon: '🏛', perm: 'campaigns.write' },
  { to: '/app/r/automations', label: 'אוטומציות', icon: '⚡', perm: 'automations.write' },
  { to: '/app/r/materials', label: 'חומרים לתורמים', icon: '📎', perm: 'automations.write' },
  { to: '/app/users', label: 'משתמשים והרשאות', icon: '🔑', perm: 'users.manage' },
  { to: '/app/settings', label: 'הגדרות העמותה', icon: '⚙', perm: 'settings.org' },
  { to: '/app/audit', label: 'יומן פעולות', icon: '📜', perm: 'audit.read' },
  { to: '/app/dev', label: 'מסך המתכנת', icon: '</>', perm: 'dev.only', dev: true },
  { grp: 'עזרה' },
  { to: '/app/help', label: 'מדריך שימוש והתקנה', icon: '❓', perm: 'staff' },
];

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
      {open && (
        <div className="card" style={{ position: 'absolute', left: 0, top: '110%', width: 340, maxHeight: 420, overflowY: 'auto', zIndex: 60, padding: 10 }}>
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

function Dashboard() {
  const { user, demoMode } = React.useContext(AppCtx);
  const { data, loading } = useApi(`/dashboard${qs({ demo: demoMode })}`);
  if (loading || !data) return <Spinner />;
  const maxMonth = Math.max(1, ...(data.monthly || []).map((m) => Number(m.total)));
  const maxSrc = Math.max(1, ...(data.bySource || []).map((s) => Number(s.total)));
  const maxInst = Math.max(1, ...(data.byInstitution || []).map((s) => Number(s.total)));
  const go = (to) => () => navigate(to);
  return (
    <div className="stack">
      <div className="page-head"><h1>שלום {user.name.split(' ')[0]}</h1><span className="muted">{new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      {data.finance && (
        <>
          <div className="kpis">
            <div className="kpi"><div className="label">היום</div><div className="value num">{money(data.totals.today)}</div></div>
            <div className="kpi link" onClick={go('/app/transactions')}><div className="label">החודש ({data.totals.month_count} תרומות)</div><div className="value num">{money(data.totals.month)}</div></div>
            <div className="kpi"><div className="label">מתחילת השנה</div><div className="value num">{money(data.totals.year)}</div></div>
            <div className="kpi link" onClick={go('/app/keva')}><div className="label">הו"ק פעילות · צפי חודשי</div><div className="value num">{data.keva.active} · {money(data.keva.monthly)}</div></div>
            <div className={`kpi link ${data.failed.c ? 'alert' : ''}`} onClick={go('/app/transactions?status=failed')}><div className="label">חיובים שנכשלו (30 יום)</div><div className="value num">{data.failed.c}</div></div>
            <div className={`kpi link ${data.kevaChurn.c ? 'warn' : ''}`} onClick={go('/app/keva?churn=true')}><div className="label">הו"ק שבוטלו / הסתיימו (30 יום)</div><div className="value num">{data.kevaChurn.c}</div></div>
            <div className={`kpi link ${data.noDocument.c ? 'warn' : ''}`} onClick={go('/app/transactions?no_document=true')}><div className="label">תרומות ללא קבלה (השנה)</div><div className="value num">{data.noDocument.c}</div></div>
            <div className={`kpi link ${data.notReported.c ? 'alert' : ''}`} onClick={go('/app/documents?tax_report_status=pending')}><div className="label">קבלות 46 שלא דווחו לרשות המסים</div><div className="value num">{data.notReported.c}</div></div>
            {data.pendingApproval.c > 0 && <div className="kpi link warn" onClick={go('/app/transactions?pending_approval=true')}><div className="label">מזומן / צ׳קים לאישור גזבר</div><div className="value num">{data.pendingApproval.c}</div></div>}
          </div>
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
                  <div className="bar-row" key={s.source}><span>{SOURCE_LABELS[s.source] || s.source}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(Number(s.total) / maxSrc) * 100}%` }} /></div><span className="num">{money(s.total)}</span></div>
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
              {data.large.map((t) => <div key={t.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}><Link to={`/app/donors/${t.donor_id}`}>{t.donor}</Link><span className="num"><b>{money(t.amount_ils)}</b> · {date(t.date)}</span></div>)}
              {!data.large.length && <div className="muted">אין</div>}
            </div>
          </div>
        </>
      )}
      <div className="kpis">
        <div className="kpi link" onClick={go('/app/calls')}><div className="label">שיחות בתור</div><div className="value">{data.tasks.c}</div></div>
        <div className="kpi link" onClick={go('/app/r/pledges')}><div className="label">התחייבויות פתוחות</div><div className="value num">{data.openPledges.c} · {money(data.openPledges.total)}</div></div>
        <div className={`kpi link ${data.boxesDue.c ? 'warn' : ''}`} onClick={go('/app/r/tzedaka_boxes')}><div className="label">קופות לאיסוף</div><div className="value">{data.boxesDue.c}</div></div>
        <div className="kpi link" onClick={go('/app/r/spiritual_orders?f_status=pending')}><div className="label">שמות לתפילה ממתינים</div><div className="value">{data.spiritualPending.c}</div></div>
        <div className="kpi link" onClick={go('/app/r/aid_requests')}><div className="label">בקשות סיוע פתוחות</div><div className="value">{data.aidOpen.c}</div></div>
        <div className="kpi link" onClick={go('/app/r/contact_messages')}><div className="label">פניות מהאתר</div><div className="value">{data.contactOpen.c}</div></div>
      </div>
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
];

export function AppShell({ site }) {
  const { path } = useRoute();
  const [me, setMe] = useState(null);
  const [meta, setMeta] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(() => { try { return localStorage.getItem('oy_demo') || ''; } catch { return ''; } });
  const [counts, setCounts] = useState({});
  const loadMe = () => api('/auth/me').then((d) => { if (!d.user) { navigate('/login', { replace: true }); return; } setPerms(d.perms); setMe(d); });
  useEffect(() => { loadMe(); }, []);
  useEffect(() => { if (me?.user) api('/meta').then(setMeta).catch(() => {}); }, [me?.user?.active_role]);
  useEffect(() => {
    if (!me?.user) return;
    api('/dashboard').then((d) => setCounts({ tasks: d.tasks?.c, boxes: d.boxesDue?.c, aid: d.aidOpen?.c, contact: d.contactOpen?.c, spiritual: d.spiritualPending?.c })).catch(() => {});
  }, [me?.user?.active_role, path]);
  useEffect(() => setSideOpen(false), [path]);
  useEffect(() => { try { localStorage.setItem('oy_demo', demoMode); } catch { /* */ } }, [demoMode]);
  if (!me?.user || !meta) return <Spinner />;
  const user = me.user;
  const switchRole = async (role) => { await api('/auth/role', { method: 'POST', body: { role } }); window.location.href = '/app'; };
  let Page = null; let params = {};
  for (const [pattern, Comp] of ROUTES) { const m = matchPath(pattern, path); if (m) { Page = Comp; params = m; break; } }
  const items = MENU.filter((m) => m.grp || can(user, m.perm));
  const visible = items.filter((m, i) => !m.grp || (items[i + 1] && !items[i + 1].grp));
  const bottom = [MENU[1], MENU[2], MENU[7], MENU[8], MENU[3]].filter((m) => can(user, m.perm)).slice(0, 4);
  const org = site.org;
  return (
    <AppCtx.Provider value={{ user, meta, demoMode, reloadMe: loadMe, org }}>
      {site.env?.show_banner && <div className="env-bar">סביבת פיתוח{site.env.sandbox ? ' - כל החיבורים במצב הדמיה (Sandbox)' : ''}</div>}
      {me.impersonator && <div className="imp-bar">מצב התחזות: מחובר כ{user.name} (על ידי {me.impersonator.name}) - כל פעולה נרשמת ביומן<button className="btn sm" onClick={async () => { await api('/auth/impersonate-stop', { method: 'POST' }); window.location.href = '/app/users'; }}>סיום התחזות</button></div>}
      <div className="app">
        <aside className={`side ${sideOpen ? 'open' : ''}`}>
          <div className="brand"><span className="logo-chip"><Logo src={org.logo_url} alt="אור יקר" /></span><div><b>{org.short_name}</b><span className="small">ניהול תורמים וגיוס</span></div></div>
          <nav>
            {visible.map((m, i) => m.grp ? <div className="grp" key={i}>{m.grp}</div> : (
              <Link key={m.to} to={m.to}><span style={{ width: 20, textAlign: 'center' }}>{m.icon}</span>{m.label}{m.dev && <span className="dev-tag">מתכנת</span>}{m.badge && counts[m.badge] ? <span className="badge">{counts[m.badge]}</span> : null}</Link>
            ))}
          </nav>
          <div style={{ padding: 10 }}><Link to="/" className="small" style={{ color: '#9fb0d3' }}>← לאתר הציבורי</Link></div>
        </aside>
        <div className="main">
          <div className="topbar">
            <button className="btn ghost icon burger" onClick={() => setSideOpen(!sideOpen)} aria-label="תפריט">☰</button>
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
            <Notifications />
            <Link to="/app/profile" className="btn ghost sm topbar-name">{user.name}</Link>
            <button className="btn sm" onClick={async () => { await api('/auth/logout', { method: 'POST' }); window.location.href = '/login'; }}>יציאה</button>
          </div>
          <div className="content">{Page ? <Page params={params} /> : <div className="empty">העמוד לא נמצא</div>}</div>
        </div>
      </div>
      <nav className="bottom-nav">
        {bottom.map((m) => <Link key={m.to} to={m.to}><span style={{ fontSize: 18 }}>{m.icon}</span>{m.short || m.label.split(' ')[0]}</Link>)}
        <a href="#" onClick={(e) => { e.preventDefault(); setSideOpen(true); }}><span style={{ fontSize: 18 }}>☰</span>עוד</a>
      </nav>
      {user.must_change_pin && !me.impersonator && <ForcePin onDone={loadMe} />}
      {!user.must_change_pin && !me.impersonator && <InstallPrompt user={user} />}
    </AppCtx.Provider>
  );
}
