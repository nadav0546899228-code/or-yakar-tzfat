import React, { useEffect, useState, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { RouterProvider, useRoute, api, Toasts, Spinner, UpdateBanner } from './lib.jsx';
import { PublicSite } from './site.jsx';

// המערכת, לוח המודעות ודף הקמפיין נטענים רק כשנכנסים אליהם - האתר הציבורי נשאר קל ומהיר
// אם עלתה גרסה חדשה בזמן שהדף פתוח, קובץ הקוד הישן כבר לא קיים - טוענים מחדש פעם אחת
function lazyPart(loader, name) {
  return lazy(() => loader().then((m) => {
    try { sessionStorage.removeItem('oy_chunk_reload'); } catch { /* */ }
    return { default: m[name] };
  }).catch((e) => {
    let tried = false;
    try { tried = sessionStorage.getItem('oy_chunk_reload') === '1'; sessionStorage.setItem('oy_chunk_reload', '1'); } catch { /* */ }
    if (!tried) { window.location.reload(); return new Promise(() => {}); }
    throw e;
  }));
}
const AppShell = lazyPart(() => import('./app.jsx'), 'AppShell');
const Login = lazyPart(() => import('./app.jsx'), 'Login');
const BoardScreen = lazyPart(() => import('./community.jsx'), 'BoardScreen');
const CampaignPage = lazyPart(() => import('./community.jsx'), 'CampaignPage');

// תצוגת מחשב/טלפון שנבחרה (בלי לטעון את קוד המערכת)
(function applyViewMode() {
  let mode = '';
  try { mode = localStorage.getItem('oy_view') || ''; } catch { /* */ }
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta && mode === 'desktop') meta.setAttribute('content', 'width=1280');
}());

// נתוני האתר מוטמעים בדף עצמו על ידי השרת - חוסך סבב טעינה שלם בכניסה
function inlineSite() {
  try {
    const el = document.getElementById('site-data');
    return el ? JSON.parse(el.textContent) : null;
  } catch { return null; }
}

// דיווח שגיאות דפדפן לשרת (לדוח המצב)
let reported = 0;
function reportError(message, stack) {
  if (reported++ > 10) return;
  try {
    fetch('/api/diag/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: String(message).slice(0, 500), stack: String(stack || '').slice(0, 2000), url: window.location.pathname }) });
  } catch { /* */ }
}
window.addEventListener('error', (e) => { if (e.message) reportError(e.message, e.error?.stack); });
window.addEventListener('unhandledrejection', (e) => reportError(e.reason?.message || String(e.reason), e.reason?.stack));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

function applyTheme(theme) {
  if (!theme) return;
  const r = document.documentElement.style;
  r.setProperty('--primary', theme.primary);
  r.setProperty('--primary-dark', theme.primary_dark);
  r.setProperty('--accent', theme.accent);
  r.setProperty('--sky', theme.sky);
  r.setProperty('--ink', theme.ink);
}

function Root() {
  const { path } = useRoute();
  const [site, setSite] = useState(() => {
    const d = inlineSite();
    if (d) applyTheme(d.theme);
    return d;
  });
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (site) return;
    api('/public/site').then((d) => {
      setSite(d);
      applyTheme(d.theme);
    }).catch(setErr);
  }, []);
  // מסכים ציבוריים מיוחדים: לוח מודעות לטלוויזיה ודף קמפיין
  const bm = path.match(/^\/board\/([\w-]+)\/?$/);
  if (bm) return <Suspense fallback={<Spinner />}><BoardScreen slug={bm[1]} /></Suspense>;
  const cm = path.match(/^\/c\/([\w-]+)(?:\/([\w-]+))?\/?$/);
  if (cm) return <Suspense fallback={<Spinner />}><CampaignPage slug={cm[1]} team={cm[2]} /></Suspense>;
  if (err) return <div className="empty">לא ניתן לטעון את האתר כרגע. נסו לרענן.<div className="small muted" style={{ marginTop: 8 }}>{err.message}</div></div>;
  if (!site) return <Spinner />;
  if (path === '/login') { document.title = `כניסה - ${site.org.short_name}`; return <Suspense fallback={<Spinner />}><Login org={site.org} /></Suspense>; }
  if (path.startsWith('/app')) { document.title = `מערכת - ${site.org.short_name}`; return <Suspense fallback={<Spinner />}><AppShell site={site} /></Suspense>; }
  return <PublicSite data={site} />;
}

createRoot(document.getElementById('root')).render(
  <RouterProvider>
    <Root />
    <Toasts />
    {!window.location.pathname.startsWith('/board/') && <UpdateBanner />}
  </RouterProvider>,
);
