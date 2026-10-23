import { query, one, many, insert, update } from '../lib/db.js';
import { HttpError } from '../lib/router.js';
import { requirePerm, requireUser } from '../auth.js';
import { can } from '../roles.js';
import { audit } from '../audit.js';
import { LABEL_SQL, cleanBody } from './crud.js';
import { RESOURCES } from '../resources.js';
import {
  recordTransaction, transactionAction, kevaAction, issueDocument, cancelDocument, sendMessage, toIls,
} from '../providers/engine.js';
import { getProvider } from '../providers/registry.js';
import { isSandbox } from '../env.js';
import { normalizePhone } from '../lib/security.js';

function instScope(ctx, alias, params) {
  if (ctx.user.active_role === 'institution_manager') {
    params.push(ctx.user.institution_id || -1);
    return `${alias}.institution_id = $${params.length}`;
  }
  if (ctx.user.active_role === 'recruiter') {
    params.push(ctx.user.id);
    return `(${alias}.recruiter_user_id = $${params.length} OR ${alias}.created_by = $${params.length})`;
  }
  return null;
}

function demoClause(ctx, alias) {
  if (ctx.query.demo === 'hide') return `${alias}.is_demo = FALSE`;
  if (ctx.query.demo === 'only') return `${alias}.is_demo = TRUE`;
  return null;
}

const DONOR_LABEL = "TRIM(COALESCE(d.title || ' ','') || COALESCE(d.first_name,'') || ' ' || COALESCE(d.last_name,''))";

export function registerFinanceRoutes(r) {
  // ---------- לוח בקרה ----------
  r.get('/api/dashboard', async (ctx) => {
    requirePerm(ctx, 'staff');
    const finance = can(ctx.user, 'dashboard.finance');
    const params = [];
    const conds = ["t.status = 'paid'"];
    const sc = finance ? instScope(ctx, 't', params) : null;
    if (sc) conds.push(sc);
    const dc = demoClause(ctx, 't');
    if (dc) conds.push(dc);
    const w = `WHERE ${conds.join(' AND ')}`;
    const out = { finance };
    if (finance) {
      out.totals = await one(`SELECT
        COALESCE(SUM(amount_ils) FILTER (WHERE date = CURRENT_DATE),0) AS today,
        COALESCE(SUM(amount_ils) FILTER (WHERE date >= date_trunc('month', CURRENT_DATE)),0) AS month,
        COALESCE(SUM(amount_ils) FILTER (WHERE date >= date_trunc('year', CURRENT_DATE)),0) AS year,
        COUNT(*) FILTER (WHERE date >= date_trunc('month', CURRENT_DATE))::int AS month_count
        FROM transactions t ${w}`, params);
      out.bySource = await many(`SELECT source, COALESCE(SUM(amount_ils),0) AS total, COUNT(*)::int AS c FROM transactions t ${w}
        AND date >= date_trunc('year', CURRENT_DATE) GROUP BY source ORDER BY total DESC`, params);
      out.byInstitution = await many(`SELECT COALESCE(i.name,'לא משויך') AS name, i.color, COALESCE(SUM(t.amount_ils),0) AS total FROM transactions t
        LEFT JOIN institutions i ON i.id = t.institution_id ${w} AND t.date >= date_trunc('year', CURRENT_DATE) GROUP BY i.name, i.color ORDER BY total DESC`, params);
      out.monthly = await many(`SELECT to_char(date_trunc('month', date),'YYYY-MM') AS m, COALESCE(SUM(amount_ils),0) AS total,
        COALESCE(SUM(amount_ils) FILTER (WHERE kind = 'keva'),0) AS keva FROM transactions t ${w}
        AND date >= date_trunc('month', CURRENT_DATE) - interval '11 months' GROUP BY 1 ORDER BY 1`, params);
      const kp = [];
      const kc = ["status = 'active'"];
      const kdc = demoClause(ctx, 's');
      if (kdc) kc.push(kdc);
      out.keva = await one(`SELECT COUNT(*)::int AS active, COALESCE(SUM(CASE WHEN currency='ILS' THEN amount ELSE amount * 3.7 END),0) AS monthly
        FROM standing_orders s WHERE ${kc.join(' AND ')}`, kp);
      out.kevaChurn = await one(`SELECT COUNT(*)::int AS c FROM standing_orders s WHERE status IN ('cancelled','ended')
        AND COALESCE(cancelled_at, end_date::timestamptz) > now() - interval '30 days' ${kdc ? `AND ${kdc}` : ''}`);
      out.failed = await one(`SELECT COUNT(*)::int AS c, COALESCE(SUM(amount_ils),0) AS total FROM transactions t WHERE status IN ('failed','bounced')
        AND date > CURRENT_DATE - 30 ${dc ? `AND ${dc}` : ''}`);
      out.noDocument = await one(`SELECT COUNT(*)::int AS c FROM transactions t WHERE status = 'paid' AND document_id IS NULL
        AND date >= date_trunc('year', CURRENT_DATE) ${dc ? `AND ${dc}` : ''}`);
      out.notReported = await one(`SELECT COUNT(*)::int AS c FROM documents WHERE type = 'receipt46' AND status = 'active'
        AND tax_report_status IN ('pending','failed')`);
      out.pendingApproval = await one(`SELECT COUNT(*)::int AS c FROM transactions t WHERE approved = FALSE ${dc ? `AND ${dc}` : ''}`);
      out.large = await many(`SELECT t.id, t.amount_ils, t.date, t.donor_id, ${DONOR_LABEL} AS donor FROM transactions t
        LEFT JOIN donors d ON d.id = t.donor_id ${w} AND t.date > CURRENT_DATE - 14 ORDER BY t.amount_ils DESC LIMIT 5`, params);
    }
    out.tasks = await one(`SELECT COUNT(*)::int AS c FROM call_tasks WHERE status IN ('open','callback','no_answer')
      ${ctx.user.active_role === 'call_agent' ? `AND (assigned_user_id = ${Number(ctx.user.id)} OR assigned_user_id IS NULL)` : ''}`);
    out.openPledges = await one("SELECT COUNT(*)::int AS c, COALESCE(SUM(amount),0) AS total FROM pledges WHERE status = 'open'");
    out.boxesDue = await one('SELECT COUNT(*)::int AS c FROM tzedaka_boxes WHERE active = TRUE AND (last_collected_at IS NULL OR last_collected_at + collection_interval_days <= CURRENT_DATE)');
    out.aidOpen = await one("SELECT COUNT(*)::int AS c FROM aid_requests WHERE status IN ('new','review')");
    out.contactOpen = await one('SELECT COUNT(*)::int AS c FROM contact_messages WHERE handled = FALSE');
    out.spiritualPending = await one("SELECT COUNT(*)::int AS c FROM spiritual_orders WHERE status = 'pending'");
    ctx.json(200, out);
  });

  // ---------- כרטיס תורם 360 ----------
  r.get('/api/donors/:id/full', async (ctx) => {
    requirePerm(ctx, 'donors.read');
    const id = Number(ctx.params.id);
    const donor = await one(`SELECT d.*, u.name AS recruiter_name, i.name AS institution_name FROM donors d
      LEFT JOIN users u ON u.id = d.recruiter_user_id LEFT JOIN institutions i ON i.id = d.institution_id WHERE d.id = $1`, [id]);
    if (!donor) throw new HttpError(404, 'תורם לא נמצא');
    const showFinance = can(ctx.user, 'tx.read');
    const [links, dates, interactions, tasks, pledges, spiritual, messages, guests] = await Promise.all([
      many('SELECT source, external_id, created_at FROM donor_links WHERE donor_id = $1', [id]),
      many('SELECT * FROM donor_dates WHERE donor_id = $1 ORDER BY id', [id]),
      many('SELECT i.id, i.kind, i.summary, i.outcome, i.follow_up_date, i.done, i.at, i.file_name, u.name AS user_name FROM interactions i LEFT JOIN users u ON u.id = i.user_id WHERE donor_id = $1 ORDER BY at DESC LIMIT 100', [id]),
      many('SELECT c.*, u.name AS agent FROM call_tasks c LEFT JOIN users u ON u.id = c.assigned_user_id WHERE donor_id = $1 ORDER BY created_at DESC LIMIT 50', [id]),
      many('SELECT * FROM pledges WHERE donor_id = $1 ORDER BY created_at DESC', [id]),
      many('SELECT * FROM spiritual_orders WHERE donor_id = $1 ORDER BY created_at DESC', [id]),
      many('SELECT id, channel, to_addr, body, status, at FROM messages_out WHERE donor_id = $1 ORDER BY at DESC LIMIT 50', [id]),
      many('SELECT g.*, e.name AS event_name, e.date AS event_date FROM event_guests g JOIN events e ON e.id = g.event_id WHERE g.donor_id = $1', [id]),
    ]);
    const out = { donor, links, dates, interactions, tasks, pledges, spiritual, messages, guests, showFinance };
    if (showFinance) {
      out.transactions = await many(`SELECT t.*, i.name AS institution_name, dc.number AS document_number FROM transactions t
        LEFT JOIN institutions i ON i.id = t.institution_id LEFT JOIN documents dc ON dc.id = t.document_id WHERE t.donor_id = $1 ORDER BY date DESC, id DESC LIMIT 500`, [id]);
      out.keva = await many('SELECT s.*, i.name AS institution_name FROM standing_orders s LEFT JOIN institutions i ON i.id = s.institution_id WHERE donor_id = $1 ORDER BY status, created_at DESC', [id]);
      out.documents = await many('SELECT * FROM documents WHERE donor_id = $1 ORDER BY issued_at DESC', [id]);
      out.stats = await one(`SELECT COALESCE(SUM(amount_ils),0) AS total, COUNT(*)::int AS count, MAX(date) AS last, MIN(date) AS first,
        COALESCE(SUM(amount_ils) FILTER (WHERE date >= date_trunc('year', CURRENT_DATE)),0) AS this_year
        FROM transactions WHERE donor_id = $1 AND status = 'paid'`, [id]);
    }
    ctx.json(200, out);
  });

  // מיזוג כפילויות: כל הקשרים עוברים לתורם הראשי
  r.post('/api/donors/merge', async (ctx) => {
    requirePerm(ctx, 'donors.merge');
    const keep = Number(ctx.body.keep_id);
    const remove = Number(ctx.body.remove_id);
    if (!keep || !remove || keep === remove) throw new HttpError(400, 'יש לבחור שני תורמים שונים');
    const tables = ['transactions', 'standing_orders', 'documents', 'donor_dates', 'interactions', 'pledges', 'call_tasks', 'spiritual_orders', 'event_guests', 'messages_out'];
    for (const t of tables) await query(`UPDATE ${t} SET donor_id = $1 WHERE donor_id = $2`, [keep, remove]);
    await query('UPDATE donor_links SET donor_id = $1 WHERE donor_id = $2', [keep, remove]);
    const a = await one('SELECT * FROM donors WHERE id = $1', [keep]);
    const b = await one('SELECT * FROM donors WHERE id = $1', [remove]);
    const fill = {};
    for (const k of ['phone', 'phone2', 'email', 'id_number', 'address', 'city', 'spouse_name', 'father_name', 'mother_name']) if (!a[k] && b[k]) fill[k] = b[k];
    fill.tags = [...new Set([...(a.tags || []), ...(b.tags || [])])];
    await update('donors', keep, fill, Object.keys(fill));
    await query('DELETE FROM donors WHERE id = $1', [remove]);
    await audit(ctx.user, 'donor_merge', 'donor', keep, { removed: remove, removedName: `${b.first_name} ${b.last_name}` });
    ctx.json(200, { ok: true });
  });

  r.get('/api/donors/duplicates', async (ctx) => {
    requirePerm(ctx, 'donors.merge');
    const rows = await many(`SELECT a.id AS a_id, b.id AS b_id,
      TRIM(COALESCE(a.first_name,'') || ' ' || COALESCE(a.last_name,'')) AS a_name, TRIM(COALESCE(b.first_name,'') || ' ' || COALESCE(b.last_name,'')) AS b_name,
      CASE WHEN a.phone = b.phone THEN 'טלפון' WHEN a.id_number = b.id_number THEN 'ת.ז.' WHEN LOWER(a.email) = LOWER(b.email) THEN 'מייל' ELSE 'שם' END AS reason
      FROM donors a JOIN donors b ON a.id < b.id AND (
        (a.phone IS NOT NULL AND a.phone <> '' AND a.phone = b.phone) OR (a.id_number IS NOT NULL AND a.id_number <> '' AND a.id_number = b.id_number)
        OR (a.email IS NOT NULL AND a.email <> '' AND LOWER(a.email) = LOWER(b.email))
        OR (a.first_name = b.first_name AND a.last_name = b.last_name AND COALESCE(a.city,'') = COALESCE(b.city,'') AND a.last_name <> ''))
      LIMIT 200`);
    ctx.json(200, { rows });
  });

  // סינון לרשימות תפוצה (תורמי חו"ל, VIP, רדומים, גובה תרומה)
  async function segmentQuery(f = {}) {
    const params = [];
    const conds = ['d.no_contact = FALSE'];
    if (f.status) { params.push(f.status); conds.push(`d.status = $${params.length}`); }
    if (f.is_vip) conds.push('d.is_vip = TRUE');
    if (f.is_overseas) conds.push('d.is_overseas = TRUE');
    if (f.tag) { params.push(f.tag); conds.push(`$${params.length} = ANY(d.tags)`); }
    if (f.city) { params.push(f.city); conds.push(`d.city = $${params.length}`); }
    if (f.language) { params.push(f.language); conds.push(`d.language = $${params.length}`); }
    if (f.institution_id) { params.push(Number(f.institution_id)); conds.push(`d.id IN (SELECT donor_id FROM transactions WHERE institution_id = $${params.length})`); }
    if (f.has_keva === 'yes') conds.push("d.id IN (SELECT donor_id FROM standing_orders WHERE status = 'active')");
    if (f.has_keva === 'no') conds.push("d.id NOT IN (SELECT donor_id FROM standing_orders WHERE status = 'active' AND donor_id IS NOT NULL)");
    if (f.dormant_months) { params.push(Number(f.dormant_months)); conds.push(`COALESCE((SELECT MAX(date) FROM transactions t WHERE t.donor_id = d.id AND t.status='paid'), '1900-01-01') < CURRENT_DATE - ($${params.length} || ' months')::interval`); }
    if (f.min_total) { params.push(Number(f.min_total)); conds.push(`(SELECT COALESCE(SUM(amount_ils),0) FROM transactions t WHERE t.donor_id = d.id AND t.status='paid' AND t.date > CURRENT_DATE - 365) >= $${params.length}`); }
    if (f.max_total) { params.push(Number(f.max_total)); conds.push(`(SELECT COALESCE(SUM(amount_ils),0) FROM transactions t WHERE t.donor_id = d.id AND t.status='paid' AND t.date > CURRENT_DATE - 365) <= $${params.length}`); }
    if (f.demo === 'hide') conds.push('d.is_demo = FALSE');
    const rows = await many(`SELECT d.id, ${DONOR_LABEL} AS name, d.phone, d.email, d.city, d.language,
      (SELECT COALESCE(SUM(amount_ils),0) FROM transactions t WHERE t.donor_id = d.id AND t.status='paid' AND t.date > CURRENT_DATE - 365) AS year_total
      FROM donors d WHERE ${conds.join(' AND ')} ORDER BY year_total DESC LIMIT 2000`, params);
    return rows;
  }

  r.post('/api/segments/preview', async (ctx) => {
    requirePerm(ctx, 'donors.read');
    const rows = await segmentQuery(ctx.body.filter || {});
    ctx.json(200, { rows, count: rows.length });
  });

  r.post('/api/messages/bulk', async (ctx) => {
    requirePerm(ctx, 'messages.send');
    const { filter, donor_ids, channel = 'whatsapp', body, subject } = ctx.body;
    if (!body) throw new HttpError(400, 'יש לכתוב את נוסח ההודעה');
    let targets = donor_ids?.length ? await many(`SELECT d.id, ${DONOR_LABEL} AS name FROM donors d WHERE id = ANY($1::int[]) AND no_contact = FALSE`, [donor_ids]) : await segmentQuery(filter || {});
    let sent = 0;
    let skipped = 0;
    for (const t of targets) {
      const res = await sendMessage({ donorId: t.id, channel, subject, body: body.replaceAll('{שם}', t.name) }, ctx.user);
      if (res.skipped) skipped++; else sent++;
    }
    await audit(ctx.user, 'bulk_message', 'messages', null, { channel, count: sent, skipped });
    ctx.json(200, { sent, skipped, sandbox: isSandbox() });
  });

  r.post('/api/donors/:id/message', async (ctx) => {
    requirePerm(ctx, 'messages.send');
    const res = await sendMessage({ donorId: Number(ctx.params.id), channel: ctx.body.channel || 'whatsapp', body: ctx.body.body, subject: ctx.body.subject }, ctx.user);
    if (res.skipped) throw new HttpError(400, res.reason);
    await query("INSERT INTO interactions (donor_id, user_id, kind, summary) VALUES ($1,$2,$3,$4)", [ctx.params.id, ctx.user.id, ctx.body.channel === 'email' ? 'email' : 'whatsapp', `נשלחה הודעה: ${String(ctx.body.body).slice(0, 200)}`]);
    ctx.json(200, { ok: true, sandbox: isSandbox() });
  });

  // ---------- יומן תנועות מאוחד ----------
  r.get('/api/transactions', async (ctx) => {
    requirePerm(ctx, 'tx.read');
    const params = [];
    const conds = [];
    const q = ctx.query;
    for (const k of ['source', 'status', 'kind', 'method', 'currency']) if (q[k]) { params.push(q[k]); conds.push(`t.${k} = $${params.length}`); }
    for (const k of ['institution_id', 'campaign_id', 'donor_id', 'recruiter_user_id', 'standing_order_id']) if (q[k]) { params.push(Number(q[k])); conds.push(`t.${k} = $${params.length}`); }
    if (q.from) { params.push(q.from); conds.push(`t.date >= $${params.length}`); }
    if (q.to) { params.push(q.to); conds.push(`t.date <= $${params.length}`); }
    if (q.no_document === 'true') conds.push("t.document_id IS NULL AND t.status = 'paid'");
    if (q.pending_approval === 'true') conds.push('t.approved = FALSE');
    if (q.q) { params.push(`%${q.q}%`); conds.push(`(${DONOR_LABEL} ILIKE $${params.length} OR d.phone ILIKE $${params.length} OR t.serial ILIKE $${params.length} OR t.external_id ILIKE $${params.length} OR t.check_number ILIKE $${params.length})`); }
    const sc = instScope(ctx, 't', params);
    if (sc) conds.push(sc);
    const dc = demoClause(ctx, 't');
    if (dc) conds.push(dc);
    const w = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const size = Math.min(Number(q.size) || 100, 1000);
    const page = Math.max(Number(q.page) || 1, 1);
    const rows = await many(`SELECT t.id, t.serial, t.date, t.amount, t.currency, t.amount_ils, t.kind, t.method, t.status, t.source, t.external_id,
      t.donor_id, ${DONOR_LABEL} AS donor_name, d.phone AS donor_phone, t.institution_id, i.name AS institution_name, t.campaign_id, c.name AS campaign_name,
      t.document_id, dc.number AS document_number, dc.tax_report_status, t.check_number, t.check_due_date, t.card_last4, t.failure_reason, t.approved,
      t.installments, t.dedication, t.notes, t.is_demo, t.standing_order_id, u.name AS recruiter_name
      FROM transactions t LEFT JOIN donors d ON d.id = t.donor_id LEFT JOIN institutions i ON i.id = t.institution_id
      LEFT JOIN campaigns c ON c.id = t.campaign_id LEFT JOIN documents dc ON dc.id = t.document_id LEFT JOIN users u ON u.id = t.recruiter_user_id
      ${w} ORDER BY t.date DESC, t.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    const sum = await one(`SELECT COUNT(*)::int AS count, COALESCE(SUM(t.amount_ils) FILTER (WHERE t.status='paid'),0) AS total
      FROM transactions t LEFT JOIN donors d ON d.id = t.donor_id ${w}`, params);
    const bySource = await many(`SELECT t.source, COALESCE(SUM(t.amount_ils) FILTER (WHERE t.status='paid'),0) AS total, COUNT(*)::int AS c
      FROM transactions t LEFT JOIN donors d ON d.id = t.donor_id ${w} GROUP BY t.source ORDER BY total DESC`, params);
    ctx.json(200, { rows, ...sum, bySource, page, size, sourceLabels: Object.fromEntries(bySource.map((s) => [s.source, getProvider(s.source)?.label || (s.source === 'manual' ? 'ידני / משרד' : s.source)])) });
  });

  r.post('/api/transactions', async (ctx) => {
    requirePerm(ctx, 'tx.write');
    const b = ctx.body;
    if (!b.donor_id) throw new HttpError(400, 'יש לבחור תורם');
    const amount = Number(b.amount);
    if (!amount || amount <= 0) throw new HttpError(400, 'יש להזין סכום');
    const kind = b.kind || (b.method === 'cash' ? 'cash' : b.method === 'check' ? 'check' : b.method === 'transfer' ? 'transfer' : 'one_time');
    const needsApproval = ['cash', 'check'].includes(b.method) && !can(ctx.user, 'tx.approve');
    const { row } = await recordTransaction({
      donor_id: Number(b.donor_id), source: 'manual', kind, method: b.method || 'cash', amount, currency: b.currency || 'ILS',
      date: b.date || new Date().toISOString().slice(0, 10), status: b.status || (b.method === 'check' && b.check_due_date && b.check_due_date > new Date().toISOString().slice(0, 10) ? 'pending' : 'paid'),
      institution_id: b.institution_id ? Number(b.institution_id) : null, purpose_id: b.purpose_id ? Number(b.purpose_id) : null,
      campaign_id: b.campaign_id ? Number(b.campaign_id) : null, recruiter_user_id: b.recruiter_user_id ? Number(b.recruiter_user_id) : (ctx.user.active_role === 'recruiter' ? ctx.user.id : null),
      check_number: b.check_number || null, check_bank: b.check_bank || null, check_due_date: b.check_due_date || null,
      dedication: b.dedication || null, notes: b.notes || null, signature_data: b.signature_data || null,
      approved: !needsApproval, approved_by: needsApproval ? null : ctx.user.id, installments: Number(b.installments) || 1,
    }, ctx.user);
    await audit(ctx.user, 'tx_create', 'transaction', row.id, { amount, method: b.method });
    if (b.pledge_id) await query("UPDATE pledges SET status = 'paid', transaction_id = $2 WHERE id = $1", [b.pledge_id, row.id]);
    let document = null;
    if (b.issue_document && !needsApproval && row.status === 'paid') {
      try { document = await issueDocument({ transactionId: row.id, type: b.document_type || 'receipt46' }, ctx.user); } catch (e) { document = { error: e.message }; }
    }
    ctx.json(200, { row, document, needsApproval });
  });

  // חיוב אשראי מתוך המערכת (דרך דף סליקה של הספק; בפיתוח - הדמיה)
  r.post('/api/charge', async (ctx) => {
    requirePerm(ctx, 'tx.write');
    const b = ctx.body;
    const amount = Number(b.amount);
    if (!b.donor_id || !amount) throw new HttpError(400, 'תורם וסכום הם חובה');
    const provider = b.provider || 'cardcom';
    const def = getProvider(provider);
    if (!def) throw new HttpError(400, 'ספק סליקה לא מוכר');
    if (b.recurring) {
      const so = await insert('standing_orders', {
        donor_id: Number(b.donor_id), source: provider, external_id: `SBX-K-${Date.now()}`, type: 'credit', amount, currency: b.currency || 'ILS',
        day_of_month: Number(b.day_of_month) || new Date().getDate(), start_date: new Date().toISOString().slice(0, 10), months_total: b.months_total ? Number(b.months_total) : null,
        status: 'active', next_charge_date: b.start_date || new Date().toISOString().slice(0, 10), institution_id: b.institution_id || null, campaign_id: b.campaign_id || null,
        card_last4: '0000', token_ref: 'SANDBOX-TOKEN', notes: 'הוקם מתוך המערכת (הדמיה)',
      });
      await audit(ctx.user, 'keva_create', 'standing_order', so.id, { provider, amount });
      return ctx.json(200, { standing_order: so, sandbox: true, message: `הוראת קבע באשראי הוקמה ב${def.label} (הדמיה). בייצור התורם יוזן לדף סליקה מאובטח של הספק.` });
    }
    const { row } = await recordTransaction({
      donor_id: Number(b.donor_id), source: provider, external_id: `SBX-${Date.now()}`, kind: 'one_time', method: 'credit', amount,
      currency: b.currency || 'ILS', status: 'paid', installments: Number(b.installments) || 1, institution_id: b.institution_id || null,
      campaign_id: b.campaign_id || null, card_last4: '0000', dedication: b.dedication || null,
    }, ctx.user);
    ctx.json(200, { row, sandbox: true, message: `החיוב בוצע ב${def.label} (הדמיה). בייצור ייפתח דף הסליקה המאובטח של הספק - פרטי כרטיס לא עוברים במערכת.` });
  });

  r.post('/api/transactions/:id/action', async (ctx) => {
    const action = ctx.body.action;
    requirePerm(ctx, action === 'approve' ? 'tx.approve' : 'tx.actions');
    ctx.json(200, await transactionAction(Number(ctx.params.id), action, ctx.user, ctx.body));
  });

  r.put('/api/transactions/:id', async (ctx) => {
    requirePerm(ctx, 'tx.actions');
    const allowed = ['institution_id', 'purpose_id', 'campaign_id', 'recruiter_user_id', 'dedication', 'notes', 'donor_id', 'check_number', 'check_bank', 'check_due_date'];
    const data = {};
    for (const k of allowed) if (ctx.body[k] !== undefined) data[k] = ctx.body[k] === '' ? null : ctx.body[k];
    const row = await update('transactions', ctx.params.id, data, allowed);
    await audit(ctx.user, 'tx_update', 'transaction', ctx.params.id, data);
    ctx.json(200, { row });
  });

  r.post('/api/transactions/:id/document', async (ctx) => {
    requirePerm(ctx, 'docs.issue');
    const doc = await issueDocument({ transactionId: Number(ctx.params.id), type: ctx.body.type || 'receipt46', providerKey: ctx.body.provider, lang: ctx.body.lang }, ctx.user);
    ctx.json(200, { document: doc });
  });

  r.post('/api/transactions/bulk-documents', async (ctx) => {
    requirePerm(ctx, 'docs.issue');
    const ids = (ctx.body.ids || []).map(Number);
    const results = [];
    for (const id of ids) {
      try { const d = await issueDocument({ transactionId: id, type: ctx.body.type || 'receipt46' }, ctx.user); results.push({ id, ok: true, number: d.number }); } catch (e) { results.push({ id, ok: false, error: e.message }); }
    }
    ctx.json(200, { results });
  });

  // ---------- הוראות קבע ----------
  r.get('/api/keva', async (ctx) => {
    requirePerm(ctx, 'keva.read');
    const params = [];
    const conds = [];
    const q = ctx.query;
    for (const k of ['status', 'source', 'type', 'currency']) if (q[k]) { params.push(q[k]); conds.push(`s.${k} = $${params.length}`); }
    if (q.institution_id) { params.push(Number(q.institution_id)); conds.push(`s.institution_id = $${params.length}`); }
    if (q.q) { params.push(`%${q.q}%`); conds.push(`(${DONOR_LABEL} ILIKE $${params.length} OR d.phone ILIKE $${params.length})`); }
    if (q.churn === 'true') conds.push("s.status IN ('cancelled','ended') AND COALESCE(s.cancelled_at, s.end_date::timestamptz) > now() - interval '90 days'");
    if (q.ending === 'true') conds.push("s.status = 'active' AND s.end_date IS NOT NULL AND s.end_date < CURRENT_DATE + 60");
    if (ctx.user.active_role === 'institution_manager') { params.push(ctx.user.institution_id || -1); conds.push(`s.institution_id = $${params.length}`); }
    const dc = demoClause(ctx, 's');
    if (dc) conds.push(dc);
    const w = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await many(`SELECT s.*, ${DONOR_LABEL} AS donor_name, d.phone AS donor_phone, i.name AS institution_name,
      (SELECT COUNT(*)::int FROM transactions t WHERE t.standing_order_id = s.id AND t.status = 'failed') AS failed_count
      FROM standing_orders s LEFT JOIN donors d ON d.id = s.donor_id LEFT JOIN institutions i ON i.id = s.institution_id
      ${w} ORDER BY CASE s.status WHEN 'failed' THEN 0 WHEN 'active' THEN 1 WHEN 'frozen' THEN 2 ELSE 3 END, s.amount DESC LIMIT 1000`, params);
    const summary = await one(`SELECT COUNT(*) FILTER (WHERE s.status='active')::int AS active, COUNT(*) FILTER (WHERE s.status='frozen')::int AS frozen,
      COUNT(*) FILTER (WHERE s.status='failed')::int AS failed,
      COALESCE(SUM(CASE WHEN s.currency='ILS' THEN s.amount ELSE s.amount*3.7 END) FILTER (WHERE s.status='active'),0) AS monthly
      FROM standing_orders s LEFT JOIN donors d ON d.id = s.donor_id ${w}`, params);
    ctx.json(200, { rows, summary });
  });

  r.post('/api/keva', async (ctx) => {
    requirePerm(ctx, 'keva.actions');
    const b = ctx.body;
    if (!b.donor_id || !Number(b.amount)) throw new HttpError(400, 'תורם וסכום הם חובה');
    const so = await insert('standing_orders', {
      donor_id: Number(b.donor_id), source: b.source || (b.type === 'bank' ? 'masav' : 'manual'), type: b.type || 'bank', amount: Number(b.amount),
      currency: b.currency || 'ILS', day_of_month: Number(b.day_of_month) || 10, start_date: b.start_date || new Date().toISOString().slice(0, 10),
      end_date: b.end_date || null, months_total: b.months_total ? Number(b.months_total) : null, status: 'active',
      next_charge_date: b.start_date || null, institution_id: b.institution_id ? Number(b.institution_id) : null,
      purpose_id: b.purpose_id ? Number(b.purpose_id) : null, campaign_id: b.campaign_id ? Number(b.campaign_id) : null,
      bank_code: b.bank_code || null, branch_code: b.branch_code || null,
      account_masked: b.account_number ? `****${String(b.account_number).slice(-4)}` : null,
      token_ref: b.account_number ? `BANK:${b.bank_code}-${b.branch_code}-${b.account_number}` : null,
      notes: b.notes || null, recruiter_user_id: b.recruiter_user_id || null,
    });
    await audit(ctx.user, 'keva_create', 'standing_order', so.id, { amount: so.amount, type: so.type });
    ctx.json(200, { row: so });
  });

  r.post('/api/keva/:id/action', async (ctx) => {
    requirePerm(ctx, 'keva.actions');
    ctx.json(200, await kevaAction(Number(ctx.params.id), ctx.body.action, ctx.user, ctx.body));
  });

  // ---------- מסמכים ----------
  r.get('/api/documents', async (ctx) => {
    requirePerm(ctx, 'docs.read');
    const params = [];
    const conds = [];
    const q = ctx.query;
    for (const k of ['type', 'status', 'tax_report_status', 'provider']) if (q[k]) { params.push(q[k]); conds.push(`dc.${k} = $${params.length}`); }
    if (q.from) { params.push(q.from); conds.push(`dc.issued_at >= $${params.length}`); }
    if (q.to) { params.push(q.to); conds.push(`dc.issued_at < ($${params.length}::date + 1)`); }
    if (q.q) { params.push(`%${q.q}%`); conds.push(`(${DONOR_LABEL} ILIKE $${params.length} OR dc.number ILIKE $${params.length})`); }
    const dc = demoClause(ctx, 'dc');
    if (dc) conds.push(dc);
    const w = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await many(`SELECT dc.*, ${DONOR_LABEL} AS donor_name, d.email AS donor_email, d.phone AS donor_phone
      FROM documents dc LEFT JOIN donors d ON d.id = dc.donor_id ${w} ORDER BY dc.issued_at DESC LIMIT 1000`, params);
    ctx.json(200, { rows });
  });

  r.post('/api/documents/:id/cancel', async (ctx) => {
    requirePerm(ctx, 'docs.cancel');
    if (!ctx.body.reason) throw new HttpError(400, 'יש לציין סיבת ביטול');
    ctx.json(200, await cancelDocument(Number(ctx.params.id), ctx.user, ctx.body));
  });

  r.post('/api/documents/:id/send', async (ctx) => {
    requirePerm(ctx, 'docs.issue');
    const doc = await one('SELECT * FROM documents WHERE id = $1', [ctx.params.id]);
    if (!doc) throw new HttpError(404, 'מסמך לא נמצא');
    const channel = ctx.body.channel || 'email';
    const typeLabel = RESOURCES.donors && { receipt46: 'קבלה על תרומה', receipt: 'קבלה', invoice_receipt: 'חשבונית מס-קבלה', credit: 'מסמך זיכוי' }[doc.type];
    const res = await sendMessage({
      donorId: doc.donor_id, channel, subject: `${typeLabel || 'מסמך'} מס׳ ${doc.number} - מוסדות אור יקר צפת`,
      body: `שלום {שם}, תודה על תרומתך! מצורפת ${typeLabel} מס׳ ${doc.number} על סך ${doc.amount} ${doc.currency}.${doc.pdf_url ? `\n${doc.pdf_url}` : ''}${doc.tax_report_number ? `\nהתרומה דווחה לרשות המסים, מספר דיווח ${doc.tax_report_number}` : ''}`,
    }, ctx.user);
    if (res.skipped) throw new HttpError(400, res.reason);
    await query('UPDATE documents SET sent_via = array_append(sent_via, $2) WHERE id = $1', [doc.id, channel]);
    ctx.json(200, { ok: true, sandbox: isSandbox() });
  });

  // קבלה מרוכזת שנתית
  r.post('/api/documents/annual', async (ctx) => {
    requirePerm(ctx, 'docs.issue');
    const year = Number(ctx.body.year) || new Date().getFullYear() - 1;
    const donorId = Number(ctx.body.donor_id);
    const sum = await one(`SELECT COALESCE(SUM(amount_ils),0) AS total, COUNT(*)::int AS c FROM transactions WHERE donor_id = $1 AND status = 'paid'
      AND document_id IS NULL AND EXTRACT(YEAR FROM date) = $2`, [donorId, year]);
    if (!sum.c) throw new HttpError(400, `אין לתורם תרומות ללא קבלה בשנת ${year}`);
    const doc = await issueDocument({ donorId, type: 'receipt46', amount: sum.total, currency: 'ILS', description: `קבלה מרוכזת על תרומות שנת ${year}`, annualYear: year }, ctx.user);
    await query(`UPDATE transactions SET document_id = $3 WHERE donor_id = $1 AND status = 'paid' AND document_id IS NULL AND EXTRACT(YEAR FROM date) = $2`, [donorId, year, doc.id]);
    ctx.json(200, { document: doc, count: sum.c });
  });

  // ---------- מס"ב ----------
  async function masavRows(day) {
    return many(`SELECT s.*, ${DONOR_LABEL} AS donor_name, d.id_number FROM standing_orders s JOIN donors d ON d.id = s.donor_id
      WHERE s.type = 'bank' AND s.status = 'active' AND s.day_of_month = $1 AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
      AND (s.months_total IS NULL OR s.months_paid < s.months_total) ORDER BY s.id`, [day]);
  }

  r.get('/api/masav/preview', async (ctx) => {
    requirePerm(ctx, 'keva.actions');
    const day = Number(ctx.query.day) || 10;
    const rows = await masavRows(day);
    ctx.json(200, { rows: rows.map((x) => ({ id: x.id, donor_name: x.donor_name, amount: x.amount, bank: x.bank_code, branch: x.branch_code, account: x.account_masked, ok: !!x.token_ref })), total: rows.reduce((a, x) => a + Number(x.amount), 0) });
  });

  r.post('/api/masav/file', async (ctx) => {
    requirePerm(ctx, 'keva.actions');
    const day = Number(ctx.body.day) || 10;
    const chargeDate = ctx.body.charge_date || new Date().toISOString().slice(0, 10);
    const rows = (await masavRows(day)).filter((x) => x.token_ref?.startsWith('BANK:'));
    const cfg = (await one("SELECT config FROM providers WHERE key = 'masav'"))?.config || {};
    const pad = (s, n, ch = ' ', left = false) => { s = String(s ?? '').slice(0, n); return left ? s.padStart(n, ch) : s.padEnd(n, ch); };
    const ymd = chargeDate.replaceAll('-', '').slice(2);
    const lines = [];
    lines.push(`K${pad(cfg.institution_code || '00000000', 8, '0', true)}00${ymd}0001${ymd}${pad(cfg.sending_institution || '00000', 5, '0', true)}${pad('', 6, '0')}${pad('אור יקר צפת', 30)}KOT`);
    let total = 0;
    for (const x of rows) {
      const [, bank, branch, account] = x.token_ref.match(/^BANK:(\d*)-(\d*)-(\d*)$/) || [];
      const agorot = Math.round(Number(x.amount) * 100);
      total += agorot;
      lines.push(`1${pad(cfg.institution_code || '00000000', 8, '0', true)}00${pad('', 6, '0')}${pad(bank, 2, '0', true)}${pad(branch, 3, '0', true)}0000${pad(account, 9, '0', true)}0${pad(x.id_number || '', 9, '0', true)}${pad(x.donor_name, 16)}${pad(agorot, 13, '0', true)}${pad(x.id, 20, '0', true)}${ymd}000504${pad('', 18, '0')}  `);
      await query('UPDATE standing_orders SET last_charge_date = $2, months_paid = months_paid + 1 WHERE id = $1', [x.id, chargeDate]);
      await recordTransaction({ donor_id: x.donor_id, source: 'masav', kind: 'keva', method: 'bank_keva', amount: x.amount, currency: 'ILS', date: chargeDate, status: 'pending', institution_id: x.institution_id, purpose_id: x.purpose_id, standing_order_id: x.id, notes: 'נשלח בקובץ מס"ב - ממתין לאישור הבנק' }, ctx.user, { isDemo: x.is_demo });
    }
    lines.push(`5${pad(cfg.institution_code || '00000000', 8, '0', true)}00${ymd}0001${pad(total, 15, '0', true)}${pad('', 15, '0')}${pad(rows.length, 7, '0', true)}${pad('', 7, '0')}`);
    lines.push('9'.repeat(128));
    await audit(ctx.user, 'masav_file', 'masav', day, { count: rows.length, total: total / 100, chargeDate });
    ctx.send(200, lines.join('\r\n'), 'text/plain; charset=utf-8', { 'Content-Disposition': `attachment; filename="masav-${chargeDate}.txt"` });
  });

  // קליטת החזרות מס"ב (סירובים) - רשימת מזהי הו"ק שחזרו
  r.post('/api/masav/returns', async (ctx) => {
    requirePerm(ctx, 'keva.actions');
    const items = ctx.body.items || [];
    let n = 0;
    for (const it of items) {
      const so = await one('SELECT * FROM standing_orders WHERE id = $1', [Number(it.standing_order_id)]);
      if (!so) continue;
      await query("UPDATE transactions SET status = 'bounced', failure_reason = $2 WHERE standing_order_id = $1 AND status = 'pending' AND method = 'bank_keva'", [so.id, it.reason || 'החזרת מס"ב']);
      const failures = so.failures + 1;
      await query('UPDATE standing_orders SET failures = $2, status = $3 WHERE id = $1', [so.id, failures, failures >= 3 ? 'failed' : so.status]);
      await query("INSERT INTO call_tasks (donor_id, reason, priority, due_date, standing_order_id, notes) VALUES ($1,'failed_charge',1, CURRENT_DATE + 1, $2, $3)", [so.donor_id, so.id, `החזרת מס"ב: ${it.reason || ''}`]);
      n++;
    }
    await query("UPDATE transactions SET status = 'paid' WHERE method = 'bank_keva' AND status = 'pending' AND date < CURRENT_DATE - 5");
    await audit(ctx.user, 'masav_returns', 'masav', null, { count: n });
    ctx.json(200, { processed: n });
  });

  // ---------- שטח: גבייה בית לבית ----------
  r.post('/api/field/collect', async (ctx) => {
    requirePerm(ctx, 'field.use');
    const b = ctx.body;
    let donorId = b.donor_id ? Number(b.donor_id) : null;
    if (!donorId) {
      if (!b.first_name) throw new HttpError(400, 'יש להזין שם תורם');
      const phone = normalizePhone(b.phone);
      const existing = phone ? await one('SELECT id FROM donors WHERE phone = $1 LIMIT 1', [phone]) : null;
      donorId = existing?.id || (await insert('donors', {
        first_name: b.first_name, last_name: b.last_name || '', phone: phone || null, address: b.address || null, city: b.city || 'צפת',
        id_number: b.id_number || null, recruiter_user_id: ctx.user.id, tags: ['שטח'],
      })).id;
    }
    const amount = Number(b.amount);
    if (!amount) throw new HttpError(400, 'יש להזין סכום');
    if (b.method === 'keva_bank') {
      const so = await insert('standing_orders', {
        donor_id: donorId, source: 'masav', type: 'bank', amount, currency: 'ILS', day_of_month: Number(b.day_of_month) || 10,
        start_date: new Date().toISOString().slice(0, 10), status: 'active', bank_code: b.bank_code, branch_code: b.branch_code,
        account_masked: b.account_number ? `****${String(b.account_number).slice(-4)}` : null,
        token_ref: b.account_number ? `BANK:${b.bank_code}-${b.branch_code}-${b.account_number}` : null,
        recruiter_user_id: ctx.user.id, notes: `נחתם בשטח${b.signature_data ? ' (חתימה דיגיטלית מצורפת)' : ''}`,
      });
      await audit(ctx.user, 'field_keva', 'standing_order', so.id, { amount });
      return ctx.json(200, { standing_order: so });
    }
    const { row } = await recordTransaction({
      donor_id: donorId, source: 'manual', kind: b.method === 'check' ? 'check' : b.method === 'credit' ? 'one_time' : 'cash',
      method: b.method || 'cash', amount, currency: 'ILS', status: 'paid', recruiter_user_id: ctx.user.id,
      check_number: b.check_number || null, check_bank: b.check_bank || null, check_due_date: b.check_due_date || null,
      signature_data: b.signature_data || null, dedication: b.dedication || null, approved: can(ctx.user, 'tx.approve'),
      notes: 'גבייה בשטח', institution_id: b.institution_id || null,
    }, ctx.user);
    await audit(ctx.user, 'field_collect', 'transaction', row.id, { amount, method: b.method });
    ctx.json(200, { row });
  });

  // ---------- אירוע בזמן אמת ----------
  r.get('/api/events/:id/live', async (ctx) => {
    requirePerm(ctx, 'events.read');
    const ev = await one('SELECT * FROM events WHERE id = $1', [ctx.params.id]);
    if (!ev) throw new HttpError(404, 'אירוע לא נמצא');
    const guests = await many(`SELECT g.*, COALESCE(${DONOR_LABEL}, g.name) AS display_name, COALESCE(d.phone, g.phone) AS display_phone
      FROM event_guests g LEFT JOIN donors d ON d.id = g.donor_id WHERE g.event_id = $1 ORDER BY g.table_no NULLS LAST, display_name`, [ev.id]);
    const totals = await one(`SELECT COUNT(*) FILTER (WHERE rsvp='yes')::int AS yes, COUNT(*) FILTER (WHERE rsvp='no')::int AS no,
      COUNT(*) FILTER (WHERE rsvp='pending')::int AS pending, COALESCE(SUM(seats) FILTER (WHERE rsvp='yes'),0)::int AS seats,
      COUNT(*) FILTER (WHERE arrived)::int AS arrived, COALESCE(SUM(pledged_amount),0) AS pledged, COALESCE(SUM(paid_amount),0) AS paid
      FROM event_guests WHERE event_id = $1`, [ev.id]);
    const live = ev.campaign_id ? await one("SELECT COALESCE(SUM(amount_ils),0) AS total FROM transactions WHERE campaign_id = $1 AND status = 'paid'", [ev.campaign_id]) : { total: 0 };
    ctx.json(200, { event: ev, guests, totals, live });
  });

  r.post('/api/events/:id/invite', async (ctx) => {
    requirePerm(ctx, 'events.write');
    const ids = (ctx.body.donor_ids || []).map(Number);
    let n = 0;
    for (const id of ids) {
      const ex = await one('SELECT id FROM event_guests WHERE event_id = $1 AND donor_id = $2', [ctx.params.id, id]);
      if (!ex) { await query('INSERT INTO event_guests (event_id, donor_id) VALUES ($1,$2)', [ctx.params.id, id]); n++; }
    }
    ctx.json(200, { added: n });
  });

  // ייבוא תורמים מקובץ (השורות מפוענחות בצד הלקוח)
  r.post('/api/import/donors', async (ctx) => {
    requirePerm(ctx, 'donors.write');
    const rows = ctx.body.rows || [];
    let created = 0; let linked = 0; let skipped = 0;
    const fields = RESOURCES.donors.fields.map((f) => f.key);
    for (const raw of rows.slice(0, 5000)) {
      const data = {};
      for (const k of fields) if (raw[k] !== undefined && raw[k] !== '') data[k] = raw[k];
      if (!data.first_name && !data.last_name) { skipped++; continue; }
      if (data.phone) data.phone = normalizePhone(data.phone);
      if (typeof data.tags === 'string') data.tags = data.tags.split(',').map((s) => s.trim()).filter(Boolean);
      const cleaned = cleanBody(RESOURCES.donors, data, { creating: true });
      const dup = await one('SELECT id FROM donors WHERE (phone IS NOT NULL AND phone = $1) OR (id_number IS NOT NULL AND id_number = $2) LIMIT 1', [cleaned.phone || '-', cleaned.id_number || '-']);
      if (dup) { linked++; continue; }
      await insert('donors', cleaned, fields);
      created++;
    }
    await audit(ctx.user, 'import_donors', 'donors', null, { created, linked, skipped });
    ctx.json(200, { created, linked, skipped });
  });

  r.get('/api/purposes/options', async (ctx) => {
    requireUser(ctx);
    ctx.json(200, { rows: await many('SELECT id, name, institution_id, default_amount FROM purposes WHERE active = TRUE ORDER BY name') });
  });
}

export { toIls };
