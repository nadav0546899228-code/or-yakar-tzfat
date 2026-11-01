// אחסון עצמי של תמונות האתר הציבורי: התמונות שמגיעות מהאתר הישן (וורדפרס) מועתקות למסד,
// והקישורים בהגדרות מוחלפים ל-/api/media/<id>. כך האתר לא תלוי בשרת הישן, והתמונות נטענות מהר עם מטמון ארוך.
// מפת המקור (media_map: כתובת מקורית -> מזהה) נשמרת בהגדרות, כדי שאפשר יהיה להריץ שוב או להחזיר לאחור.
import crypto from 'node:crypto';
import { one, query } from '../lib/db.js';
import { HttpError } from '../lib/router.js';
import { requirePerm } from '../auth.js';
import { audit } from '../audit.js';
import { getSetting, setSetting } from '../settings.js';

// הגדרות שבהן מחפשים תמונות חיצוניות
const SCAN_KEYS = ['org', 'site', 'theme'];
// שרתים שמהם מותר להעתיק (אפשר להוסיף ב-Secrets: MEDIA_IMPORT_HOSTS=a.co.il,b.co.il)
const ALLOWED_HOSTS = new Set([
  'or-yakar-blue.co.il', 'www.or-yakar-blue.co.il',
  ...String(process.env.MEDIA_IMPORT_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
]);
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const CONCURRENCY = 4;
const OK_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/avif']);
const URL_RE = /https?:\/\/[^\s"'<>()]+?\.(?:webp|jpe?g|png|gif|svg)(?:\?[^\s"'<>()]*)?(?=$|[\s"'<>()])/gi;
const LOCAL_PREFIX = '/api/media/';

function hostAllowed(u) {
  try { return ALLOWED_HOSTS.has(new URL(u).hostname.toLowerCase()); } catch { return false; }
}

// מעבר רקורסיבי על ערך JSON: אוסף את כל כתובות התמונות החיצוניות
function collectUrls(value, out = new Set()) {
  if (typeof value === 'string') {
    for (const m of value.match(URL_RE) || []) if (hostAllowed(m)) out.add(m);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectUrls(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectUrls(v, out));
  }
  return out;
}

// החלפת מחרוזות לפי מפה {ישן: חדש} בכל עומק. מחזיר [ערך חדש, מספר החלפות]
function replaceDeep(value, map) {
  let count = 0;
  const keys = Object.keys(map).sort((a, b) => b.length - a.length); // ארוך קודם - שלא תוחלף תת-מחרוזת
  const walk = (v) => {
    if (typeof v === 'string') {
      let s = v;
      for (const k of keys) {
        if (s.includes(k)) { count += s.split(k).length - 1; s = s.split(k).join(map[k]); }
      }
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return [walk(value), count];
}

// מידות התמונה מתוך הכותרת של הקובץ (לא חובה - null אם לא זוהה)
function imageSize(buf, mime) {
  try {
    if (mime === 'image/png' && buf.length > 24) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    if (mime === 'image/gif' && buf.length > 10) return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
    if (mime === 'image/webp' && buf.length > 30) {
      const kind = buf.toString('ascii', 12, 16);
      if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
      if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
      if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
        i += 2 + len;
      }
    }
  } catch { /* קובץ לא תקין - בלי מידות */ }
  return [null, null];
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow', headers: { 'User-Agent': 'OrYakar-MediaImport/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('image/')) throw new Error(`סוג תוכן לא תמונה: ${mime || 'לא ידוע'}`);
  if (!OK_TYPES.has(mime)) throw new Error(`סוג תמונה לא נתמך: ${mime}`);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error('הקובץ גדול מ-8MB');
  const chunks = [];
  let size = 0;
  for await (const c of res.body) {
    size += c.length;
    if (size > MAX_BYTES) throw new Error('הקובץ גדול מ-8MB');
    chunks.push(c);
  }
  if (!size) throw new Error('קובץ ריק');
  return { mime, bytes: Buffer.concat(chunks) };
}

async function storeOne(url) {
  // כבר הועתק בעבר - לא מורידים שוב
  const existing = await one('SELECT id FROM media WHERE source_url = $1', [url]);
  if (existing) return existing.id;
  const { mime, bytes } = await download(url);
  const [width, height] = imageSize(bytes, mime);
  const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
  const row = await one(`INSERT INTO media (source_url, mime, bytes, size, width, height, sha1) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (source_url) DO UPDATE SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, size = EXCLUDED.size,
      width = EXCLUDED.width, height = EXCLUDED.height, sha1 = EXCLUDED.sha1 RETURNING id`, [url, mime, bytes, bytes.length, width, height, sha1]);
  return row.id;
}

async function readSettings() {
  const out = {};
  for (const k of SCAN_KEYS) out[k] = await getSetting(k);
  return out;
}

let running = null;

// הריצה עצמה: איסוף, הורדה, שמירה והחלפת הקישורים בהגדרות
async function runImport() {
  const before = await readSettings();
  const urls = [...collectUrls(before)];
  const result = { found: urls.length, imported: 0, failed: [], replaced: 0 };
  if (!urls.length) return result;
  const mapped = {};
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try { mapped[url] = await storeOne(url); result.imported += 1; } catch (e) {
        result.failed.push({ url, error: e.name === 'TimeoutError' ? 'תם הזמן (20 שניות)' : (e.cause?.code || e.message || String(e)) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  if (!Object.keys(mapped).length) return result;

  // מפת המקור - מצטברת, לא נמחקת
  const prevMap = (await getSetting('media_map')) || {};
  await setSetting('media_map', { ...prevMap, ...mapped });

  // מחליפים רק את מה שהועתק בהצלחה; קוראים מחדש את ההגדרות רגע לפני השמירה כדי לא לדרוס עריכה שנעשתה בינתיים
  const repl = Object.fromEntries(Object.entries(mapped).map(([u, id]) => [u, `${LOCAL_PREFIX}${id}`]));
  const fresh = await readSettings();
  for (const k of SCAN_KEYS) {
    if (fresh[k] == null) continue;
    const [next, n] = replaceDeep(fresh[k], repl);
    if (n > 0) { await setSetting(k, next); result.replaced += n; }
  }
  return result;
}

// מניעת ריצות מקבילות (אוטומטית + ידנית)
export function importMedia() {
  if (!running) running = runImport().finally(() => { running = null; });
  return running;
}

// החזרה לאחור: /api/media/<id> -> הכתובת המקורית
async function rollbackMedia() {
  const map = (await getSetting('media_map')) || {};
  const repl = Object.fromEntries(Object.entries(map).map(([u, id]) => [`${LOCAL_PREFIX}${id}`, u]));
  const fresh = await readSettings();
  let restored = 0;
  for (const k of SCAN_KEYS) {
    if (fresh[k] == null) continue;
    // התאמה מדויקת בלבד (/api/media/1 לא יפגע ב-/api/media/12)
    const walk = (v) => {
      if (typeof v === 'string') return v.replace(/\/api\/media\/\d+(?![\d])/g, (m) => (repl[m] ? (restored += 1, repl[m]) : m));
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([a, x]) => [a, walk(x)]));
      return v;
    };
    const before = restored;
    const next = walk(fresh[k]);
    if (restored > before) await setSetting(k, next);
  }
  return { restored };
}

// הפעלה אוטומטית בעליית השרת: רק אם בהגדרות עדיין יש קישורים לאתר הישן. לעולם לא זורק שגיאה.
export async function ensureMediaImported() {
  try {
    const urls = collectUrls(await readSettings());
    if (!urls.size) return null;
    console.log(`[media] נמצאו ${urls.size} תמונות באתר הישן - מעתיק למסד ברקע`);
    const r = await importMedia();
    console.log(`[media] הועתקו ${r.imported}/${r.found}, הוחלפו ${r.replaced} קישורים${r.failed.length ? `, נכשלו ${r.failed.length}` : ''}`);
    if (r.failed.length) console.warn('[media] כשלונות:', r.failed.slice(0, 5).map((f) => `${f.url} - ${f.error}`).join(' | '));
    await audit(null, 'media_import_auto', 'media', null, { found: r.found, imported: r.imported, replaced: r.replaced, failed: r.failed.length });
    return r;
  } catch (e) {
    console.error('[media] העתקת התמונות נכשלה:', e.message);
    return null;
  }
}

export function registerMediaRoutes(r) {
  // הגשת תמונה - ציבורי, בלי כניסה, עם מטמון לשנה (התוכן של מזהה לא משתנה)
  r.get('/api/media/:id', async (ctx) => {
    const id = parseInt(String(ctx.params.id), 10); // מאפשר גם /api/media/12.webp
    if (!Number.isFinite(id) || id <= 0) throw new HttpError(404, 'תמונה לא נמצאה');
    const row = await one('SELECT mime, bytes, size, sha1 FROM media WHERE id = $1', [id]);
    if (!row) throw new HttpError(404, 'תמונה לא נמצאה');
    const etag = `"m${id}-${row.sha1 || row.size}"`;
    const headers = {
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: etag,
      // SVG שנפתח ישירות לא יוכל להריץ קוד
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-site',
    };
    if (String(ctx.req.headers['if-none-match'] || '').split(',').map((s) => s.trim()).includes(etag)) {
      ctx.send(304, undefined, row.mime, headers);
      return;
    }
    const bytes = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
    ctx.send(200, bytes, row.mime, { ...headers, 'Content-Length': bytes.length });
  });

  // העתקה ידנית (מתכנת): אפשר להריץ שוב בבטחה
  r.post('/api/media/import', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    const result = await importMedia();
    await audit(ctx.user, 'media_import', 'media', null, { found: result.found, imported: result.imported, replaced: result.replaced, failed: result.failed.length });
    ctx.json(200, result);
  });

  // מצב: כמה תמונות במסד וכמה קישורים ישנים נשארו
  r.get('/api/media', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    const stats = await one('SELECT COUNT(*)::int AS count, COALESCE(SUM(size),0)::bigint AS bytes FROM media');
    const remaining = [...collectUrls(await readSettings())];
    ctx.json(200, { ...stats, remaining_external: remaining, map: (await getSetting('media_map')) || {} });
  });

  // החזרה לקישורים המקוריים (התמונות נשארות במסד)
  r.post('/api/media/rollback', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    const result = await rollbackMedia();
    await audit(ctx.user, 'media_rollback', 'media', null, result);
    ctx.json(200, result);
  });
}
