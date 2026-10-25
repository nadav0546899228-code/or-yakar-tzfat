// שרת מוסדות אור יקר צפת: אתר ציבורי + מערכת ניהול תורמים וגיוס משאבים.
// ללא תלויות זמן ריצה מלבד pg (ב-Replit). הצד הלקוח נבנה מראש לתיקיית public.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, HttpError, makeContext, readBody } from './lib/router.js';
import { migrate, one, query, many } from './lib/db.js';
import { setSecretKey, hashPin, normalizePhone, randomToken, bankRef, parseBankRef } from './lib/security.js';
import { loadSession, registerAuthRoutes } from './auth.js';
import { registerCrudRoutes } from './routes/crud.js';
import { registerFinanceRoutes } from './routes/finance.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerDiagRoutes, logError } from './routes/diag.js';
import { registerSettlementRoutes } from './routes/settlements.js';
import { registerExtraRoutes } from './routes/extra.js';
import { ensureDefaults } from './settings.js';
import { runDailyAutomations } from './automations.js';
import { envInfo, isPublished } from './env.js';

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
registerDiagRoutes(router);

// ---------- עדכון חי: גרסת נתונים + התראות חדשות ----------
let liveVersion = Date.now();
export function bumpLive() { liveVersion += 1; }
router.get('/api/live', async (ctx) => {
  if (!ctx.user) { ctx.json(200, { v: liveVersion, notifs: [] }); return; }
  const since = Number(ctx.query?.since || 0);
  const notifs = since ? await many(`SELECT id, title, body, link, at FROM notifications
    WHERE id > $3 AND NOT ($1 = ANY(read_by)) AND (user_id = $1 OR $2 = ANY(roles) OR (user_id IS NULL AND cardinality(roles) = 0))
    ORDER BY id LIMIT 5`, [ctx.user.id, ctx.user.active_role, since]) : [];
  const last = (await one('SELECT COALESCE(MAX(id),0)::int AS m FROM notifications')).m;
  ctx.json(200, { v: liveVersion, last, notifs });
});
registerSettlementRoutes(router);
registerExtraRoutes(router);
process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e); logError({ source: 'server', path: 'unhandledRejection', message: e?.message || String(e), stack: e?.stack }); });
router.get('/api/health', async (ctx) => ctx.json(200, { ok: true, db: dbReady ? 'ready' : 'not_ready', db_error: dbError, has_database_url: !!process.env.DATABASE_URL, ...envInfo() }));

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

// באתר הפיתוח: סמלים, תמונת שיתוף ושם אפליקציה עם סימון "אתר פיתוח"
const DEV_ASSETS = { '/manifest.webmanifest': '/manifest-dev.webmanifest', '/og-image.png': '/og-image-dev.png',
  '/icon-180.png': '/icon-dev-180.png', '/icon-192.png': '/icon-dev-192.png', '/icon-512.png': '/icon-dev-512.png', '/icon-maskable-512.png': '/icon-dev-maskable-512.png' };
function siteOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return '';
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'http' && /^localhost|^127\./.test(host) ? 'http' : 'https';
  return `${proto}://${host}`;
}
let indexCache = null;
function sendIndex(req, res) {
  const file = path.join(PUBLIC, 'index.html');
  if (!fs.existsSync(file)) return false;
  const mtime = fs.statSync(file).mtimeMs;
  if (!indexCache || indexCache.mtime !== mtime) indexCache = { mtime, html: fs.readFileSync(file, 'utf8') };
  const html = indexCache.html.replaceAll('__ORIGIN__', siteOrigin(req));
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  res.end(html);
  return true;
}

function serveStatic(req, res, pathname) {
  if (!isPublished() && DEV_ASSETS[pathname]) pathname = DEV_ASSETS[pathname];
  if (pathname === '/' || pathname === '/index.html') return sendIndex(req, res);
  let file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) return false;
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file);
    const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
    return true;
  }
  return sendIndex(req, res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' https:",
    "connect-src 'self' https://accounts.google.com",
    "frame-src https://accounts.google.com https://maps.google.com https://www.google.com https://www.youtube.com https://www.youtube-nocookie.com",
    "frame-ancestors 'self' https://replit.com https://*.replit.com https://*.replit.dev",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  const ctx = makeContext(req, res);
  const { pathname } = ctx.url;
  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (!serveStatic(req, res, pathname)) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('האתר בבנייה - יש להריץ npm run build'); }
    return;
  }
  try {
    if (!dbReady && pathname !== '/api/health') {
      throw new HttpError(503, process.env.DATABASE_URL ? 'המערכת מתחברת למסד הנתונים, נסו שוב בעוד רגע' : 'לאתר זה עדיין לא הוגדר מסד נתונים (DATABASE_URL). יש ליצור מסד לאתר המפורסם ב-Replit');
    }
    const match = router.match(req.method, pathname);
    if (!match) throw new HttpError(404, 'נתיב לא קיים');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      // הגנת CSRF: בקשות שינוי חייבות להגיע מאותו מקור (מלבד Webhooks)
      const origin = req.headers.origin;
      if (origin && !pathname.startsWith('/api/webhooks/')) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (new URL(origin).host !== host) throw new HttpError(403, 'מקור הבקשה אינו מורשה');
      }
      if (/\/api\/(auth\/login|donor\/otp|donor\/login|public\/|diag\/client-error)/.test(pathname) && rateLimited(`${ctx.ip}:${pathname}`, 20, 10 * 60 * 1000)) {
        throw new HttpError(429, 'יותר מדי בקשות. נסו שוב בעוד כמה דקות');
      }
      ctx.body = await readBody(req);
    }
    ctx.params = match.params;
    await loadSession(ctx);
    for (const h of match.route.handlers) await h(ctx);
    if (!res.headersSent) ctx.json(204, {});
    // מונה שינויים: כל שינוי מוצלח מעלה גרסה, והמסכים הפתוחים מתרעננים לבד
    if (req.method !== 'GET' && !pathname.startsWith('/api/diag/client-error') && !pathname.startsWith('/api/notifications/read')) bumpLive();
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && status !== 503) {
      console.error(`[${req.method} ${pathname}]`, e);
      logError({ source: 'server', path: `${req.method} ${pathname}`, message: e.message, stack: e.stack, userId: ctx.user?.id || null });
    }
    const errId = status >= 500 && status !== 503 ? `E-${Date.now().toString(36)}` : undefined;
    ctx.json(status, { error: status >= 500 && status !== 503 ? `שגיאת שרת (${errId}). הפרטים נשמרו ביומן השרת` : e.message, ...(e.extra || {}) });
  }
});

// יצירת חשבון המתכנת הראשון אם אין משתמשים כלל
async function bootstrapOwner() {
  const c = await one('SELECT COUNT(*)::int AS c FROM users');
  if (c.c > 0) return;
  const phone = normalizePhone(process.env.OWNER_PHONE || '0500000000');
  const pin = process.env.OWNER_PIN || String(Math.floor(100000 + Math.random() * 900000));
  await query("INSERT INTO users (name, phone, email, roles, pin_hash, must_change_pin, is_owner) VALUES ($1,$2,$3,'{developer,manager}',$4,TRUE,TRUE)",
    [process.env.OWNER_NAME || 'מתכנת ראשי', phone, (process.env.OWNER_EMAIL || '').trim().toLowerCase() || null, hashPin(pin)]);
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

let dbReady = false;
let dbError = null;

async function encryptPlainBankRefs() {
  const rows = await many("SELECT id, token_ref FROM standing_orders WHERE token_ref LIKE 'BANK:%'");
  for (const r of rows) {
    const b = parseBankRef(r.token_ref);
    if (b) await query('UPDATE standing_orders SET token_ref = $2 WHERE id = $1', [r.id, bankRef(b.bank, b.branch, b.account)]);
  }
  if (rows.length) console.log(`[security] הוצפנו ${rows.length} פרטי חשבון בנק`);
}

async function initDb() {
  await migrate();
  await encryptPlainBankRefs();
  await ensureDefaults();
  await seedInstitutions();
  await bootstrapOwner();
}

async function start() {
  // השרת עולה מיד (כדי שהפרסום לא ייכשל), והמסד מאותחל ברקע עם ניסיונות חוזרים
  server.listen(PORT, '0.0.0.0', () => console.log(`[or-yakar] פועל על פורט ${PORT} | ${envInfo().label}`));
  for (let attempt = 1; !dbReady; attempt++) {
    try {
      await initDb();
      dbReady = true;
      dbError = null;
      console.log('[db] המסד מוכן');
    } catch (e) {
      dbError = e.message;
      console.error(`[db] ניסיון ${attempt} נכשל:`, e.message);
      await new Promise((r) => setTimeout(r, Math.min(30000, 3000 * attempt)));
    }
  }
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
