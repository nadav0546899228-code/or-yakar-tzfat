import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { RouterProvider, useRoute, api, Toasts, Spinner, UpdateBanner } from './lib.jsx';
import { PublicSite } from './site.jsx';
import { AppShell, Login } from './app.jsx';
import { applyViewMode } from './inbox.jsx';

applyViewMode();

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
  const [site, setSite] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api('/public/site').then((d) => {
      setSite(d);
      applyTheme(d.theme);
    }).catch(setErr);
  }, []);
  if (err) return <div className="empty">לא ניתן לטעון את האתר כרגע. נסו לרענן.<div className="small muted" style={{ marginTop: 8 }}>{err.message}</div></div>;
  if (!site) return <Spinner />;
  if (path === '/login') { document.title = `כניסה - ${site.org.short_name}`; return <Login org={site.org} />; }
  if (path.startsWith('/app')) { document.title = `מערכת - ${site.org.short_name}`; return <AppShell site={site} />; }
  return <PublicSite data={site} />;
}

createRoot(document.getElementById('root')).render(
  <RouterProvider>
    <Root />
    <Toasts />
    <UpdateBanner />
  </RouterProvider>,
);
