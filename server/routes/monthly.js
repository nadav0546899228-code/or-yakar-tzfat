// חיובים חודשיים יזומים: בכל חודש בוחרים ידנית את מי לחייב מבין התורמים שיש להם כרטיס שמור (טוקן אצל הספק).
// אין כאן הוראת קבע אוטומטית: שום חיוב לא יוצא בלי שמשתמש מורשה סימן ואישר אותו.
import { query, one, many, insert } from '../lib/db.js';
import { israelDay, israelMonth } from '../lib/dates.js';
import { HttpError } from '../lib/router.js';
import { requirePerm } from '../auth.js';
import { audit } from '../audit.js';
import { isSandbox } from '../env.js';
import { recordTransaction, issueDocument, chargeToken, cardExpState, tokenChargeIsSimulated } from '../providers/engine.js';

const DONOR_LABEL = "TRIM(COALESCE(d.title || ' ','') || COALESCE(d.first_name,'') || ' ' || COALESCE(d.last_name,''))";
const MAX_ITEMS = 500;

function currentMonth() { return israelMonth(); }

function checkMonth(m) {
  const month = String(m || currentMonth());
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'חודש לא תקין');
  return month;
}

function scopeConds(ctx, params, conds) {
  if (ctx.user.active_role === 'institution_manager') { params.push(ctx.user.institution_id || -1); conds.push(`s.institution_id = $${params.length}`); }
  if (ctx.query.demo === 'hide') conds.push('s.is_demo = FALSE');
  if (ctx.query.demo === 'only') conds.push('s.is_demo = TRUE');
}

async function chargeOne(so, { month, amount, batch, issueDoc, user }) {
  // רישום הפריט לפני הפנייה לספק. האינדקס הייחודי חוסם חיוב שני של אותה הו"ק באותו חודש
  let item;
  try {
    item = await insert('charge_batch_items', {
      batch_id: batch.id, batch_month: month, standing_order_id: so.id, donor_id: so.donor_id, amount, currency: so.currency,
      status: 'processing', is_demo: so.is_demo,
    });
  } catch (e) {
    if (e.code !== '23505') throw e;
    return { status: 'skipped', message: 'כבר חויב החודש (או שחיוב נמצא בתהליך)' };
  }
  const paid = await one(`SELECT id FROM transactions WHERE standing_order_id = $1 AND status = 'paid' AND to_char(date, 'YYYY-MM') = $2 LIMIT 1`, [so.id, month]);
  if (paid) {
    await query("UPDATE charge_batch_items SET status = 'skipped', error_message = $2, transaction_id = $3 WHERE id = $1", [item.id, 'כבר קיים חיוב ששולם החודש', paid.id]);
    return { status: 'skipped', message: 'כבר קיים חיוב ששולם החודש' };
  }

  let res;
  try {
    res = await chargeToken(so, { amount, currency: so.currency, month, description: `תרומה חודשית ${month}` });
  } catch (e) {
    res = { ok: false, message: e.message };
  }

  const { row: tx } = await recordTransaction({
    donor_id: so.donor_id, source: so.source, external_id: `MB-${item.id}`, kind: 'keva', method: 'credit', amount, currency: so.currency,
    status: res.ok ? 'paid' : 'failed', failure_reason: res.ok ? null : String(res.message || 'החיוב נדחה').slice(0, 200),
    institution_id: so.institution_id, purpose_id: so.purpose_id, campaign_id: so.campaign_id, standing_order_id: so.id,
    recruiter_user_id: so.recruiter_user_id, card_last4: so.card_last4,
    notes: `חיוב חודשי יזום ${month}${res.simulated ? ' (הדמיה)' : ''}`,
    raw: { batch_id: batch.id, item_id: item.id, confirmation: res.confirmation || null, simulated: !!res.simulated },
  }, user, { isDemo: so.is_demo });

  if (!res.ok) {
    await query("UPDATE charge_batch_items SET status = 'failed', error_message = $2, transaction_id = $3 WHERE id = $1", [item.id, res.message, tx.id]);
    if (!res.not_configured) {
      await query("UPDATE standing_orders SET failures = failures + 1, status = CASE WHEN $2 THEN 'failed' ELSE status END WHERE id = $1", [so.id, !!res.permanent]);
    }
    return { status: 'failed', message: res.message, transaction_id: tx.id };
  }

  await query("UPDATE standing_orders SET last_charge_date = CURRENT_DATE, months_paid = months_paid + 1, failures = 0, status = 'active' WHERE id = $1", [so.id]);
  let documentId = null;
  let docError = null;
  if (issueDoc) {
    try { documentId = (await issueDocument({ transactionId: tx.id, type: 'receipt46' }, user)).id; } catch (e) { docError = e.message; }
  }
  await query("UPDATE charge_batch_items SET status = 'success', confirmation = $2, transaction_id = $3, document_id = $4, error_message = $5 WHERE id = $1",
    [item.id, res.confirmation || null, tx.id, documentId, docError ? `החיוב עבר. קבלה לא הופקה: ${docError}` : null]);
  return { status: 'success', confirmation: res.confirmation, transaction_id: tx.id };
}

async function batchDetails(id) {
  const batch = await one('SELECT b.*, u.name AS created_by_name FROM charge_batches b LEFT JOIN users u ON u.id = b.created_by WHERE b.id = $1', [id]);
  if (!batch) throw new HttpError(404, 'סבב החיוב לא נמצא');
  const items = await many(`SELECT i.*, ${DONOR_LABEL} AS donor_name, d.phone AS donor_phone, s.card_last4, s.source,
      doc.number AS document_number
    FROM charge_batch_items i LEFT JOIN donors d ON d.id = i.donor_id LEFT JOIN standing_orders s ON s.id = i.standing_order_id
    LEFT JOIN documents doc ON doc.id = i.document_id
    WHERE i.batch_id = $1 ORDER BY CASE i.status WHEN 'failed' THEN 0 WHEN 'skipped' THEN 1 ELSE 2 END, i.id`, [id]);
  return { batch, items };
}

async function processBatch(batch, items, byId, { month, issueDoc, user }) {
  const totals = { success: 0, failed: 0, skipped: 0, amount: 0 };
  const seen = new Set();
  try {
    for (const it of items) {
      const so = byId[Number(it.so_id)];
      if (!so || seen.has(so.id)) continue;
      seen.add(so.id);
      const amount = Math.round(Number(it.amount ?? so.amount) * 100) / 100;
      let res;
      if (so.type !== 'credit' || !['active', 'failed'].includes(so.status)) res = { status: 'skipped' };
      else if (!(amount > 0) || amount > 100000) res = { status: 'skipped' };
      else {
        try { res = await chargeOne(so, { month, amount, batch, issueDoc, user }); } catch (e) { res = { status: 'failed', message: e.message }; }
      }
      totals[res.status] = (totals[res.status] || 0) + 1;
      if (res.status === 'success') totals.amount = Math.round((totals.amount + amount) * 100) / 100;
      // עדכון התקדמות שוטף - המסך מציג כמה כבר טופלו
      await query('UPDATE charge_batches SET total_success = $2, total_failed = $3, total_skipped = $4, amount_success = $5 WHERE id = $1',
        [batch.id, totals.success, totals.failed, totals.skipped, totals.amount]);
      if (!tokenChargeIsSimulated(so)) await new Promise((ok) => setTimeout(ok, 300)); // קצב מתון מול הספק
    }
  } finally {
    await query(`UPDATE charge_batches SET status = 'completed', finished_at = now(), total_success = $2, total_failed = $3, total_skipped = $4, amount_success = $5 WHERE id = $1`,
      [batch.id, totals.success, totals.failed, totals.skipped, totals.amount]);
    await audit(user, 'monthly_charge_run', 'charge_batch', batch.id, { month, selected: batch.total_selected, ...totals });
  }
}

// בהפעלת השרת: סבב שנשאר "בתהליך" יותר מחצי שעה נקטע (השרת הופעל מחדש). פריטים באמצע נשארים חסומים לחיוב חוזר עד בדיקה ידנית
export async function sweepInterruptedBatches() {
  const rows = await many(`UPDATE charge_batches SET status = 'interrupted', finished_at = now()
    WHERE status = 'processing' AND created_at < now() - interval '30 minutes' RETURNING id`);
  if (!rows.length) return;
  await query(`UPDATE charge_batch_items SET error_message = 'הסבב נקטע באמצע - יש לבדוק מול הספק אם החיוב עבר ולסמן'
    WHERE status = 'processing' AND batch_id = ANY($1::int[])`, [rows.map((x) => x.id)]);
  console.warn(`[monthly-charges] ${rows.length} סבבים סומנו כנקטעים`);
}

export function registerMonthlyRoutes(r) {
  // רשימת התורמים לחיוב בחודש הנבחר
  r.get('/api/monthly-charges', async (ctx) => {
    requirePerm(ctx, 'keva.read');
    const month = checkMonth(ctx.query.month);
    const params = [month];
    const conds = ["s.type = 'credit'", 's.token_ref IS NOT NULL', "s.status IN ('active', 'failed')"];
    if (ctx.query.scope !== 'all') conds.push("s.charge_mode = 'manual'");
    scopeConds(ctx, params, conds);
    const rows = await many(`SELECT s.id, s.donor_id, s.source, s.amount, s.currency, s.card_last4, s.card_exp, s.status, s.failures, s.charge_mode,
        s.last_charge_date, s.institution_id, s.is_demo, s.notes, ${DONOR_LABEL} AS donor_name, d.phone AS donor_phone, i.name AS institution_name,
        (SELECT t.id FROM transactions t WHERE t.standing_order_id = s.id AND t.status = 'paid' AND to_char(t.date, 'YYYY-MM') = $1 LIMIT 1) AS paid_tx_id,
        (SELECT ci.status FROM charge_batch_items ci WHERE ci.standing_order_id = s.id AND ci.batch_month <> $1 ORDER BY ci.id DESC LIMIT 1) AS prev_status
      FROM standing_orders s LEFT JOIN donors d ON d.id = s.donor_id LEFT JOIN institutions i ON i.id = s.institution_id
      WHERE ${conds.join(' AND ')}
      ORDER BY ${DONOR_LABEL}`, params);
    const out = rows.map((x) => ({ ...x, exp_state: cardExpState(x.card_exp, month), simulated: tokenChargeIsSimulated({ ...x, token_ref: 'x' }) }));
    const batches = await many(`SELECT b.*, u.name AS created_by_name FROM charge_batches b LEFT JOIN users u ON u.id = b.created_by
      WHERE b.batch_month = $1 ORDER BY b.id DESC LIMIT 20`, [month]);
    ctx.json(200, { month, rows: out, batches, sandbox: isSandbox() });
  });

  // ביצוע חיוב לנבחרים
  r.post('/api/monthly-charges/run', async (ctx) => {
    requirePerm(ctx, 'keva.actions');
    const b = ctx.body || {};
    const month = checkMonth(b.month);
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) throw new HttpError(400, 'לא נבחרו תורמים לחיוב');
    if (items.length > MAX_ITEMS) throw new HttpError(400, `אפשר לחייב עד ${MAX_ITEMS} תורמים בסבב אחד`);
    const ids = [...new Set(items.map((x) => Number(x.so_id)).filter(Boolean))];
    const sos = await many(`SELECT * FROM standing_orders WHERE id = ANY($1::int[])`, [ids]);
    const byId = Object.fromEntries(sos.map((s) => [s.id, s]));
    if (ctx.user.active_role === 'institution_manager' && sos.some((s) => s.institution_id !== ctx.user.institution_id)) throw new HttpError(403, 'אין הרשאה לחייב תורמים של מוסד אחר');

    const batch = await insert('charge_batches', {
      batch_month: month, status: 'processing', issue_documents: !!b.issue_documents, total_selected: ids.length,
      sandbox: isSandbox(), created_by: ctx.user.id, is_demo: sos.length > 0 && sos.every((s) => s.is_demo),
    });
    // הסבב רץ ברקע: התשובה חוזרת מיד, והמסך מציג התקדמות. כך סבב גדול לא נקטע בגלל זמן המתנה של הדפדפן או השרת
    const user = ctx.user;
    setImmediate(() => { processBatch(batch, items, byId, { month, issueDoc: !!b.issue_documents, user }).catch((e) => console.error('[monthly-charges]', e)); });
    ctx.json(200, await batchDetails(batch.id));
  });

  // פריט שנשאר "בתהליך" (למשל אם השרת הופעל מחדש באמצע): אחרי בדיקה מול הספק, מסמנים ידנית אם עבר או לא
  r.post('/api/monthly-charges/items/:id/resolve', async (ctx) => {
    requirePerm(ctx, 'keva.actions');
    const outcome = ctx.body?.outcome;
    if (!['failed', 'success'].includes(outcome)) throw new HttpError(400, 'יש לבחור אם החיוב עבר או לא');
    const item = await one('SELECT * FROM charge_batch_items WHERE id = $1', [Number(ctx.params.id)]);
    if (!item) throw new HttpError(404, 'הפריט לא נמצא');
    if (item.status !== 'processing') throw new HttpError(409, 'הפריט כבר אינו בתהליך');
    const note = outcome === 'success' ? 'סומן ידנית כעבר (אחרי בדיקה מול הספק)' : 'סומן ידנית כלא עבר - אפשר לחייב שוב';
    await query('UPDATE charge_batch_items SET status = $2, error_message = $3 WHERE id = $1', [item.id, outcome, note]);
    await audit(ctx.user, 'monthly_charge_resolve', 'charge_batch_item', item.id, { outcome, batch_id: item.batch_id });
    ctx.json(200, { ok: true, message: note });
  });

  r.get('/api/monthly-charges/batches/:id', async (ctx) => {
    requirePerm(ctx, 'keva.read');
    ctx.json(200, await batchDetails(Number(ctx.params.id)));
  });

  // היסטוריית סבבים (כל החודשים)
  r.get('/api/monthly-charges/history', async (ctx) => {
    requirePerm(ctx, 'keva.read');
    const rows = await many(`SELECT b.*, u.name AS created_by_name FROM charge_batches b LEFT JOIN users u ON u.id = b.created_by ORDER BY b.id DESC LIMIT 100`);
    ctx.json(200, { rows });
  });

  // משימות מוקד לכל מי שהחיוב שלו נכשל בסבב
  r.post('/api/monthly-charges/batches/:id/call-tasks', async (ctx) => {
    requirePerm(ctx, 'keva.actions');
    const { items } = await batchDetails(Number(ctx.params.id));
    let created = 0;
    for (const it of items.filter((x) => x.status === 'failed' && x.donor_id)) {
      const open = await one("SELECT id FROM call_tasks WHERE donor_id = $1 AND reason = 'failed_charge' AND status IN ('open', 'callback') LIMIT 1", [it.donor_id]);
      if (open) continue;
      await insert('call_tasks', {
        donor_id: it.donor_id, reason: 'failed_charge', priority: 1, due_date: israelDay(),
        standing_order_id: it.standing_order_id, notes: `חיוב חודשי ${it.batch_month} נכשל: ${it.error_message || ''}`.slice(0, 300), is_demo: it.is_demo,
      });
      created++;
    }
    await audit(ctx.user, 'monthly_charge_call_tasks', 'charge_batch', ctx.params.id, { created });
    ctx.json(200, { created, message: created ? `נפתחו ${created} משימות במוקד` : 'אין נכשלים חדשים לפתיחת משימה' });
  });

  // עדכון אופן החיוב, סכום ותוקף כרטיס של הו"ק
  r.post('/api/monthly-charges/so/:id', async (ctx) => {
    requirePerm(ctx, 'keva.actions');
    const b = ctx.body || {};
    const so = await one('SELECT * FROM standing_orders WHERE id = $1', [Number(ctx.params.id)]);
    if (!so) throw new HttpError(404, 'הוראה לא נמצאה');
    const data = {};
    if (b.charge_mode !== undefined) data.charge_mode = b.charge_mode === 'manual' ? 'manual' : 'auto';
    if (b.card_exp !== undefined) {
      const v = String(b.card_exp || '').trim();
      if (v && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(v)) throw new HttpError(400, 'תוקף בפורמט MM/YY, למשל 05/28');
      data.card_exp = v || null;
    }
    if (b.amount !== undefined) {
      const a = Number(b.amount);
      if (!(a > 0)) throw new HttpError(400, 'סכום לא תקין');
      data.amount = a;
    }
    const keys = Object.keys(data);
    if (!keys.length) throw new HttpError(400, 'אין מה לעדכן');
    const sets = keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
    await query(`UPDATE standing_orders SET ${sets} WHERE id = $1`, [so.id, ...keys.map((k) => data[k])]);
    await audit(ctx.user, 'monthly_charge_so_update', 'standing_order', so.id, data);
    ctx.json(200, { ok: true });
  });

  // תורמי בדיקה עם כרטיס שמור לדוגמה (רק בסביבת פיתוח)
  r.post('/api/monthly-charges/demo', async (ctx) => {
    requirePerm(ctx, 'keva.actions');
    if (!isSandbox()) throw new HttpError(400, 'תורמי בדיקה נוצרים רק בסביבת פיתוח');
    const people = [['אהרון', 'בדיקה', 100], ['בתיה', 'ניסיון', 180], ['גדעון', 'דמה', 52], ['דבורה', 'טסט', 360], ['הלל', 'בדיקה', 250], ['ורד', 'ניסיון', 36]];
    const exp = (add) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + add); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`; };
    let created = 0;
    for (let i = 0; i < people.length; i++) {
      const [first, last, amount] = people[i];
      const phone = `05000002${String(10 + i)}`;
      if (await one('SELECT id FROM donors WHERE phone = $1 AND is_demo = TRUE', [phone])) continue;
      const d = await insert('donors', { first_name: first, last_name: last, phone, id_number: '890108558', city: 'צפת', tags: ['בדיקת חיוב חודשי'], is_demo: true });
      await insert('standing_orders', {
        donor_id: d.id, source: 'nedarim', external_id: `SBX-MB-${d.id}`, type: 'credit', amount, currency: 'ILS', day_of_month: 10,
        start_date: israelDay(), status: 'active', charge_mode: 'manual', card_last4: String(4100 + i * 111).slice(-4),
        card_exp: i === 4 ? exp(-1) : i === 5 ? exp(1) : exp(24), token_ref: `SANDBOX-TOKEN-MB-${d.id}`, notes: 'תורם בדיקה לחיוב חודשי', is_demo: true,
      });
      created++;
    }
    await audit(ctx.user, 'monthly_charge_demo', 'standing_order', null, { created });
    ctx.json(200, { created, message: created ? `נוצרו ${created} תורמי בדיקה` : 'תורמי הבדיקה כבר קיימים' });
  });
}
