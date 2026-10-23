import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { RouterProvider, useRoute, api, Toasts, Spinner } from './lib.jsx';
import { PublicSite } from './site.jsx';
import { AppShell, Login } from './app.jsx';

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
      const icon = document.querySelector('link[rel=icon]');
      if (icon && d.org.icon_url) icon.href = d.org.icon_url;
    }).catch(setErr);
  }, []);
  if (err) return <div className="empty">לא ניתן לטעון את האתר כרגע. נסו לרענן.</div>;
  if (!site) return <Spinner />;
  if (path === '/login') { document.title = `כניסה - ${site.org.short_name}`; return <Login org={site.org} />; }
  if (path.startsWith('/app')) { document.title = `מערכת - ${site.org.short_name}`; return <AppShell site={site} />; }
  return <PublicSite data={site} />;
}

createRoot(document.getElementById('root')).render(
  <RouterProvider>
    <Root />
    <Toasts />
  </RouterProvider>,
);
