// שרת מוסדות אור יקר צפת: אתר ציבורי + מערכת ניהול תורמים וגיוס משאבים.
// ללא תלויות זמן ריצה מלבד pg (ב-Replit). הצד הלקוח נבנה מראש לתיקיית public.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, HttpError, makeContext, readBody } from './lib/router.js';
import { migrate, one, query } from './lib/db.js';
import { setSecretKey, hashPin, normalizePhone, randomToken } from './lib/security.js';
import { loadSession, registerAuthRoutes } from './auth.js';
import { registerCrudRoutes } from './routes/crud.js';
import { registerFinanceRoutes } from './routes/finance.js';
import { registerSystemRoutes } from './routes/system.js';
import { ensureDefaults } from './settings.js';
import { runDailyAutomations } from './automations.js';
import { envInfo } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 5000;

if (!process.env.SESSION_SECRET) {
  console.warn('[security] SESSION_SECRET לא הוגדר - נעשה שימוש במפתח זמני. יש להגדיר ב-Secrets לפני שימוש אמיתי');
}
setSecretKey(process.env.SESSION_SECRET || 'dev-only-insecure-secret');

const router = new Router();
registerAuthRoutes(router);
registerCrudRoutes(router);
registerFinanceRoutes(router);
registerSystemRoutes(router);
router.get('/api/health', async (ctx) => ctx.json(200, { ok: true, ...envInfo() }));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// הגבלת קצב פשוטה לנקודות רגישות
const hits = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > limit;
}

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) return false;
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file);
    const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
    return true;
  }
  file = path.join(PUBLIC, 'index.html');
  if (fs.existsSync(file)) {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const ctx = makeContext(req, res);
  const { pathname } = ctx.url;
  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (!serveStatic(req, res, pathname)) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('האתר בבנייה - יש להריץ npm run build'); }
    return;
  }
  try {
    const match = router.match(req.method, pathname);
    if (!match) throw new HttpError(404, 'נתיב לא קיים');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      // הגנת CSRF: בקשות שינוי חייבות להגיע מאותו מקור (מלבד Webhooks)
      const origin = req.headers.origin;
      if (origin && !pathname.startsWith('/api/webhooks/')) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (new URL(origin).host !== host) throw new HttpError(403, 'מקור הבקשה אינו מורשה');
      }
      if (/\/api\/(auth\/login|donor\/otp|donor\/login|public\/)/.test(pathname) && rateLimited(`${ctx.ip}:${pathname}`, 20, 10 * 60 * 1000)) {
        throw new HttpError(429, 'יותר מדי בקשות. נסו שוב בעוד כמה דקות');
      }
      ctx.body = await readBody(req);
    }
    ctx.params = match.params;
    await loadSession(ctx);
    for (const h of match.route.handlers) await h(ctx);
    if (!res.headersSent) ctx.json(204, {});
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(`[${req.method} ${pathname}]`, e);
    const errId = status >= 500 ? `E-${Date.now().toString(36)}` : undefined;
    ctx.json(status, { error: status >= 500 ? `שגיאת שרת (${errId}). הפרטים נשמרו ביומן השרת` : e.message, ...(e.extra || {}) });
  }
});

// יצירת חשבון המתכנת הראשון אם אין משתמשים כלל
async function bootstrapOwner() {
  const c = await one('SELECT COUNT(*)::int AS c FROM users');
  if (c.c > 0) return;
  const phone = normalizePhone(process.env.OWNER_PHONE || '0500000000');
  const pin = process.env.OWNER_PIN || String(Math.floor(100000 + Math.random() * 900000));
  await query("INSERT INTO users (name, phone, roles, pin_hash, must_change_pin, is_owner) VALUES ($1,$2,'{developer,manager}',$3,TRUE,TRUE)",
    [process.env.OWNER_NAME || 'מתכנת ראשי', phone, hashPin(pin)]);
  console.log('==============================================');
  console.log(' נוצר חשבון מתכנת ראשון');
  console.log(` טלפון: ${phone}`);
  console.log(` קוד זמני: ${pin}  (יש להחליף בכניסה הראשונה)`);
  console.log('==============================================');
}

async function seedInstitutions() {
  const c = await one('SELECT COUNT(*)::int AS c FROM institutions');
  if (c.c > 0) return;
  const list = [['ישיבה לבחורים', '#16357a'], ['כולל אברכים מצויינים', '#2b6cb0'], ['מדרשה לבנות נוה הדסה', '#9b2c6f'], ['חדר סופרים ומכון סת"ם', '#7b5e17'], ['מרכז הסיוע', '#2f855a'], ['אחוזת קורדוברו', '#975a16']];
  for (const [i, [name, color]] of list.entries()) await query('INSERT INTO institutions (name, color, sort) VALUES ($1,$2,$3)', [name, color, i]);
}

async function start() {
  await migrate();
  await ensureDefaults();
  await seedInstitutions();
  await bootstrapOwner();
  server.listen(PORT, '0.0.0.0', () => console.log(`[or-yakar] פועל על פורט ${PORT} | ${envInfo().label}`));
  // אוטומציות יומיות (בדיקה כל שעה, ריצה פעם ביום)
  let lastRun = '';
  setInterval(async () => {
    const day = new Date().toISOString().slice(0, 10);
    if (day === lastRun || new Date().getHours() < 7) return;
    lastRun = day;
    try { console.log('[automations]', await runDailyAutomations()); } catch (e) { console.error('[automations]', e.message); }
  }, 60 * 60 * 1000);
}

start().catch((e) => {
  console.error('הפעלת השרת נכשלה:', e);
  process.exit(1);
});

export { randomToken };
