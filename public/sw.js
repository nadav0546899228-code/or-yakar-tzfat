// Service Worker מינימלי - מאפשר התקנה כאפליקציה. לא שומר נתונים במטמון (תמיד מהרשת), חוץ מדף גיבוי לניתוק.
const OFFLINE = '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>אין חיבור</title><body style="font-family:system-ui;text-align:center;padding:60px 20px;color:#14213d"><h2>אין חיבור לאינטרנט</h2><p>בדקו את החיבור ונסו שוב.</p><button onclick="location.reload()" style="padding:10px 20px;border-radius:10px;border:0;background:#16357a;color:#fff;font-size:16px">נסו שוב</button></body></html>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
