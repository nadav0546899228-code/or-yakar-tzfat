// נדרים פלוס - דף תרומה עם אייפרם תשלום, CallBack, ובדיקות מול מוסד הבדיקות 0.
// ברירת מחדל: מוסד בדיקות (0) - עסקה עוברת את כל שלבי הסליקה בלי חיוב ובלי קבלה.
// מוסד אמיתי (7000318) נפתח רק כשכל התנאים מתקיימים: ייצור (isSandbox=false) + NEDARIM_LIVE=true + NEDARIM_API_VALID_LIVE ב-Secrets.
import { one, many, query } from '../lib/db.js';
import { HttpError } from '../lib/router.js';
import { normalizePhone } from '../lib/security.js';
import { requirePerm } from '../auth.js';
import { isSandbox, isPublished } from '../env.js';
import { getSetting, setSetting } from '../settings.js';
import { upsertDonorFromSource, recordTransaction } from '../providers/engine.js';
import { audit, notify } from '../audit.js';

const IFRAME_URL = 'https://matara.pro/nedarimplus/iframe?language=he';
const TEST = { mosad: '0', api_valid: 'j+iyEFN3bE' };
const ERROR_MAIL = process.env.NEDARIM_ERROR_MAIL || 'nadav0546899228@gmail.com';
const DUMMY_TAG = 'דמה-נדרים';
const TEST_ID = '890108558';

export const TEST_CARDS = [
  { brand: 'ויזה', number: '4557440411874990', cvv: '229', tokef: '05/31' },
  { brand: 'מאסטרקארד', number: '5310840302789162', cvv: '245', tokef: '05/31' },
];

const DUMMIES = [
  ['ישראל', 'ישראלי', '0500000101', 'test1@example.com'],
  ['שרה', 'בדיקה', '0500000102', 'test2@example.com'],
  ['משה', 'דמה', '0500000103', 'test3@example.com'],
  ['רחל', 'ניסיון', '0500000104', 'test4@example.com'],
  ['דוד', 'טסט', '0500000105', 'test5@example.com'],
  ['לאה', 'פיקטיבית', '0500000106', 'test6@example.com'],
];

// תרחישי בדיקה. כרטיס האשראי מוקלד ידנית בתוך האייפרם (פרטי כרטיס לא עוברים דרכנו).
export const SCENARIOS = [
  { id: 1, title: 'תרומה רגילה', donor: 0, amount: 18, payment_type: 'Ragil', installments: 1, card: 0 },
  { id: 2, title: 'תרומה ב-3 תשלומים', donor: 1, amount: 360, payment_type: 'Ragil', installments: 3, card: 1 },
  { id: 3, title: 'הוראת קבע חודשית', donor: 2, amount: 50, payment_type: 'HK', installments: 12, card: 0 },
  { id: 4, title: 'תרומה שנכשלה (תוקף שפג)', donor: 3, amount: 25, payment_type: 'Ragil', installments: 1, card: 0, bad_tokef: '01/20', expect: 'Error' },
  { id: 5, title: 'בדיקת הפניה (בלי חיוב)', donor: 4, redirect: true },
  { id: 6, title: 'חיוב כפול שנחסם (AjaxId)', donor: 5, amount: 36, double: true },
];

export function nedarimMode() {
  const liveKey = process.env.NEDARIM_API_VALID_LIVE;
  const live = !isSandbox() && process.env.NEDARIM_LIVE === 'true' && !!liveKey;
  return live ? { test: false, mosad: null, api_valid: liveKey } : { test: true, ...TEST };
}

// בתקופת ההרצה (מוסד בדיקות) כל קישורי התרומה של נדרים באתר מופנים לדף התרומה שלנו
export function rewriteDonationLinks(obj) {
  if (!nedarimMode().test) return obj;
  const walk = (v) => {
    if (typeof v === 'string') return /matara\.pro\/nedarimplus\/online/i.test(v) ? '/donate' : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(obj);
}

async function liveMosad() {
  const org = await getSetting('org');
  return String(org?.nedarim_mosad || '7000318');
}

function origin(ctx) {
  const host = String(ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || '').split(',')[0].trim();
  const local = /^localhost|^127\./.test(host);
  return `${local ? 'http' : 'https'}://${host}`;
}

function parseBody(b) {
  if (b && b.raw) {
    try { return JSON.parse(b.raw); } catch { return Object.fromEntries(new URLSearchParams(b.raw)); }
  }
  const keys = Object.keys(b || {});
  // JSON שנשלח בלי Content-Type מתאים מגיע כמפתח יחיד של טופס
  if (keys.length === 1 && keys[0].trim().startsWith('{')) {
    try { return JSON.parse(keys[0] + (b[keys[0]] ? `=${b[keys[0]]}` : '')); } catch { /* נמשיך כטופס */ }
  }
  return b || {};
}

const pick = (o, ...keys) => { for (const k of keys) if (o?.[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return null; };

// מוסיף לתקנון האתר את מדיניות הביטול (דרישת ישראכרט), פעם אחת בלבד
export async function ensureRefundPolicy() {
  const site = await getSetting('site');
  const terms = site?.pages?.terms;
  if (!terms || terms.sections?.some((s) => s.heading === 'מדיניות ביטול עסקה והחזר תרומה')) return;
  terms.sections = [...(terms.sections || []), {
    heading: 'מדיניות ביטול עסקה והחזר תרומה',
    text: 'בהתאם לחוק הגנת הצרכן, התשמ"א-1981, ניתן לבקש ביטול תרומה שבוצעה באתר בתוך 14 ימים מיום ביצועה, בפנייה למשרדי העמותה בטלפון או במייל המופיעים בתחתית העמוד, בציון שם התורם, תאריך התרומה וסכומה.\nההחזר יבוצע לאמצעי התשלום שבו בוצעה התרומה, בתוך 14 ימים מיום קבלת הבקשה. אם הופקה קבלה לפי סעיף 46, תופק במקומה קבלת זיכוי.\nהוראת קבע ניתנת לביטול בכל עת בהודעה למשרדי העמותה, והביטול ייכנס לתוקף מהחיוב הבא.\nהתשלום באתר מתבצע בדף תשלום מאובטח של ספק סליקה מורשה. פרטי כרטיס האשראי אינם נשמרים באתר.',
  }];
  await setSetting('site', site);
}

async function createPending(b, { test, scenario = null }) {
  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!(amount >= 1) || amount > 1000000) throw new HttpError(400, 'יש לבחור סכום תרומה');
  const first = String(b.first_name || '').trim().slice(0, 60);
  const last = String(b.last_name || '').trim().slice(0, 60);
  const phone = normalizePhone(b.phone);
  const email = String(b.email || '').trim().slice(0, 120) || null;
  const idNumber = String(b.id_number || '').replace(/\D/g, '').slice(0, 9) || null;
  if (!first) throw new HttpError(400, 'יש למלא שם פרטי');
  if (!phone && !email) throw new HttpError(400, 'יש למלא טלפון או מייל, לצורך הקבלה');
  const ajax = String(b.ajax_id || '').replace(/[^\w.-]/g, '').slice(0, 64);
  if (ajax.length < 6) throw new HttpError(400, 'חסר מזהה בקשה (AjaxId)');
  const ext = `AJ-${ajax}`;
  const dup = await one("SELECT id, status FROM transactions WHERE source = 'nedarim' AND external_id = $1", [ext]);
  if (dup) throw new HttpError(409, 'הבקשה כבר נשלחה. נחסם ניסיון לחיוב כפול', { tx_id: dup.id, duplicate: true });
  const paymentType = b.payment_type === 'HK' ? 'HK' : 'Ragil';
  const installments = Math.max(1, Math.min(36, Number(b.installments) || 1));
  const donorId = await upsertDonorFromSource('nedarim', `WEB-${idNumber || phone || email}`, {
    first_name: first, last_name: last, phone, email, id_number: idNumber, city: String(b.city || '').slice(0, 60) || null,
  }, { isDemo: test });
  const { row } = await recordTransaction({
    donor_id: donorId, source: 'nedarim', external_id: ext, kind: paymentType === 'HK' ? 'keva' : 'one_time', method: 'credit',
    amount, currency: 'ILS', installments: paymentType === 'HK' ? 1 : installments, status: 'pending',
    dedication: String(b.comment || '').trim().slice(0, 200) || null,
    notes: test ? 'נדרים פלוס - מוסד בדיקות 0 (ללא חיוב וללא קבלה)' : 'נדרים פלוס - ממתין לאישור הסליקה',
    raw: { nedarim_test: test, ajax_id: ajax, scenario, payment_type: paymentType, months: paymentType === 'HK' ? installments : null },
  }, null, { isDemo: test });
  return { row, ajax };
}

async function finish(tx, { ok, message, last4, confirmation, data, via }) {
  const raw = { ...(tx.raw || {}), [via]: data, [`${via}_at`]: new Date().toISOString() };
  if (tx.status !== 'pending') {
    await query('UPDATE transactions SET raw = $2 WHERE id = $1', [tx.id, raw]);
    return tx.status;
  }
  const status = ok ? 'paid' : 'failed';
  await query('UPDATE transactions SET status = $2, failure_reason = $3, card_last4 = COALESCE($4, card_last4), raw = $5, synced_at = now() WHERE id = $1',
    [tx.id, status, ok ? null : String(message || 'העסקה נדחתה').slice(0, 200), last4 ? String(last4).slice(-4) : null, { ...raw, confirmation: confirmation || raw.confirmation || null }]);
  if (ok && !tx.is_demo) {
    await notify({ title: 'תרומה חדשה מהאתר (נדרים פלוס)', body: `${Number(tx.amount).toLocaleString('he-IL')} ₪`, link: '/app/transactions', roles: ['developer', 'manager', 'treasurer'] });
  }
  return status;
}

export function registerNedarimRoutes(r) {
  // הגדרות לדף התרומה. ה-ApiValid נועד לשימוש בצד הלקוח לפי שיטת האייפרם של נדרים
  r.get('/api/public/nedarim/config', async (ctx) => {
    const mode = nedarimMode();
    const inst = await many('SELECT name FROM institutions WHERE active = TRUE ORDER BY sort, id');
    const showTests = mode.test; // בתקופת ההרצה התרחישים זמינים גם באתר המפורסם, כל עוד מוסד הבדיקות פעיל
    ctx.json(200, {
      test: mode.test,
      mosad: mode.test ? TEST.mosad : await liveMosad(),
      api_valid: mode.api_valid,
      iframe_url: IFRAME_URL,
      callback_url: `${origin(ctx)}/api/nedarim/callback`,
      callback_mail_error: mode.test ? ERROR_MAIL : '',
      purposes: inst.map((i) => i.name),
      scenarios: showTests ? SCENARIOS.filter((s) => !s.redirect && !s.double) : [],
      dummies: showTests ? DUMMIES.map(([first_name, last_name, phone, email]) => ({ first_name, last_name, phone, email, id_number: TEST_ID })) : [],
      cards: showTests ? TEST_CARDS : [],
    });
  });

  r.post('/api/public/nedarim/start', async (ctx) => {
    const b = ctx.body;
    if (b.website) { ctx.json(200, { ok: true }); return; } // מלכודת בוטים
    const mode = nedarimMode();
    const { row, ajax } = await createPending(b, { test: mode.test, scenario: Number(b.scenario) || null });
    ctx.json(200, { tx_id: row.id, ajax_id: ajax, test: mode.test });
  });

  // תשובת האייפרם (TransactionResponse) כפי שהתקבלה בדפדפן. במוסד האמיתי הסטטוס נקבע רק לפי ה-CallBack
  r.post('/api/public/nedarim/result', async (ctx) => {
    const b = ctx.body;
    const tx = await one("SELECT * FROM transactions WHERE id = $1 AND source = 'nedarim' AND external_id = $2", [Number(b.tx_id) || 0, `AJ-${String(b.ajax_id || '')}`]);
    if (!tx) throw new HttpError(404, 'התרומה לא נמצאה');
    const v = b.response || {};
    const error = String(v.Status || '').toLowerCase() === 'error';
    let status;
    if (error || tx.raw?.nedarim_test) {
      status = await finish(tx, { ok: !error, message: v.Message, last4: pick(v, 'LastNum', 'LastNumber'), confirmation: pick(v, 'Confirmation', 'TransactionId'), data: v, via: 'client_response' });
    } else {
      await query('UPDATE transactions SET raw = $2 WHERE id = $1', [tx.id, { ...(tx.raw || {}), client_response: v }]);
      status = 'pending';
    }
    ctx.json(200, { status, test: !!tx.raw?.nedarim_test, message: v.Message || null });
  });

  // CallBack מהשרת של נדרים (ללא Origin, ללא התחברות). מאמת מול תרומה ממתינה + סכום תואם
  r.post('/api/nedarim/callback', async (ctx) => {
    const b = parseBody(ctx.body);
    const txId = Number(pick(b, 'Param1', 'param1')) || 0;
    const ajax = String(pick(b, 'Param2', 'param2') || '');
    const tx = txId ? await one("SELECT * FROM transactions WHERE id = $1 AND source = 'nedarim'", [txId]) : null;
    if (!tx || (ajax && tx.external_id !== `AJ-${ajax}`)) {
      await audit(null, 'nedarim_callback_unmatched', 'provider', 'nedarim', { body: b });
      ctx.send(200, 'OK');
      return;
    }
    const amount = Number(pick(b, 'Amount', 'amount') || 0);
    const statusText = String(pick(b, 'Status', 'status') || '');
    const ok = !/error|fail|סירוב|נכשל/i.test(statusText) && (!amount || Math.abs(amount - Number(tx.amount)) < 0.01);
    const status = await finish(tx, {
      ok, message: pick(b, 'Message', 'ErrorText') || (amount && !ok ? 'הסכום ב-CallBack אינו תואם לתרומה' : statusText),
      last4: pick(b, 'LastNum', 'LastNumber'), confirmation: pick(b, 'Confirmation', 'TransactionId'), data: b, via: 'callback',
    });
    await audit(null, 'nedarim_callback', 'transaction', tx.id, { status, test: !!tx.raw?.nedarim_test });
    ctx.send(200, 'OK');
  });

  // ---------- תצוגת מתכנת: בדיקות ----------
  r.get('/api/nedarim/tests', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    const mode = nedarimMode();
    const rows = await many(`SELECT t.id, t.amount, t.status, t.failure_reason, t.card_last4, t.installments, t.kind, t.created_at, t.raw,
        d.first_name, d.last_name FROM transactions t LEFT JOIN donors d ON d.id = t.donor_id
      WHERE t.source = 'nedarim' AND t.external_id LIKE 'AJ-%' ORDER BY t.id DESC LIMIT 30`);
    const dummies = await one('SELECT COUNT(*)::int AS c FROM donors WHERE $1 = ANY(tags)', [DUMMY_TAG]);
    ctx.json(200, {
      mode: { test: mode.test, mosad: mode.test ? TEST.mosad : await liveMosad(), live_ready: !!process.env.NEDARIM_API_VALID_LIVE, sandbox: isSandbox(), published: isPublished() },
      callback_url: `${origin(ctx)}/api/nedarim/callback`,
      scenarios: SCENARIOS, cards: TEST_CARDS, test_id: TEST_ID, dummies: dummies.c,
      rows: rows.map((x) => ({
        id: x.id, donor: `${x.first_name || ''} ${x.last_name || ''}`.trim(), amount: x.amount, status: x.status, reason: x.failure_reason,
        last4: x.card_last4, kind: x.kind, installments: x.installments, at: x.created_at, test: !!x.raw?.nedarim_test,
        scenario: x.raw?.scenario || null, response: x.raw?.client_response?.Message || x.raw?.client_response?.Status || null,
        callback: !!x.raw?.callback, confirmation: x.raw?.confirmation || null,
      })),
    });
  });

  r.post('/api/nedarim/dummies', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    if (!nedarimMode().test) throw new HttpError(400, 'לקוחות דמה נוצרים רק במצב בדיקה');
    let created = 0;
    for (const [first, last, phone, email] of DUMMIES) {
      const ex = await one('SELECT id FROM donors WHERE phone = $1 AND $2 = ANY(tags)', [phone, DUMMY_TAG]);
      if (ex) continue;
      await query(`INSERT INTO donors (first_name, last_name, phone, email, id_number, city, tags, is_demo) VALUES ($1,$2,$3,$4,$5,'צפת',$6,TRUE)`,
        [first, last, phone, email, TEST_ID, [DUMMY_TAG, 'מקור:nedarim']]);
      created++;
    }
    await audit(ctx.user, 'nedarim_dummies_create', 'provider', 'nedarim', { created });
    ctx.json(200, { created, message: created ? `נוצרו ${created} לקוחות דמה` : 'לקוחות הדמה כבר קיימים' });
  });

  r.post('/api/nedarim/dummies/clear', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    const t = await query("DELETE FROM transactions WHERE source = 'nedarim' AND external_id LIKE 'AJ-%' AND (raw->>'nedarim_test')::boolean IS TRUE");
    const d = await query(`DELETE FROM donors WHERE ($1 = ANY(tags) OR (is_demo AND id_number = $2 AND id IN (SELECT donor_id FROM donor_links WHERE source = 'nedarim' AND external_id LIKE 'WEB-%')))
      AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.donor_id = donors.id)`, [DUMMY_TAG, TEST_ID]);
    await audit(ctx.user, 'nedarim_tests_clear', 'provider', 'nedarim', { transactions: t.rowCount, donors: d.rowCount });
    ctx.json(200, { message: `נמחקו ${t.rowCount} תנועות בדיקה ו-${d.rowCount} לקוחות דמה` });
  });

  // תרחיש 6: שליחה כפולה של אותו AjaxId - השנייה חייבת להיחסם
  r.post('/api/nedarim/double-test', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    const mode = nedarimMode();
    if (!mode.test) throw new HttpError(400, 'הבדיקה זמינה רק במוסד הבדיקות');
    const [first, last, phone, email] = DUMMIES[5];
    const body = { first_name: first, last_name: last, phone, email, id_number: TEST_ID, amount: 36, ajax_id: `dbl-${Date.now()}` };
    const a = await createPending(body, { test: true, scenario: 6 });
    let blocked = false;
    try { await createPending(body, { test: true, scenario: 6 }); } catch (e) { blocked = e.status === 409; }
    await query("UPDATE transactions SET status = 'cancelled', failure_reason = 'בדיקת חיוב כפול - לא נשלח לנדרים', raw = raw || $2 WHERE id = $1",
      [a.row.id, { double_blocked: blocked }]);
    ctx.json(200, { blocked, message: blocked ? 'עבר: הבקשה השנייה עם אותו AjaxId נחסמה' : 'נכשל: הבקשה השנייה לא נחסמה' });
  });
}
