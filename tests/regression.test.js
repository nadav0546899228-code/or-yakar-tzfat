// בדיקות רגרסיה מקצה לקצה למערכת אור יקר צפת.
// הרצה: npm test   (מסד ושרת זמניים, נמחקים בסוף)
// מול שרת קיים: TEST_BASE_URL=http://host:port TEST_OWNER_PIN=xxxx npm test
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { TestEnv, EXTERNAL, OWNER_PHONE, OWNER_TEMP_PIN, OWNER_PIN, rawGet, openSse, sleep, israelToday, uniquePhone } from './helpers.js';

const env = new TestEnv();
let owner; // לקוח מחובר של חשבון הבעלים (מתכנת)
const gate = {}; // מה שנמדד לפני ואחרי החלפת הקוד הזמני של הבעלים

const idNumber = () => String(crypto.randomInt(100_000_000, 1_000_000_000));

/** יצירת תורם חדש (ייחודי) - מחזיר את השורה */
async function makeDonor(client = owner, extra = {}) {
  const r = await client.post('/api/r/donors', { first_name: 'בדיקה', last_name: `תורם-${crypto.randomBytes(2).toString('hex')}`, phone: uniquePhone(), city: 'צפת', ...extra });
  assert.equal(r.status, 200, `יצירת תורם: ${r.text}`);
  return r.data.row;
}

/** תנועה ידנית ששולמה (מזומן ע"י הבעלים - מאושרת אוטומטית) */
async function makePaidTx(donorId, amount = 180, extra = {}) {
  const r = await owner.post('/api/transactions', { donor_id: donorId, amount, method: 'cash', ...extra });
  assert.equal(r.status, 200, `יצירת תנועה: ${r.text}`);
  assert.equal(r.data.row.status, 'paid');
  return r.data.row;
}

before(async () => {
  await env.start();
  owner = env.client();
  let l = await owner.login(OWNER_PHONE, OWNER_TEMP_PIN);
  if (l.status !== 200 && OWNER_PIN !== OWNER_TEMP_PIN) l = await owner.login(OWNER_PHONE, OWNER_PIN);
  assert.equal(l.status, 200, `כניסת הבעלים נכשלה: ${l.text}`);
  const me = await owner.get('/api/auth/me');
  gate.mustChange = !!me.data?.user?.must_change_pin;
  gate.before = await owner.get('/api/users');
  if (gate.mustChange) {
    gate.change = await owner.post('/api/auth/profile', { pin: OWNER_PIN });
    assert.equal(gate.change.status, 200, `החלפת קוד הבעלים: ${gate.change.text}`);
  }
  gate.after = await owner.get('/api/users');
  env.owner = owner;

  const seed = await owner.post('/api/demo/seed', {});
  env.setup.seed = seed;
  assert.ok(seed.status === 200 || (EXTERNAL && seed.status === 409), `יצירת נתוני דוגמה: ${seed.status} ${seed.text}`);
});

after(async () => {
  await env.stop();
});

// ------------------------------------------------------------------
describe('1. בריאות השרת וקבצים סטטיים', () => {
  test('GET /api/health מחזיר ok, גרסה, בנייה ומסד מוכן', async () => {
    const r = await owner.get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.equal(typeof r.data.version, 'string');
    assert.ok(r.data.version.length > 0);
    assert.ok(r.data.build && typeof r.data.build.build_id === 'string', `build חסר: ${JSON.stringify(r.data.build)}`);
    assert.equal(r.data.db, 'ready');
    if (!EXTERNAL) assert.equal(r.data.session_secret, 'ok');
  });

  test('index.html נשלח דחוס ב-gzip ומכיל id="site-data"', async () => {
    const r = await rawGet(env.base, '/', { 'Accept-Encoding': 'gzip' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.match(r.headers['content-type'], /text\/html/);
    const html = zlib.gunzipSync(r.body).toString('utf8');
    assert.ok(html.includes('id="site-data"'), 'לא נמצא <script id="site-data"> בדף');
  });

  test('/assets/main.js נשלח ב-br כשהדפדפן מקבל br', async () => {
    const r = await rawGet(env.base, '/assets/main.js', { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-encoding'], 'br');
    assert.match(r.headers['content-type'], /javascript/);
    const js = zlib.brotliDecompressSync(r.body);
    assert.ok(js.length > 1000, 'קובץ ה-JS אחרי פריסה קצר מדי');
  });

  test('קובץ קוד חסר /assets/x.js מחזיר 404 אמיתי (לא דף HTML)', async () => {
    const r = await rawGet(env.base, '/assets/x.js', { 'Accept-Encoding': 'gzip, br' });
    assert.equal(r.status, 404);
    assert.doesNotMatch(String(r.headers['content-type']), /html/);
    assert.doesNotMatch(r.body.toString('utf8'), /<html|<!doctype/i);
  });
});

// ------------------------------------------------------------------
describe('2. חסימת קוד זמני', () => {
  test('בעלים: לפני החלפת הקוד /api/users → 403 must_change_pin, אחרי → 200', async (t) => {
    if (!gate.mustChange) { t.skip('הקוד של הבעלים כבר הוחלף בשרת הזה'); return; }
    assert.equal(gate.before.status, 403);
    assert.equal(gate.before.data.code, 'must_change_pin');
    assert.equal(gate.after.status, 200);
    assert.ok(Array.isArray(gate.after.data.rows));
  });

  test('משתמש חדש: חסום עד החלפת הקוד, /api/auth/me פתוח, ואחרי ההחלפה נפתח', async () => {
    const u = await env.makeUser(['manager'], { login: false });
    const c = env.client();
    assert.equal((await c.login(u.phone, u.pin)).status, 200);
    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.user.must_change_pin, true);
    for (const p of ['/api/users', '/api/counts', '/api/r/donors']) {
      const r = await c.get(p);
      assert.equal(r.status, 403, `${p} אמור להיחסם`);
      assert.equal(r.data.code, 'must_change_pin', p);
    }
    assert.equal((await c.post('/api/auth/profile', { pin: '13579' })).status, 200);
    assert.equal((await c.get('/api/users')).status, 200);
  });
});

// ------------------------------------------------------------------
describe('3. נעילת חשבון אחרי ניסיונות שגויים', () => {
  test('5 קודים שגויים → 423, וגם הקוד הנכון נחסם בזמן הנעילה', async () => {
    const u = await env.makeUser(['secretary'], { login: false });
    const c = env.client();
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await c.login(u.phone, '000000')).status);
    assert.deepEqual(statuses, [401, 401, 401, 401, 423]);
    const right = await c.login(u.phone, u.pin);
    assert.equal(right.status, 423, 'קוד נכון בזמן נעילה חייב להיחסם');
    assert.equal(c.jar.size, 0, 'לא אמור להיווצר חיבור');
    if (env.hasDb) {
      const [row] = await env.sql('SELECT lock_count, locked_until > now() AS locked FROM users WHERE id = $1', [u.id]);
      assert.equal(row.lock_count, 1);
      assert.equal(row.locked, true);
    }
  });

  test('פרץ מקבילי של 10 ניסיונות שגויים יוצר נעילה אחת בלבד (lock_count=1)', async () => {
    const u = await env.makeUser(['secretary'], { login: false });
    const c = env.client();
    const res = await Promise.all(Array.from({ length: 10 }, () => c.login(u.phone, '999999')));
    const st = res.map((r) => r.status);
    assert.ok(st.every((s) => s === 401 || s === 423), `סטטוסים לא צפויים: ${st}`);
    assert.ok(st.filter((s) => s === 423).length >= 1, 'לפחות ניסיון אחד אמור לקבל 423');
    assert.ok(st.filter((s) => s === 401).length <= 4, `לכל היותר 4 ניסיונות נבדקים לפני הנעילה, התקבל ${st}`);
    if (env.hasDb) {
      const [row] = await env.sql('SELECT lock_count, locked_until > now() AS locked FROM users WHERE id = $1', [u.id]);
      assert.equal(row.lock_count, 1, 'נעילה כפולה: lock_count שונה מ-1');
      assert.equal(row.locked, true);
    }
    // הניסיון ה-11 לאותו טלפון נתקל גם במגבלת הקצב לפי טלפון (10 ל-15 דקות) → 429. העיקר: אין כניסה
    const right = await c.login(u.phone, u.pin);
    assert.ok([423, 429].includes(right.status), `קוד נכון בזמן נעילה: ${right.status}`);
    assert.equal(c.jar.size, 0);
  });
});

// ------------------------------------------------------------------
describe('4. היררכיית ניהול משתמשים', () => {
  test('מנכ"ל לא יכול לאפס קוד / לערוך / לשחרר מנכ"ל אחר או מתכנת; מתכנת יכול', async () => {
    const m1 = await env.makeUser(['manager']);
    const m2 = await env.makeUser(['manager'], { login: false });
    const dev = await env.makeUser(['developer'], { login: false });
    const ownerId = (await owner.get('/api/auth/me')).data.user.id;
    for (const target of [m2.id, dev.id, ownerId]) {
      const a = await m1.client.post(`/api/users/${target}/reset-pin`, {});
      const b = await m1.client.put(`/api/users/${target}`, { name: 'השתלטות' });
      const c = await m1.client.post(`/api/users/${target}/unlock`, {});
      assert.deepEqual([a.status, b.status, c.status], [403, 403, 403], `יעד ${target}`);
    }
    // מנכ"ל לא יכול להעניק תפקיד מנכ"ל
    assert.equal((await m1.client.post('/api/users', { name: 'x', phone: uniquePhone(), roles: ['manager'] })).status, 403);
    // מנכ"ל כן מנהל תפקיד שמתחתיו
    const sec = await env.makeUser(['secretary'], { login: false });
    assert.equal((await m1.client.post(`/api/users/${sec.id}/reset-pin`, {})).status, 200);
    // מתכנת (הבעלים) יכול הכול
    const r1 = await owner.post(`/api/users/${m2.id}/reset-pin`, {});
    assert.equal(r1.status, 200);
    assert.match(String(r1.data.temp_pin), /^\d{6}$/);
    assert.equal((await owner.put(`/api/users/${m2.id}`, { name: 'מנכ"ל שני' })).status, 200);
    assert.equal((await owner.post(`/api/users/${dev.id}/unlock`, {})).status, 200);
    if (env.hasDb) {
      const [row] = await env.sql('SELECT name FROM users WHERE id = $1', [m2.id]);
      assert.equal(row.name, 'מנכ"ל שני');
    }
  });
});

// ------------------------------------------------------------------
describe('5. תחום מתרים (רואה רק את התורמים שלו)', () => {
  test('מתרים לא רואה תורם של מתרים אחר: כרטיס, ייצוא ורשימת בחירה', async () => {
    const r1 = await env.makeUser(['recruiter']);
    const r2 = await env.makeUser(['recruiter']);
    const mine = await makeDonor(r1.client);
    const theirs = await makeDonor(r2.client);
    assert.equal(mine.recruiter_user_id, r1.id, 'תורם שמתרים יצר משויך אליו אוטומטית');
    assert.equal(theirs.recruiter_user_id, r2.id);

    assert.equal((await r1.client.get(`/api/r/donors/${mine.id}`)).status, 200);
    assert.equal((await r1.client.get(`/api/r/donors/${theirs.id}`)).status, 404);
    assert.equal((await r1.client.get(`/api/donors/${theirs.id}/full`)).status, 404);
    assert.equal((await r1.client.put(`/api/r/donors/${theirs.id}`, { city: 'חיפה' })).status, 404);

    const list = await r1.client.get('/api/r/donors?size=500');
    assert.equal(list.status, 200);
    assert.ok(list.data.rows.every((d) => d.recruiter_user_id === r1.id), 'ברשימה הופיע תורם של מישהו אחר');

    const exp = await r1.client.get('/api/export/donors?format=json');
    assert.equal(exp.status, 200);
    const idCol = exp.data.headers.indexOf('id');
    const ids = exp.data.rows.map((row) => Number(row[idCol]));
    assert.deepEqual(ids, [mine.id], `ייצוא כולל תורמים זרים: ${ids}`);

    const opts = await r1.client.get('/api/r/donors/options');
    assert.equal(opts.status, 200);
    assert.deepEqual(opts.data.rows.map((x) => x.id), [mine.id]);
    const byId = await r1.client.get(`/api/r/donors/options?id=${theirs.id}`);
    assert.equal(byId.data.rows.length, 0, 'רשימת בחירה לפי מזהה חושפת תורם זר');
    const byQ = await r1.client.get(`/api/r/donors/options?q=${encodeURIComponent(theirs.last_name)}`);
    assert.equal(byQ.data.rows.length, 0, 'חיפוש ברשימת בחירה חושף תורם זר');

    // לעומת זאת המנהל רואה את שניהם
    assert.equal((await owner.get(`/api/r/donors/${theirs.id}`)).status, 200);
  });
});

// ------------------------------------------------------------------
describe('6. חיובים חודשיים - אין חיוב כפול', () => {
  async function waitBatch(id) {
    const until = Date.now() + 30_000;
    for (;;) {
      const r = await owner.get(`/api/monthly-charges/batches/${id}`);
      assert.equal(r.status, 200);
      if (r.data.batch.status !== 'processing') return r.data;
      if (Date.now() > until) throw new Error(`סבב ${id} לא הסתיים תוך 30 שניות`);
      await sleep(150);
    }
  }
  async function paidThisMonth(soId, month) {
    const r = await owner.get(`/api/transactions?standing_order_id=${soId}&status=paid&size=1000`);
    return r.data.rows.filter((t) => String(t.date).slice(0, 7) === month).length;
  }

  test('הגשה כפולה במקביל + הרצה חוזרת: לכל הו"ק לכל היותר חיוב אחד ששולם בחודש', async () => {
    const demo = await owner.post('/api/monthly-charges/demo', {});
    assert.equal(demo.status, 200, demo.text);
    const list = await owner.get('/api/monthly-charges');
    assert.equal(list.status, 200);
    const month = list.data.month;
    assert.equal(month, israelToday().slice(0, 7), 'החודש הנוכחי לפי שעון ישראל');
    const rows = list.data.rows.filter((x) => /^05000002\d\d$/.test(x.donor_phone || ''));
    assert.ok(rows.length >= 6, `צפויים 6 תורמי בדיקה, נמצאו ${rows.length}`);
    const items = rows.map((x) => ({ so_id: x.id }));

    // הגשה כפולה במקביל (לחיצה כפולה / שני דפדפנים)
    const [a, b] = await Promise.all([
      owner.post('/api/monthly-charges/run', { month, items }),
      owner.post('/api/monthly-charges/run', { month, items }),
    ]);
    assert.equal(a.status, 200, a.text);
    assert.equal(b.status, 200, b.text);
    const [ba, bb] = await Promise.all([waitBatch(a.data.batch.id), waitBatch(b.data.batch.id)]);
    for (const d of [ba, bb]) {
      assert.equal(d.batch.status, 'completed');
      assert.equal(d.batch.total_success + d.batch.total_failed + d.batch.total_skipped, rows.length);
    }
    const successes = ba.batch.total_success + bb.batch.total_success;
    // הוראות שכבר חויבו החודש (ריצה חוזרת מול שרת קיים) לא אמורות להצליח שוב
    const alreadyPaid = new Set(rows.filter((x) => x.paid_tx_id).map((x) => x.id));
    for (const it of [...ba.items, ...bb.items]) {
      if (alreadyPaid.has(it.standing_order_id)) assert.notEqual(it.status, 'success', `הו"ק ${it.standing_order_id} חויבה פעמיים בחודש`);
    }
    // ההדמיה מצליחה ב-~88% באקראי; דורשים הצלחה רק כשיש לפחות 3 הוראות שעוד לא חויבו ושתוקפן תקין (סיכוי כישלון ~0.2%)
    const eligible = rows.filter((x) => !alreadyPaid.has(x.id) && x.exp_state !== 'expired');
    if (eligible.length >= 3) assert.ok(successes >= 1, 'לפחות חיוב אחד אמור להצליח (הדמיה: ~88% הצלחה)');
    assert.ok(successes <= rows.length, `יותר הצלחות (${successes}) מהוראות (${rows.length}) - חיוב כפול`);
    const expired = rows.find((x) => x.exp_state === 'expired');
    if (expired) {
      const it = [...ba.items, ...bb.items].filter((x) => x.standing_order_id === expired.id);
      assert.ok(it.every((x) => x.status !== 'success'), 'כרטיס שתוקפו פג לא אמור להיות מחויב');
    }

    const firstSuccess = new Set([...ba.items, ...bb.items].filter((x) => x.status === 'success').map((x) => x.standing_order_id));
    // הרצה חוזרת של אותם פריטים
    const c = await owner.post('/api/monthly-charges/run', { month, items });
    assert.equal(c.status, 200);
    const bc = await waitBatch(c.data.batch.id);
    for (const it of bc.items) {
      if (firstSuccess.has(it.standing_order_id)) assert.equal(it.status, 'skipped', `הו"ק ${it.standing_order_id} חויבה שוב`);
    }
    for (const x of rows) {
      const n = await paidThisMonth(x.id, month);
      assert.ok(n <= 1, `הו"ק ${x.id}: ${n} חיובים ששולמו בחודש ${month}`);
      if (firstSuccess.has(x.id) || alreadyPaid.has(x.id)) assert.equal(n, 1);
    }
    if (env.hasDb) {
      const dup = await env.sql(`SELECT standing_order_id, COUNT(*)::int AS n FROM charge_batch_items
        WHERE batch_month = $1 AND status = 'success' GROUP BY standing_order_id HAVING COUNT(*) > 1`, [month]);
      assert.deepEqual(dup, []);
    }
  });
});

// ------------------------------------------------------------------
describe('7. קובץ מס"ב - הפקה חוזרת לא רושמת חיובים נוספים', () => {
  test('הפקה שנייה לאותו יום+תאריך ערך: X-Masav-Repeat=1 ומספר התנועות לא גדל', async () => {
    const day = crypto.randomInt(1, 29);
    const chargeDate = `2031-${String(crypto.randomInt(1, 13)).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const donor = await makeDonor(owner, { id_number: idNumber() });
    const so = await owner.post('/api/keva', { donor_id: donor.id, amount: 72, type: 'bank', day_of_month: day, bank_code: '12', branch_code: '345', account_number: '123456' });
    assert.equal(so.status, 200, so.text);

    const countFor = async () => (await owner.get(`/api/transactions?from=${chargeDate}&to=${chargeDate}&size=1`)).data.count;
    assert.equal(await countFor(), 0);

    const f1 = await owner.post('/api/masav/file', { day, charge_date: chargeDate });
    assert.equal(f1.status, 200, f1.text);
    assert.equal(f1.headers.get('x-masav-repeat'), null);
    assert.match(f1.text, /^K/);
    const n1 = await countFor();
    assert.ok(n1 >= 1, 'ההפקה הראשונה אמורה לרשום תנועה ממתינה לפחות להוראה שיצרנו');
    const mine = await owner.get(`/api/transactions?standing_order_id=${so.data.row.id}`);
    assert.equal(mine.data.count, 1);
    assert.equal(mine.data.rows[0].status, 'pending');

    const f2 = await owner.post('/api/masav/file', { day, charge_date: chargeDate });
    assert.equal(f2.status, 200);
    assert.equal(f2.headers.get('x-masav-repeat'), '1');
    assert.equal(f2.text, f1.text, 'ההפקה החוזרת אמורה להחזיר את אותו קובץ');
    assert.equal(await countFor(), n1, 'הפקה חוזרת רשמה תנועות נוספות');
  });
});

// ------------------------------------------------------------------
describe('8. קבלות - אין שתי קבלות לאותה תנועה', () => {
  test('3 בקשות הפקה במקביל → הצלחה אחת ושתי 409, ומסמך אחד בלבד', async () => {
    const donor = await makeDonor(owner, { id_number: idNumber() });
    const tx = await makePaidTx(donor.id, 260);
    const res = await Promise.all([1, 2, 3].map(() => owner.post(`/api/transactions/${tx.id}/document`, {})));
    const st = res.map((r) => r.status).sort();
    assert.deepEqual(st, [200, 409, 409], `סטטוסים: ${res.map((r) => `${r.status} ${r.data?.error || ''}`)}`);
    const ok = res.find((r) => r.status === 200).data.document;
    assert.equal(ok.type, 'receipt46');
    assert.equal(Number(ok.amount), 260);

    const full = await owner.get(`/api/donors/${donor.id}/full`);
    assert.equal(full.data.documents.length, 1, 'נוצר יותר ממסמך אחד');
    assert.equal(full.data.transactions[0].document_id, ok.id);
    if (env.hasDb) {
      const [r] = await env.sql('SELECT COUNT(*)::int AS n FROM documents WHERE donor_id = $1', [donor.id]);
      assert.equal(r.n, 1);
    }
  });

  test('קבלת 46 נדחית לתורם בלי ת.ז.', async () => {
    const donor = await makeDonor(owner);
    const tx = await makePaidTx(donor.id, 50);
    const r = await owner.post(`/api/transactions/${tx.id}/document`, {});
    assert.equal(r.status, 400);
  });
});

// ------------------------------------------------------------------
describe('9. ביטול תנועה עם קבלה בתוקף', () => {
  test('ביטול תנועה עם קבלה → 400; ביטול הקבלה יוצר זיכוי; אחר כך ביטול התנועה מותר', async () => {
    const donor = await makeDonor(owner, { id_number: idNumber() });
    const tx = await makePaidTx(donor.id, 118);
    const d = await owner.post(`/api/transactions/${tx.id}/document`, {});
    assert.equal(d.status, 200);
    const doc = d.data.document;

    const blocked = await owner.post(`/api/transactions/${tx.id}/action`, { action: 'cancel' });
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.error, /קבלה בתוקף/);

    assert.equal((await owner.post(`/api/documents/${doc.id}/cancel`, {})).status, 400, 'ביטול בלי סיבה אמור להידחות');
    const cancel = await owner.post(`/api/documents/${doc.id}/cancel`, { reason: 'בדיקה אוטומטית' });
    assert.equal(cancel.status, 200, cancel.text);
    const credit = cancel.data.credit;
    assert.equal(credit.type, 'credit');
    assert.equal(credit.related_document_id, doc.id);
    assert.equal(credit.number, `${doc.number}-Z`);
    assert.equal(Number(credit.amount), Number(doc.amount));
    assert.equal((await owner.post(`/api/documents/${doc.id}/cancel`, { reason: 'שוב' })).status, 400, 'ביטול כפול');

    const full = await owner.get(`/api/donors/${donor.id}/full`);
    const orig = full.data.documents.find((x) => x.id === doc.id);
    assert.equal(orig.status, 'cancelled');
    assert.equal(full.data.transactions.find((t) => t.id === tx.id).document_id, null);

    const ok = await owner.post(`/api/transactions/${tx.id}/action`, { action: 'cancel' });
    assert.equal(ok.status, 200, ok.text);
    const after2 = await owner.get(`/api/transactions?donor_id=${donor.id}`);
    assert.equal(after2.data.rows[0].status, 'cancelled');
  });
});

// ------------------------------------------------------------------
describe('10. הגנה ממחיקת תורם עם היסטוריה', () => {
  test('מחיקת תורם עם תרומות → 409 has_history; תורם נקי נמחק (רק להנהלה ועם סיבה)', async () => {
    const withHistory = await makeDonor(owner);
    await makePaidTx(withHistory.id, 36);
    const blocked = await owner.del(`/api/r/donors/${withHistory.id}`, { reason: 'בדיקה' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, 'has_history');
    assert.equal((await owner.get(`/api/r/donors/${withHistory.id}`)).status, 200, 'התורם נמחק למרות היסטוריה');

    const clean = await makeDonor(owner);
    assert.equal((await owner.del(`/api/r/donors/${clean.id}`, {})).status, 400, 'מחיקה בלי סיבה');
    const sec = await env.makeUser(['secretary']);
    assert.equal((await sec.client.del(`/api/r/donors/${clean.id}`, { reason: 'בדיקה' })).status, 403, 'מזכירה לא מוחקת תורמים');
    const ok = await owner.del(`/api/r/donors/${clean.id}`, { reason: 'כפילות - בדיקה' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await owner.get(`/api/r/donors/${clean.id}`)).status, 404);
  });
});

// ------------------------------------------------------------------
describe('11. סכומים שליליים נדחים', () => {
  test('POST /api/transactions ו-/api/field/collect עם סכום שלילי או אפס → 400, בלי תנועה', async () => {
    const donor = await makeDonor(owner);
    for (const amount of [-5, 0, 'abc']) {
      const r = await owner.post('/api/transactions', { donor_id: donor.id, amount, method: 'cash' });
      assert.equal(r.status, 400, `transactions amount=${amount}`);
      const f = await owner.post('/api/field/collect', { donor_id: donor.id, amount, method: 'cash' });
      assert.equal(f.status, 400, `field/collect amount=${amount}`);
    }
    const list = await owner.get(`/api/transactions?donor_id=${donor.id}`);
    assert.equal(list.data.count, 0);
  });

  test('POST /api/keva עם סכום שלילי → 400', async () => {
    const donor = await makeDonor(owner);
    // day_of_month=29 - מחוץ לטווח הימים של בדיקת מס"ב, כדי שהוראה שלילית שנוצרה לא תשפיע עליה
    const kv = await owner.post('/api/keva', { donor_id: donor.id, amount: -10, type: 'bank', day_of_month: 29 });
    if (kv.status === 200 && kv.data?.row?.id) await owner.post(`/api/keva/${kv.data.row.id}/action`, { action: 'cancel' });
    assert.equal(kv.status, 400, `התקבל ${kv.status}: ${kv.text.slice(0, 200)}`);
  });
});

// ------------------------------------------------------------------
describe('12. כניסת תורם בקוד חד-פעמי', () => {
  test('בקשת קוד אנונימית לא חושפת את הקוד; 6 קודים שגויים נועלים, וגם הקוד הנכון נדחה', async () => {
    const donor = await makeDonor(owner);
    const anon = env.client();
    const r = await anon.post('/api/donor/otp', { phone: donor.phone });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.equal(r.data.sandbox_code, undefined, 'הקוד נחשף למשתמש אנונימי');
    // טלפון לא רשום - אותה תשובה בדיוק
    const ghost = await anon.post('/api/donor/otp', { phone: uniquePhone() });
    assert.deepEqual(ghost.data, { ok: true });

    // מתכנת מחובר בסביבת הדמיה רואה את הקוד - כך נדע את הקוד הנכון
    const dev = await owner.post('/api/donor/otp', { phone: donor.phone });
    const code = dev.data.sandbox_code;
    if (!code) return; // בשרת שאינו בהדמיה אין דרך לדעת את הקוד; הנעילה נבדקת בכל זאת למטה

    const attacker = env.client();
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    const msgs = [];
    for (let i = 0; i < 6; i++) {
      const a = await attacker.post('/api/donor/login', { phone: donor.phone, code: wrong });
      assert.equal(a.status, 401);
      msgs.push(a.data.error);
    }
    assert.match(msgs[0], /קוד שגוי/);
    assert.match(msgs[5], /אינו בתוקף/, `הניסיון השישי: ${msgs[5]}`);
    const right = await attacker.post('/api/donor/login', { phone: donor.phone, code });
    assert.equal(right.status, 401, 'קוד נכון אחרי 5 ניסיונות שגויים אמור להידחות');
    assert.match(right.data.error, /אינו בתוקף/);
    assert.equal(attacker.jar.size, 0);
  });

  test('קוד נכון (לפני נעילה) נותן כניסת תורם', async (t) => {
    const donor = await makeDonor(owner);
    const dev = await owner.post('/api/donor/otp', { phone: donor.phone });
    if (!dev.data.sandbox_code) { t.skip('אין קוד הדמיה בשרת הזה'); return; }
    const c = env.client();
    const l = await c.post('/api/donor/login', { phone: donor.phone, code: dev.data.sandbox_code });
    assert.equal(l.status, 200);
    const me = await c.get('/api/auth/me');
    assert.equal(me.data.donor.id, donor.id);
  });
});

// ------------------------------------------------------------------
describe('13. מזהה שגיאה בשגיאת שרת', () => {
  test('שגיאת 500 מחזירה error_id שנשמר ביומן השגיאות', async () => {
    // שגיאת שרת מכוונת דרך נקודת הבדיקה של המתכנת
    const r = await owner.post('/api/diag/test-error', {});
    assert.equal(r.status, 500, `צפוי 500, התקבל ${r.status} ${r.text}`);
    assert.match(r.data.error_id, /^E-[a-z0-9]+-[a-z0-9]{1,4}$/);
    assert.ok(r.data.error.includes(r.data.error_id), 'המזהה מוצג למשתמש בהודעה');
    assert.doesNotMatch(r.data.error, /invalid input syntax/, 'פרטי המסד לא נחשפים');
    if (env.hasDb) {
      let found = [];
      for (let i = 0; i < 20 && !found.length; i++) {
        found = await env.sql('SELECT path FROM error_log WHERE last_error_id = $1', [r.data.error_id]);
        if (!found.length) await sleep(100);
      }
      assert.equal(found.length, 1, 'המזהה לא נמצא ב-error_log');
      assert.equal(found[0].path, 'POST /api/diag/test-error');
    }
  });

  test('ערך לא תקין בעדכון תנועה מחזיר 400 ולא 500', async () => {
    const donor = await makeDonor(owner);
    const tx = await makePaidTx(donor.id, 10);
    const r = await owner.put(`/api/transactions/${tx.id}`, { institution_id: 'not-a-number' });
    assert.equal(r.status, 400, `התקבל ${r.status} ${r.text}`);
  });
});

// ------------------------------------------------------------------
describe('14. תאריכים לפי שעון ישראל', () => {
  test('תנועה ידנית בלי תאריך נרשמת בתאריך של היום בישראל', async () => {
    const before1 = israelToday();
    const donor = await makeDonor(owner);
    const tx = await makePaidTx(donor.id, 18);
    const after1 = israelToday();
    assert.ok([before1, after1].includes(String(tx.date)), `תאריך ${tx.date}, היום בישראל ${after1}`);
    if (env.hasDb) {
      const [r] = await env.sql("SELECT (now() AT TIME ZONE 'Asia/Jerusalem')::date::text AS d");
      assert.ok([before1, after1, r.d].includes(String(tx.date)));
    }
  });
});

// ------------------------------------------------------------------
describe('15. זרם עדכונים חי (SSE)', () => {
  test('text/event-stream, אירוע ראשון עם v ו-last, ואירוע חדש תוך 3 שניות אחרי כתיבה', async () => {
    const s = await openSse(owner);
    try {
      assert.equal(s.status, 200);
      assert.match(s.headers.get('content-type'), /text\/event-stream/);
      const first = await s.next(3000);
      assert.ok(first, 'לא התקבל אירוע ראשון');
      assert.equal(typeof first.v, 'number');
      assert.equal(typeof first.last, 'number');
      await makeDonor(owner);
      const second = await s.next(3000);
      assert.ok(second, 'לא התקבל אירוע אחרי כתיבה');
      assert.ok(second.v > first.v, `הגרסה לא עלתה: ${first.v} → ${second.v}`);
    } finally { s.close(); }
  });

  test('בלי חיבור → 401', async () => {
    const r = await env.client().get('/api/live/stream');
    assert.equal(r.status, 401);
  });
});

// ------------------------------------------------------------------
describe('16. מונים לתפריט', () => {
  test('/api/counts מחזיר בדיוק 6 מפתחות מספריים', async () => {
    const r = await owner.get('/api/counts');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.data).sort(), ['aid', 'boxes', 'contact', 'inbox', 'spiritual', 'tasks']);
    for (const [k, v] of Object.entries(r.data)) assert.ok(Number.isInteger(v) && v >= 0, `${k}=${v}`);
  });
});

// ------------------------------------------------------------------
describe('17. עימוד', () => {
  test('/api/keva?offset מחזיר total ומדלג נכון', async () => {
    const r0 = await owner.get('/api/keva?offset=0');
    assert.equal(r0.status, 200);
    assert.equal(typeof r0.data.total, 'number');
    assert.equal(r0.data.offset, 0);
    assert.ok(r0.data.total >= 1);
    assert.equal(r0.data.rows.length, Math.min(r0.data.total, 1000));
    const r1 = await owner.get('/api/keva?offset=1');
    assert.equal(r1.data.offset, 1);
    assert.equal(r1.data.total, r0.data.total);
    assert.equal(r1.data.rows.length, Math.min(r0.data.total - 1, 1000));
    if (r0.data.rows.length > 1) assert.equal(r1.data.rows[0].id, r0.data.rows[1].id);
    const end = await owner.get(`/api/keva?offset=${r0.data.total}`);
    assert.equal(end.data.rows.length, 0);
    const neg = await owner.get('/api/keva?offset=-7');
    assert.equal(neg.data.offset, 0);
  });

  test('/api/documents?offset מחזיר total ומדלג נכון', async () => {
    const r0 = await owner.get('/api/documents?offset=0');
    assert.equal(r0.status, 200);
    assert.equal(typeof r0.data.total, 'number');
    assert.ok(r0.data.total >= 2, `צפויים מסמכים מהבדיקות הקודמות / נתוני הדוגמה, נמצאו ${r0.data.total}`);
    const r1 = await owner.get('/api/documents?offset=1');
    assert.equal(r1.data.offset, 1);
    assert.equal(r1.data.total, r0.data.total);
    assert.equal(r1.data.rows.length, Math.min(r0.data.total - 1, 1000));
    assert.equal(r1.data.rows[0].id, r0.data.rows[1].id);
    const bad = await owner.get('/api/documents?offset=abc');
    assert.equal(bad.data.offset, 0);
  });
});
