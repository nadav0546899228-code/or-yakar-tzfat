// עזרי בדיקות רגרסיה: מסד זמני, הרמת השרת כתהליך בן, ולקוח HTTP עם עוגיות.
// מצב ברירת מחדל (מבודד): יוצר מסד oy_test_<random>, מרים node server/index.js על פורט פנוי, ומוחק הכול בסוף.
// מצב חיצוני: TEST_BASE_URL=https://... (+ TEST_OWNER_PHONE / TEST_OWNER_PIN, ואופציונלית TEST_DATABASE_URL לבדיקות מסד).
//   שימו לב: במצב חיצוני הבדיקות יוצרות משתמשים, תורמים ותנועות אמיתיים במסד של אותו שרת - להריץ רק מול אתר פיתוח.
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_URL = process.env.TEST_PG_ADMIN_URL || 'postgresql://postgres@localhost:5433/postgres?host=/tmp';
const OVERALL_TIMEOUT_MS = Number(process.env.TEST_OVERALL_TIMEOUT_MS) || 5 * 60 * 1000;

export const EXTERNAL = !!process.env.TEST_BASE_URL;
export const OWNER_PHONE = process.env.TEST_OWNER_PHONE || '0500000000';
export const OWNER_TEMP_PIN = process.env.TEST_OWNER_PIN || '123456';
export const OWNER_PIN = process.env.TEST_OWNER_NEW_PIN || (EXTERNAL ? OWNER_TEMP_PIN : '246810');

const rnd = (n = 6) => crypto.randomBytes(n).toString('hex');
export const uniquePhone = () => `05${String(crypto.randomInt(10_000_000, 100_000_000))}`;
export const randomIp = () => `10.${crypto.randomInt(1, 255)}.${crypto.randomInt(1, 255)}.${crypto.randomInt(1, 255)}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** היום בישראל, YYYY-MM-DD - כמו israelDay() בשרת */
export const israelToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function withDb(url, db) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// ---------- לקוח HTTP עם עוגיות ----------
export class Client {
  constructor(base, { ip = randomIp() } = {}) {
    this.base = base.replace(/\/$/, '');
    this.jar = new Map();
    // כתובת IP שונה לכל לקוח: מגבלת הקצב לפי IP (20 ב-10 דקות) לא תחסום בדיקות שונות זו את זו
    this.ip = ip;
  }

  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }

  storeCookies(res) {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (!v || attrs.some((a) => /max-age=0\b/i.test(a.trim()))) this.jar.delete(k); else this.jar.set(k, v);
    }
  }

  async req(method, p, body, { headers = {} } = {}) {
    const h = { 'X-Forwarded-For': this.ip, ...headers };
    if (this.jar.size) h.Cookie = this.cookieHeader();
    let payload;
    if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.base + p, { method, headers: h, body: payload, redirect: 'manual' });
    this.storeCookies(res);
    const text = await res.text();
    let data = null;
    if ((res.headers.get('content-type') || '').includes('application/json') && text) {
      try { data = JSON.parse(text); } catch { /* נשאר טקסט */ }
    }
    return { status: res.status, headers: res.headers, data, text };
  }

  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b = {}, o) { return this.req('POST', p, b, o); }
  put(p, b = {}, o) { return this.req('PUT', p, b, o); }
  del(p, b, o) { return this.req('DELETE', p, b, o); }

  async login(phone, pin) { return this.post('/api/auth/login', { phone, pin }); }
}

/** בקשה גולמית (בלי פענוח דחיסה אוטומטי) - לבדיקת Content-Encoding של קבצים סטטיים */
export function rawGet(base, p, headers = {}) {
  const u = new URL(base + p);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const r = mod.get(u, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    r.on('error', reject);
    r.setTimeout(15000, () => r.destroy(new Error(`timeout ${p}`)));
  });
}

/** פתיחת זרם SSE: מחזיר פונקציה next(timeoutMs) שמחזירה את אירוע ה-data הבא (JSON), ו-close() */
export async function openSse(client, p = '/api/live/stream') {
  const ac = new AbortController();
  const res = await fetch(client.base + p, { headers: { Cookie: client.cookieHeader(), 'X-Forwarded-For': client.ip, Accept: 'text/event-stream' }, signal: ac.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const queue = [];
  let waiter = null;
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (!data) continue;
          queue.push(JSON.parse(data));
          if (waiter) { const w = waiter; waiter = null; w(); }
        }
      }
    } catch { /* נסגר */ }
  })();
  const next = async (timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (!queue.length) {
      const left = deadline - Date.now();
      if (left <= 0) return null;
      await Promise.race([new Promise((r) => { waiter = r; }), sleep(left)]);
    }
    return queue.shift();
  };
  return { status: res.status, headers: res.headers, next, close: () => ac.abort() };
}

// ---------- סביבת הבדיקה ----------
export class TestEnv {
  constructor() {
    this.base = null;
    this.child = null;
    this.dbName = null;
    this.pool = null;
    this.logs = [];
    this.cleaned = false;
    this.owner = null;
    this.setup = {};
  }

  /** שאילתה ישירה על מסד הבדיקה (null אם אין גישה למסד - מצב חיצוני בלי TEST_DATABASE_URL) */
  async sql(text, params = []) {
    if (!this.pool) return null;
    return (await this.pool.query(text, params)).rows;
  }

  get hasDb() { return !!this.pool; }

  async start() {
    this.watchdog = setTimeout(() => {
      console.error(`\n[tests] חריגה מזמן הריצה הכולל (${OVERALL_TIMEOUT_MS / 1000}s) - עוצרים`);
      this.cleanupSync();
      process.exit(1);
    }, OVERALL_TIMEOUT_MS);
    this.watchdog.unref();
    process.once('exit', () => this.cleanupSync());
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { this.cleanupSync(); process.exit(130); });

    if (EXTERNAL) {
      this.base = process.env.TEST_BASE_URL.replace(/\/$/, '');
      if (process.env.TEST_DATABASE_URL) this.pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 3 });
      await this.waitReady(30_000);
      return;
    }

    this.dbName = `oy_test_${rnd(5)}`;
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try { await admin.query(`CREATE DATABASE ${this.dbName}`); } finally { await admin.end(); }
    this.dbUrl = withDb(ADMIN_URL, this.dbName);
    this.pool = new pg.Pool({ connectionString: this.dbUrl, max: 3 });
    pg.types.setTypeParser(1082, (v) => v); // DATE כמחרוזת, כמו בשרת

    const port = await freePort();
    const env = { ...process.env };
    for (const k of ['REPLIT_DEPLOYMENT', 'PUBLISHED_SITE', 'APP_MODE', 'FORCE_SANDBOX', 'DEV_SHOW_OTP', 'OWNER_EMAIL', 'OWNER_NAME']) delete env[k];
    Object.assign(env, {
      PORT: String(port), DATABASE_URL: this.dbUrl, PGHOST: '/tmp',
      SESSION_SECRET: `test-secret-${rnd(24)}`, OWNER_PHONE, OWNER_PIN: OWNER_TEMP_PIN,
    });
    this.child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (d) => { for (const l of String(d).split('\n')) if (l.trim()) this.logs.push(l); if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400); };
    this.child.stdout.on('data', keep);
    this.child.stderr.on('data', keep);
    this.child.on('exit', (code, sig) => { this.childExit = { code, sig }; });
    this.base = `http://127.0.0.1:${port}`;
    await this.waitReady(60_000);
  }

  async waitReady(ms) {
    const until = Date.now() + ms;
    let last = null;
    while (Date.now() < until) {
      if (this.childExit) throw new Error(`השרת נסגר בעלייה (${JSON.stringify(this.childExit)}):\n${this.tail()}`);
      try {
        const r = await fetch(`${this.base}/api/health`);
        last = await r.json();
        if (last.db === 'ready') return last;
      } catch (e) { last = e.message; }
      await sleep(250);
    }
    throw new Error(`השרת לא הגיע למצב db=ready תוך ${ms}ms. אחרון: ${JSON.stringify(last)}\n${this.tail()}`);
  }

  tail(n = 40) { return this.logs.slice(-n).join('\n'); }

  client(opts) { return new Client(this.base, opts); }

  /** יצירת משתמש חדש (ע"י הבעלים), כניסה והחלפת הקוד הזמני. מחזיר { id, phone, pin, client } */
  async makeUser(roles, { name, login = true, extra = {} } = {}) {
    const phone = uniquePhone();
    const tempPin = String(crypto.randomInt(100000, 1000000));
    const r = await this.owner.post('/api/users', { name: name || `בדיקה ${roles.join('+')} ${rnd(2)}`, phone, roles, pin: tempPin, confirm_developer: true, ...extra });
    if (r.status !== 200) throw new Error(`יצירת משתמש נכשלה ${r.status}: ${r.text}`);
    const user = { id: r.data.id, phone, pin: tempPin, roles };
    if (!login) return user;
    const c = this.client();
    const l = await c.login(phone, tempPin);
    if (l.status !== 200) throw new Error(`כניסה נכשלה ${l.status}: ${l.text}`);
    const newPin = String(crypto.randomInt(100000, 1000000));
    const p = await c.post('/api/auth/profile', { pin: newPin });
    if (p.status !== 200) throw new Error(`החלפת קוד נכשלה ${p.status}: ${p.text}`);
    return { ...user, pin: newPin, client: c };
  }

  async stop() {
    if (this.cleaned) return;
    clearTimeout(this.watchdog);
    if (this.pool) { try { await this.pool.end(); } catch { /* */ } this.pool = null; }
    if (this.child && !this.childExit) {
      this.child.kill('SIGTERM');
      const exited = await Promise.race([new Promise((r) => this.child.once('exit', () => r(true))), sleep(3000).then(() => false)]);
      if (!exited) this.child.kill('SIGKILL');
    }
    if (this.dbName) {
      const admin = new pg.Client({ connectionString: ADMIN_URL });
      try {
        await admin.connect();
        await admin.query(`DROP DATABASE IF EXISTS ${this.dbName} WITH (FORCE)`);
      } catch (e) {
        console.error(`[tests] מחיקת המסד ${this.dbName} נכשלה: ${e.message}`);
      } finally { await admin.end().catch(() => {}); }
    }
    this.cleaned = true;
  }

  // גיבוי סינכרוני (יציאה פתאומית / חריגת זמן): הורגים את השרת ומוחקים את המסד דרך psql
  cleanupSync() {
    if (this.cleaned) return;
    this.cleaned = true;
    try { if (this.child && !this.childExit) this.child.kill('SIGKILL'); } catch { /* */ }
    if (this.dbName) spawnSync('psql', [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${this.dbName} WITH (FORCE)`], { stdio: 'ignore', timeout: 10000 });
  }
}
