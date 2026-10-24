// זיכויי חברות כרטיסי האשראי (ישראכרט, כאל, מקס): קליטת דוח זיכויים, התאמה לתרומות ומעקב מה הגיע לבנק.
// אין לחברות האלה API פתוח לעמותות - הדוח מורד מאתר בית העסק ומועלה כאן (CSV).
import { query, one, many } from '../lib/db.js';
import { HttpError } from '../lib/router.js';
import { requirePerm } from '../auth.js';
import { audit } from '../audit.js';
import { getProvider } from '../providers/registry.js';

export const ACQUIRERS = ['isracard', 'cal', 'max'];
const DONOR_LABEL = "TRIM(COALESCE(d.title || ' ','') || COALESCE(d.first_name,'') || ' ' || COALESCE(d.last_name,''))";

// זיהוי עמודות לפי כותרות נפוצות בדוחות של חברות האשראי (עברית ואנגלית)
const COLS = {
  transaction_date: ['תאריך עסקה', 'תאריך העסקה', 'תאריך רכישה', 'transaction date', 'date'],
  deposit_date: ['תאריך זיכוי', 'תאריך תשלום', 'מועד זיכוי', 'תאריך ערך', 'deposit date', 'payment date', 'value date'],
  amount_gross: ['סכום עסקה', 'סכום העסקה', 'סכום מקורי', 'סכום ברוטו', 'סכום', 'amount', 'gross'],
  fee: ['עמלה', 'עמלת סליקה', 'דמי ניכיון', 'עמלות', 'fee', 'commission'],
  amount_net: ['סכום לזיכוי', 'סכום נטו', 'סכום זיכוי', 'סכום לתשלום', 'net', 'net amount'],
  card_last4: ['4 ספרות', 'ספרות אחרונות', 'מספר כרטיס', 'כרטיס', 'card', 'card number', 'last 4'],
  card_brand: ['מותג', 'סוג כרטיס', 'brand', 'card type'],
  approval_number: ['מספר אישור', 'אישור', 'approval', 'auth code'],
  voucher_number: ['מספר שובר', 'שובר', 'אסמכתא', 'voucher', 'reference'],
  installments: ['מספר תשלומים', 'תשלומים', 'installments'],
  terminal: ['מסוף', 'מספר מסוף', 'terminal'],
  currency: ['מטבע', 'currency'],
};

function norm(s) { return String(s || '').replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }

export function mapRow(raw) {
  const keys = Object.keys(raw);
  const out = {};
  for (const [field, names] of Object.entries(COLS)) {
    const k = keys.find((h) => names.some((n) => norm(h) === norm(n))) || keys.find((h) => names.some((n) => norm(h).includes(norm(n))));
    if (k !== undefined) out[field] = raw[k];
  }
  return out;
}

function toDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/); // 24/10/2026
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function toNum(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[₪$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : 0;
}
function last4(v) { const d = String(v || '').replace(/\D/g, ''); return d ? d.slice(-4) : null; }

// התאמה אוטומטית: אותו סכום, תאריך עסקה עד 3 ימים, 4 ספרות אם קיימות, תנועת אשראי שעוד לא הותאמה
export async function autoMatch(settlementId) {
  const s = await one('SELECT * FROM settlements WHERE id = $1', [settlementId]);
  if (!s || s.transaction_id) return null;
  const params = [s.amount_gross, s.transaction_date || s.deposit_date];
  let cardCond = '';
  if (s.card_last4) { params.push(s.card_last4); cardCond = `AND (t.card_last4 IS NULL OR t.card_last4 = $${params.length})`; }
  const cands = await many(`SELECT t.id, t.card_last4 FROM transactions t
    WHERE t.method IN ('credit','bit') AND t.status IN ('paid','refunded') AND ABS(t.amount_ils - $1) < 0.01
    AND t.date BETWEEN ($2::date - 3) AND ($2::date + 3) ${cardCond}
    AND NOT EXISTS (SELECT 1 FROM settlements x WHERE x.transaction_id = t.id)
    ORDER BY (t.card_last4 IS NOT NULL) DESC, ABS(t.date - $2::date) LIMIT 2`, params);
  // התאמה רק כשיש מועמד אחד ברור (או שהראשון תואם גם ב-4 ספרות)
  const pick = cands.length === 1 || (cands.length > 1 && s.card_last4 && cands[0].card_last4 === s.card_last4 && cands[1].card_last4 !== s.card_last4) ? cands[0] : null;
  if (!pick) return null;
  await query("UPDATE settlements SET transaction_id = $2, match_status = 'auto' WHERE id = $1", [s.id, pick.id]);
  return pick.id;
}

export function registerSettlementRoutes(r) {
  r.get('/api/settlements', async (ctx) => {
    requirePerm(ctx, 'settlements.read');
    const q = ctx.query;
    const params = [];
    const conds = [];
    if (q.acquirer) { params.push(q.acquirer); conds.push(`s.acquirer = $${params.length}`); }
    if (q.status === 'matched') conds.push('s.transaction_id IS NOT NULL');
    if (q.status === 'unmatched') conds.push('s.transaction_id IS NULL');
    if (q.from) { params.push(q.from); conds.push(`COALESCE(s.deposit_date, s.transaction_date) >= $${params.length}`); }
    if (q.to) { params.push(q.to); conds.push(`COALESCE(s.deposit_date, s.transaction_date) <= $${params.length}`); }
    if (q.demo === 'hide') conds.push('s.is_demo = FALSE');
    if (q.demo === 'only') conds.push('s.is_demo = TRUE');
    const w = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await many(`SELECT s.*, t.serial, t.donor_id, ${DONOR_LABEL} AS donor_name, t.source AS tx_source FROM settlements s
      LEFT JOIN transactions t ON t.id = s.transaction_id LEFT JOIN donors d ON d.id = t.donor_id
      ${w} ORDER BY COALESCE(s.deposit_date, s.transaction_date) DESC, s.id DESC LIMIT 1000`, params);
    const byAcquirer = await many(`SELECT s.acquirer, COUNT(*)::int AS c, COALESCE(SUM(amount_gross),0) AS gross, COALESCE(SUM(fee),0) AS fee,
      COALESCE(SUM(amount_net),0) AS net, COUNT(*) FILTER (WHERE transaction_id IS NULL)::int AS unmatched FROM settlements s ${w} GROUP BY s.acquirer`, params);
    // תרומות אשראי שלא הגיע עליהן זיכוי (מעל 7 ימים)
    const demo = q.demo === 'hide' ? 'AND t.is_demo = FALSE' : q.demo === 'only' ? 'AND t.is_demo = TRUE' : '';
    const pending = await many(`SELECT t.id, t.serial, t.date, t.amount, t.currency, t.amount_ils, t.source, t.card_last4, t.donor_id, ${DONOR_LABEL} AS donor_name
      FROM transactions t LEFT JOIN donors d ON d.id = t.donor_id
      WHERE t.method = 'credit' AND t.status = 'paid' AND t.date < CURRENT_DATE - 7 AND t.date > CURRENT_DATE - 120 ${demo}
      AND NOT EXISTS (SELECT 1 FROM settlements x WHERE x.transaction_id = t.id)
      AND EXISTS (SELECT 1 FROM settlements y)
      ORDER BY t.date DESC LIMIT 300`);
    ctx.json(200, {
      rows, byAcquirer, pending,
      acquirers: ACQUIRERS.map((k) => ({ key: k, label: getProvider(k)?.label || k, portal: getProvider(k)?.portal })),
    });
  });

  // קליטת דוח: השורות מפוענחות בצד הלקוח מ-CSV, השרת ממפה עמודות, מונע כפילויות ומתאים
  r.post('/api/settlements/import', async (ctx) => {
    requirePerm(ctx, 'settlements.write');
    const acquirer = ctx.body.acquirer;
    if (!ACQUIRERS.includes(acquirer)) throw new HttpError(400, 'יש לבחור חברת אשראי');
    const rows = (ctx.body.rows || []).slice(0, 20000);
    if (!rows.length) throw new HttpError(400, 'הקובץ ריק');
    const batch = `${acquirer}-${Date.now().toString(36)}`;
    let added = 0; let duplicates = 0; let skipped = 0; let matched = 0;
    const sample = mapRow(rows[0]);
    if (sample.amount_gross === undefined && sample.amount_net === undefined) {
      throw new HttpError(400, `לא זוהתה עמודת סכום. כותרות בקובץ: ${Object.keys(rows[0]).join(', ')}`);
    }
    for (const raw of rows) {
      const m = mapRow(raw);
      const gross = toNum(m.amount_gross ?? m.amount_net);
      if (!gross) { skipped++; continue; }
      const fee = Math.abs(toNum(m.fee));
      const net = m.amount_net !== undefined ? toNum(m.amount_net) : gross - fee;
      const tDate = toDate(m.transaction_date);
      const dDate = toDate(m.deposit_date);
      if (!tDate && !dDate) { skipped++; continue; }
      const row = await one(`INSERT INTO settlements (acquirer, batch, transaction_date, deposit_date, amount_gross, fee, amount_net, currency, card_last4, card_brand,
        approval_number, voucher_number, installments, terminal, raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT DO NOTHING RETURNING id`, [acquirer, batch, tDate, dDate, gross, fee, net, m.currency || 'ILS', last4(m.card_last4), m.card_brand || null,
        m.approval_number ? String(m.approval_number) : null, m.voucher_number ? String(m.voucher_number) : null, parseInt(m.installments, 10) || 1, m.terminal ? String(m.terminal) : null, raw]);
      if (!row) { duplicates++; continue; }
      added++;
      if (await autoMatch(row.id)) matched++;
    }
    await query("UPDATE providers SET last_sync_at = now(), last_status = 'ok' WHERE key = $1", [acquirer]);
    await audit(ctx.user, 'settlements_import', 'settlements', batch, { acquirer, added, duplicates, skipped, matched });
    ctx.json(200, { batch, added, duplicates, skipped, matched, unmatched: added - matched });
  });

  r.post('/api/settlements/rematch', async (ctx) => {
    requirePerm(ctx, 'settlements.write');
    const ids = await many('SELECT id FROM settlements WHERE transaction_id IS NULL ORDER BY id LIMIT 5000');
    let matched = 0;
    for (const { id } of ids) if (await autoMatch(id)) matched++;
    ctx.json(200, { matched, checked: ids.length });
  });

  r.get('/api/settlements/:id/candidates', async (ctx) => {
    requirePerm(ctx, 'settlements.read');
    const s = await one('SELECT * FROM settlements WHERE id = $1', [ctx.params.id]);
    if (!s) throw new HttpError(404, 'לא נמצא');
    const rows = await many(`SELECT t.id, t.serial, t.date, t.amount, t.currency, t.amount_ils, t.source, t.card_last4, ${DONOR_LABEL} AS donor_name
      FROM transactions t LEFT JOIN donors d ON d.id = t.donor_id
      WHERE t.method IN ('credit','bit') AND ABS(t.amount_ils - $1) <= GREATEST(1, $1 * 0.05)
      AND t.date BETWEEN ($2::date - 10) AND ($2::date + 10)
      AND NOT EXISTS (SELECT 1 FROM settlements x WHERE x.transaction_id = t.id)
      ORDER BY ABS(t.amount_ils - $1), ABS(t.date - $2::date) LIMIT 20`, [s.amount_gross, s.transaction_date || s.deposit_date]);
    ctx.json(200, { rows });
  });

  r.post('/api/settlements/:id/match', async (ctx) => {
    requirePerm(ctx, 'settlements.write');
    const txId = ctx.body.transaction_id ? Number(ctx.body.transaction_id) : null;
    if (txId) {
      const used = await one('SELECT id FROM settlements WHERE transaction_id = $1 AND id <> $2', [txId, ctx.params.id]);
      if (used) throw new HttpError(409, 'התרומה כבר מותאמת לזיכוי אחר');
    }
    await query('UPDATE settlements SET transaction_id = $2, match_status = $3, matched_by = $4 WHERE id = $1',
      [ctx.params.id, txId, txId ? 'manual' : 'unmatched', ctx.user.id]);
    await audit(ctx.user, txId ? 'settlement_match' : 'settlement_unmatch', 'settlement', ctx.params.id, { transaction_id: txId });
    ctx.json(200, { ok: true });
  });

  r.delete('/api/settlements/batch/:batch', async (ctx) => {
    requirePerm(ctx, 'settlements.write');
    const r0 = await query('DELETE FROM settlements WHERE batch = $1', [ctx.params.batch]);
    await audit(ctx.user, 'settlements_batch_delete', 'settlements', ctx.params.batch, { count: r0.rowCount });
    ctx.json(200, { deleted: r0.rowCount });
  });
}
