import { query, one, many, insert } from '../lib/db.js';
import { HttpError } from '../lib/router.js';
import { requirePerm, requireUser } from '../auth.js';
import { can } from '../roles.js';
import { audit } from '../audit.js';
import { getSetting, setSetting, DEFAULTS } from '../settings.js';
import { envInfo, isSandbox } from '../env.js';
import { listProviders, saveProvider, testProvider, syncProvider, providerState, recordTransaction, upsertDonorFromSource } from '../providers/engine.js';
import { CATEGORIES, CAPABILITY_LABELS, getProvider } from '../providers/registry.js';
import { toHebrew, nextOccurrence, isoDate, HEB_MONTHS } from '../lib/hebrew.js';
import { runDailyAutomations } from '../automations.js';
import { normalizePhone } from '../lib/security.js';
import { RESOURCES } from '../resources.js';
import { seedDemo, clearDemo, demoCounts } from '../seed.js';

const DONOR_LABEL = "TRIM(COALESCE(d.title || ' ','') || COALESCE(d.first_name,'') || ' ' || COALESCE(d.last_name,''))";

function toCsv(rows, columns) {
  const cols = columns || Object.keys(rows[0] || {});
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    if (Array.isArray(v)) v = v.join(', ');
    if (typeof v === 'object') v = JSON.stringify(v);
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')}`;
}

const SETTINGS_PERMS = { org: 'settings.org', theme: 'settings.org', site: 'settings.org', rates: 'settings.org', documents: 'settings.org' };

export function registerSystemRoutes(r) {
  // ---------- ציבורי ----------
  r.get('/api/public/site', async (ctx) => {
    const [org, theme, site] = await Promise.all([getSetting('org'), getSetting('theme'), getSetting('site')]);
    ctx.json(200, { org, theme, site, env: envInfo(), hebrewToday: toHebrew(new Date()).text });
  });

  r.post('/api/public/contact', async (ctx) => {
    const { name, phone, email, subject, message, website } = ctx.body;
    if (website) return ctx.json(200, { ok: true }); // מלכודת בוטים
    if (!name || (!phone && !email) || !message) throw new HttpError(400, 'יש למלא שם, טלפון או מייל, והודעה');
    if (String(message).length > 3000) throw new HttpError(400, 'ההודעה ארוכה מדי');
    await insert('contact_messages', { name, phone: normalizePhone(phone) || null, email: email || null, subject: subject || null, message });
    await query("INSERT INTO notifications (title, body, link, roles) VALUES ($1,$2,'/app/r/contact_messages', '{developer,manager,secretary}')", [`פנייה חדשה מהאתר: ${name}`, String(message).slice(0, 140)]);
    ctx.json(200, { ok: true });
  });

  r.post('/api/public/spiritual', async (ctx) => {
    const { kind, name_for, mother_name, request, contact_name, contact_phone, website } = ctx.body;
    if (website) return ctx.json(200, { ok: true });
    if (!name_for || !contact_phone) throw new HttpError(400, 'יש למלא שם לתפילה/הנצחה וטלפון');
    const allowed = ['prayer', 'pidyon', 'memorial', 'tikun', 'kaddish', 'learning', 'parnas'];
    await insert('spiritual_orders', {
      kind: allowed.includes(kind) ? kind : 'prayer', name_for, mother_name: mother_name || null, request: request || null,
      contact_name: contact_name || null, contact_phone: normalizePhone(contact_phone), source: 'website', status: 'pending',
    });
    const org = await getSetting('org');
    ctx.json(200, { ok: true, donation_url: org.donation_url });
  });

  r.get('/api/public/hebdate', async (ctx) => {
    ctx.json(200, { today: toHebrew(new Date()) });
  });

  // ---------- אזור תורם ----------
  r.get('/api/donor/me', async (ctx) => {
    if (!ctx.donor) throw new HttpError(401, 'נדרשת כניסה');
    const id = ctx.donor.id;
    const [transactions, documents, keva] = await Promise.all([
      many("SELECT id, date, amount, currency, method, status, kind FROM transactions WHERE donor_id = $1 AND status IN ('paid','refunded') ORDER BY date DESC LIMIT 200", [id]),
      many("SELECT id, type, number, amount, currency, issued_at, pdf_url, tax_report_number, status FROM documents WHERE donor_id = $1 ORDER BY issued_at DESC", [id]),
      many("SELECT id, amount, currency, type, status, day_of_month, card_last4, next_charge_date FROM standing_orders WHERE donor_id = $1 ORDER BY status, id DESC", [id]),
    ]);
    const d = ctx.donor;
    ctx.json(200, { donor: { name: `${d.first_name || ''} ${d.last_name || ''}`.trim(), email: d.email, phone: d.phone }, transactions, documents, keva });
  });

  r.post('/api/donor/request', async (ctx) => {
    if (!ctx.donor) throw new HttpError(401, 'נדרשת כניסה');
    const { kind, message } = ctx.body;
    await insert('call_tasks', { donor_id: ctx.donor.id, reason: kind === 'card' ? 'failed_charge' : 'follow_up', priority: 1, notes: `בקשת תורם מהאזור האישי: ${message || kind}` });
    ctx.json(200, { ok: true });
  });

  // ---------- לוח שנה עברי ----------
  r.get('/api/calendar', async (ctx) => {
    requirePerm(ctx, 'donors.read');
    const days = Math.min(Number(ctx.query.days) || 30, 120);
    const today = new Date();
    const end = new Date(today.getTime() + days * 86400000);
    const rows = await many(`SELECT dd.*, ${DONOR_LABEL} AS donor_name, d.phone FROM donor_dates dd JOIN donors d ON d.id = dd.donor_id
      WHERE dd.hebrew_day IS NOT NULL AND dd.hebrew_month IS NOT NULL ${ctx.query.demo === 'hide' ? 'AND dd.is_demo = FALSE' : ''}`);
    const items = [];
    for (const row of rows) {
      const occ = nextOccurrence(row.hebrew_day, row.hebrew_month, today);
      if (occ && occ <= end) items.push({ ...row, date: isoDate(occ), hebrew: toHebrew(occ).text, days_left: Math.round((occ - new Date(today.setHours(12, 0, 0, 0))) / 86400000) });
    }
    items.sort((a, b) => a.date.localeCompare(b.date));
    ctx.json(200, { today: toHebrew(new Date()), items, months: HEB_MONTHS });
  });

  r.get('/api/hebrew/convert', async (ctx) => {
    requireUser(ctx);
    if (ctx.query.date) return ctx.json(200, toHebrew(ctx.query.date));
    const occ = nextOccurrence(Number(ctx.query.day), ctx.query.month);
    ctx.json(200, { next: occ ? isoDate(occ) : null, hebrew: occ ? toHebrew(occ).text : null });
  });

  // ---------- מוקד טלפוני ----------
  r.get('/api/calls/queue', async (ctx) => {
    requirePerm(ctx, 'calls.read');
    const mine = ctx.query.all === 'true' && can(ctx.user, 'calls.manage') ? '' : `AND (c.assigned_user_id = ${Number(ctx.user.id)} OR c.assigned_user_id IS NULL)`;
    const rows = await many(`SELECT c.*, ${DONOR_LABEL} AS donor_name, d.phone, d.phone2, d.city, d.is_vip, u.name AS agent,
      (SELECT COALESCE(SUM(amount_ils),0) FROM transactions t WHERE t.donor_id = d.id AND t.status='paid' AND t.date > CURRENT_DATE - 365) AS year_total,
      (SELECT MAX(date) FROM transactions t WHERE t.donor_id = d.id AND t.status='paid') AS last_donation,
      (SELECT string_agg(amount::text || ' ' || currency, ', ') FROM standing_orders s WHERE s.donor_id = d.id AND s.status='active') AS keva,
      (SELECT summary FROM interactions i WHERE i.donor_id = d.id ORDER BY at DESC LIMIT 1) AS last_note
      FROM call_tasks c JOIN donors d ON d.id = c.donor_id LEFT JOIN users u ON u.id = c.assigned_user_id
      WHERE c.status IN ('open','callback','no_answer') AND (c.due_date IS NULL OR c.due_date <= CURRENT_DATE + 1) ${mine}
      ORDER BY c.priority, c.due_date NULLS FIRST, c.created_at LIMIT 200`);
    ctx.json(200, { rows });
  });

  r.post('/api/calls/:id/outcome', async (ctx) => {
    requirePerm(ctx, 'calls.read');
    const task = await one('SELECT * FROM call_tasks WHERE id = $1', [ctx.params.id]);
    if (!task) throw new HttpError(404, 'משימה לא נמצאה');
    const { status, outcome, summary, callback_date, new_amount } = ctx.body;
    await query('UPDATE call_tasks SET status = $2, outcome = $3, due_date = COALESCE($4, due_date), assigned_user_id = COALESCE(assigned_user_id, $5) WHERE id = $1',
      [task.id, status || 'done', outcome || null, callback_date || null, ctx.user.id]);
    await insert('interactions', { donor_id: task.donor_id, user_id: ctx.user.id, kind: 'call', summary: summary || outcome || status, outcome: outcome || null, follow_up_date: callback_date || null });
    if (new_amount && task.standing_order_id && can(ctx.user, 'keva.actions')) {
      const { kevaAction } = await import('../providers/engine.js');
      await kevaAction(task.standing_order_id, 'amount', ctx.user, { amount: new_amount });
    }
    await audit(ctx.user, 'call_outcome', 'call_task', task.id, { status, outcome });
    ctx.json(200, { ok: true });
  });

  // יצירת תור שיחות אוטומטי: מבצע הגדלה / חידוש הו"ק / רדומים / יארצייט
  r.post('/api/calls/generate', async (ctx) => {
    requirePerm(ctx, 'calls.manage');
    const { kind, assigned_user_id, campaign_id, min_amount, max_amount, months } = ctx.body;
    let rows = [];
    if (kind === 'upgrade') {
      rows = await many(`SELECT DISTINCT s.donor_id, s.id AS so_id FROM standing_orders s JOIN donors d ON d.id = s.donor_id WHERE s.status = 'active' AND d.no_contact = FALSE
        AND s.amount >= $1 AND s.amount <= $2 AND s.created_at < now() - interval '6 months'
        AND NOT EXISTS (SELECT 1 FROM call_tasks c WHERE c.donor_id = s.donor_id AND c.reason = 'upgrade' AND c.status IN ('open','callback','no_answer'))`, [Number(min_amount) || 0, Number(max_amount) || 1e9]);
    } else if (kind === 'renewal') {
      rows = await many(`SELECT DISTINCT s.donor_id, s.id AS so_id FROM standing_orders s JOIN donors d ON d.id = s.donor_id WHERE d.no_contact = FALSE
        AND (s.status IN ('cancelled','ended') AND COALESCE(s.cancelled_at, s.end_date::timestamptz) > now() - interval '90 days' OR (s.status = 'active' AND s.end_date < CURRENT_DATE + 45))
        AND NOT EXISTS (SELECT 1 FROM call_tasks c WHERE c.donor_id = s.donor_id AND c.reason = 'renewal' AND c.status IN ('open','callback','no_answer'))`);
    } else if (kind === 'dormant') {
      rows = await many(`SELECT d.id AS donor_id, NULL AS so_id FROM donors d WHERE d.no_contact = FALSE AND d.status <> 'deceased'
        AND EXISTS (SELECT 1 FROM transactions t WHERE t.donor_id = d.id AND t.status = 'paid')
        AND (SELECT MAX(date) FROM transactions t WHERE t.donor_id = d.id AND t.status = 'paid') < CURRENT_DATE - ($1 || ' months')::interval
        AND NOT EXISTS (SELECT 1 FROM standing_orders s WHERE s.donor_id = d.id AND s.status = 'active')
        AND NOT EXISTS (SELECT 1 FROM call_tasks c WHERE c.donor_id = d.id AND c.status IN ('open','callback','no_answer')) LIMIT 500`, [Number(months) || 12]);
    } else if (kind === 'failed') {
      rows = await many(`SELECT DISTINCT t.donor_id, t.standing_order_id AS so_id FROM transactions t WHERE t.status IN ('failed','bounced') AND t.date > CURRENT_DATE - 30
        AND NOT EXISTS (SELECT 1 FROM call_tasks c WHERE c.donor_id = t.donor_id AND c.reason = 'failed_charge' AND c.status IN ('open','callback','no_answer'))`);
    } else throw new HttpError(400, 'סוג לא מוכר');
    const reason = { upgrade: 'upgrade', renewal: 'renewal', dormant: 'follow_up', failed: 'failed_charge' }[kind];
    for (const x of rows) {
      await query('INSERT INTO call_tasks (donor_id, assigned_user_id, reason, priority, due_date, campaign_id, standing_order_id) VALUES ($1,$2,$3,$4, CURRENT_DATE, $5, $6)',
        [x.donor_id, assigned_user_id || null, reason, kind === 'failed' ? 1 : 2, campaign_id || null, x.so_id || null]);
    }
    await audit(ctx.user, 'calls_generate', 'call_tasks', null, { kind, count: rows.length });
    ctx.json(200, { created: rows.length });
  });

  // ---------- דוחות ----------
  r.get('/api/reports/:kind', async (ctx) => {
    requirePerm(ctx, 'reports.read');
    const from = ctx.query.from || `${new Date().getFullYear()}-01-01`;
    const to = ctx.query.to || isoDate(new Date());
    const demo = ctx.query.demo === 'hide' ? 'AND t.is_demo = FALSE' : '';
    const inst = ctx.user.active_role === 'institution_manager' ? `AND t.institution_id = ${Number(ctx.user.institution_id) || -1}` : '';
    let rows; let columns; let title;
    switch (ctx.params.kind) {
      case 'by_source':
        title = 'הכנסות לפי מקור';
        rows = await many(`SELECT source AS "מקור", COUNT(*)::int AS "תנועות", SUM(amount_ils) AS "סה״כ ₪" FROM transactions t WHERE status='paid' AND date BETWEEN $1 AND $2 ${demo} ${inst} GROUP BY source ORDER BY 3 DESC`, [from, to]);
        rows.forEach((x) => { x['מקור'] = getProvider(x['מקור'])?.label || (x['מקור'] === 'manual' ? 'ידני / משרד' : x['מקור']); });
        break;
      case 'by_institution':
        title = 'הכנסות לפי מוסד';
        rows = await many(`SELECT COALESCE(i.name,'לא משויך') AS "מוסד", COUNT(*)::int AS "תנועות", SUM(t.amount_ils) AS "סה״כ ₪" FROM transactions t LEFT JOIN institutions i ON i.id = t.institution_id WHERE t.status='paid' AND t.date BETWEEN $1 AND $2 ${demo} ${inst} GROUP BY 1 ORDER BY 3 DESC`, [from, to]);
        break;
      case 'by_month':
        title = 'הכנסות לפי חודש';
        rows = await many(`SELECT to_char(date,'YYYY-MM') AS "חודש", SUM(amount_ils) FILTER (WHERE kind='keva') AS "הו״ק ₪", SUM(amount_ils) FILTER (WHERE kind<>'keva') AS "חד-פעמי ₪", SUM(amount_ils) AS "סה״כ ₪", COUNT(DISTINCT donor_id)::int AS "תורמים" FROM transactions t WHERE status='paid' AND date BETWEEN $1 AND $2 ${demo} ${inst} GROUP BY 1 ORDER BY 1`, [from, to]);
        break;
      case 'by_recruiter':
        title = 'ביצועים לפי נציג / מתרים';
        rows = await many(`SELECT COALESCE(u.name,'ללא נציג') AS "נציג", COUNT(*)::int AS "תנועות", SUM(t.amount_ils) AS "סה״כ ₪", COUNT(DISTINCT t.donor_id)::int AS "תורמים",
          (SELECT COUNT(*)::int FROM standing_orders s WHERE s.recruiter_user_id = u.id AND s.created_at BETWEEN $1 AND ($2::date + 1)) AS "הו״ק חדשות",
          (SELECT COUNT(*)::int FROM call_tasks c WHERE c.assigned_user_id = u.id AND c.status = 'done' AND c.created_at BETWEEN $1 AND ($2::date + 1)) AS "שיחות שבוצעו"
          FROM transactions t LEFT JOIN users u ON u.id = t.recruiter_user_id WHERE t.status='paid' AND t.date BETWEEN $1 AND $2 ${demo} GROUP BY u.id, u.name ORDER BY 3 DESC`, [from, to]);
        break;
      case 'forecast': {
        title = 'תחזית הכנסות מהו״ק - 12 חודשים';
        const rates = await getSetting('rates');
        const sos = await many(`SELECT amount, currency, start_date, end_date, months_total, months_paid FROM standing_orders s WHERE status = 'active' ${ctx.query.demo === 'hide' ? 'AND is_demo = FALSE' : ''}`);
        rows = [];
        const now = new Date();
        for (let i = 0; i < 12; i++) {
          const m = new Date(now.getFullYear(), now.getMonth() + i, 15);
          let sum = 0; let count = 0;
          for (const s of sos) {
            if (s.end_date && new Date(s.end_date) < m) continue;
            if (s.months_total && s.months_paid + i >= s.months_total) continue;
            sum += Number(s.amount) * (s.currency === 'ILS' ? 1 : Number(rates?.[s.currency] || 1));
            count++;
          }
          rows.push({ 'חודש': `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, 'הו״ק פעילות': count, 'צפי ₪': Math.round(sum) });
        }
        break;
      }
      case 'churn':
        title = 'נטישת הו״ק (בוטלו / הסתיימו)';
        rows = await many(`SELECT ${DONOR_LABEL} AS "תורם", d.phone AS "טלפון", s.amount AS "סכום", s.currency AS "מטבע", s.status AS "סטטוס",
          COALESCE(s.cancelled_at::date, s.end_date) AS "תאריך", s.cancel_reason AS "סיבה", s.source AS "מקור"
          FROM standing_orders s JOIN donors d ON d.id = s.donor_id WHERE s.status IN ('cancelled','ended') AND COALESCE(s.cancelled_at::date, s.end_date) BETWEEN $1 AND $2 ORDER BY 6 DESC`, [from, to]);
        break;
      case 'dormant':
        title = 'תורמים רדומים (ללא תרומה 12 חודשים)';
        rows = await many(`SELECT ${DONOR_LABEL} AS "תורם", d.phone AS "טלפון", d.city AS "עיר", MAX(t.date) AS "תרומה אחרונה", SUM(t.amount_ils) AS "סה״כ היסטורי ₪"
          FROM donors d JOIN transactions t ON t.donor_id = d.id AND t.status = 'paid' GROUP BY d.id HAVING MAX(t.date) < CURRENT_DATE - 365 ORDER BY 5 DESC LIMIT 1000`);
        break;
      case 'campaigns':
        title = 'קמפיינים מול יעד';
        rows = await many(`SELECT c.name AS "קמפיין", c.goal AS "יעד ₪", COALESCE(SUM(t.amount_ils),0) AS "גויס ₪", CASE WHEN c.goal > 0 THEN ROUND(COALESCE(SUM(t.amount_ils),0) / c.goal * 100) END AS "%", COUNT(t.id)::int AS "תרומות"
          FROM campaigns c LEFT JOIN transactions t ON t.campaign_id = c.id AND t.status = 'paid' GROUP BY c.id ORDER BY c.start_date DESC NULLS LAST`);
        break;
      case 'boxes':
        title = 'קופות צדקה - איסוף והכנסות';
        rows = await many(`SELECT b.code AS "קופה", b.location_name AS "מיקום", b.neighborhood AS "שכונה", b.last_collected_at AS "איסוף אחרון",
          b.last_collected_at + b.collection_interval_days AS "איסוף הבא", COALESCE((SELECT SUM(amount) FROM box_collections c WHERE c.box_id = b.id AND c.collected_at BETWEEN $1 AND $2),0) AS "נאסף בתקופה ₪"
          FROM tzedaka_boxes b WHERE b.active = TRUE ORDER BY 5 NULLS FIRST`, [from, to]);
        break;
      case 'documents':
        title = 'מסמכים ודיווח לרשות המסים';
        rows = await many(`SELECT dc.number AS "מספר", dc.type AS "סוג", dc.issued_at::date AS "תאריך", ${DONOR_LABEL} AS "תורם", d.id_number AS "ת.ז.", dc.amount AS "סכום", dc.currency AS "מטבע",
          dc.tax_report_status AS "דיווח", dc.tax_report_number AS "מספר דיווח", dc.status AS "סטטוס", dc.provider AS "ספק"
          FROM documents dc LEFT JOIN donors d ON d.id = dc.donor_id WHERE dc.issued_at::date BETWEEN $1 AND $2 ORDER BY dc.issued_at`, [from, to]);
        break;
      case 'accountant':
        title = 'ייצוא לרואה חשבון';
        rows = await many(`SELECT t.serial AS "אסמכתא", t.date AS "תאריך", ${DONOR_LABEL} AS "תורם", d.id_number AS "ת.ז.", t.amount AS "סכום", t.currency AS "מטבע", t.amount_ils AS "סכום ₪",
          t.method AS "אמצעי", t.source AS "מקור", i.name AS "מוסד", dc.number AS "מס׳ קבלה", t.status AS "סטטוס"
          FROM transactions t LEFT JOIN donors d ON d.id = t.donor_id LEFT JOIN institutions i ON i.id = t.institution_id LEFT JOIN documents dc ON dc.id = t.document_id
          WHERE t.date BETWEEN $1 AND $2 ${demo} ORDER BY t.date, t.id`, [from, to]);
        break;
      default: throw new HttpError(404, 'דוח לא קיים');
    }
    if (ctx.query.format === 'csv') {
      return ctx.send(200, toCsv(rows, columns), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="report-${ctx.params.kind}.csv"` });
    }
    ctx.json(200, { title, rows, from, to });
  });

  // ייצוא כללי של כל מודול
  r.get('/api/export/:res', async (ctx) => {
    const res = RESOURCES[ctx.params.res];
    if (!res) throw new HttpError(404, 'לא קיים');
    requirePerm(ctx, res.perms.read);
    const rows = await many(`SELECT * FROM ${res.table} ORDER BY id`);
    const cols = ['id', ...res.fields.filter((f) => f.type !== 'file').map((f) => f.key)];
    const header = Object.fromEntries(cols.map((c) => [c, res.fields.find((f) => f.key === c)?.label || c]));
    const mapped = rows.map((r0) => Object.fromEntries(cols.map((c) => [header[c], r0[c]])));
    await audit(ctx.user, 'export', ctx.params.res, null, { count: rows.length });
    ctx.send(200, toCsv(mapped), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${ctx.params.res}.csv"` });
  });

  // ---------- ספקים / חיבורים ----------
  r.get('/api/providers', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    const runs = await many('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 30');
    ctx.json(200, { providers: await listProviders(), categories: CATEGORIES, capabilities: CAPABILITY_LABELS, runs, env: envInfo() });
  });

  r.put('/api/providers/:key', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    await saveProvider(ctx.params.key, ctx.body, ctx.user);
    ctx.json(200, { ok: true });
  });

  r.post('/api/providers/:key/test', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    ctx.json(200, await testProvider(ctx.params.key, ctx.user));
  });

  r.post('/api/providers/:key/sync', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    ctx.json(200, await syncProvider(ctx.params.key, ctx.user));
  });

  // נקודת קליטה ל-Webhooks של ספקים (אימות בסוד משותף)
  r.post('/api/webhooks/:key', async (ctx) => {
    const def = getProvider(ctx.params.key);
    if (!def) throw new HttpError(404, 'ספק לא מוכר');
    const st = await providerState(ctx.params.key);
    const secret = st.secrets.webhook_secret;
    if (!secret || ctx.query.secret !== secret) throw new HttpError(401, 'סוד Webhook שגוי');
    const b = ctx.body;
    const ext = b.transaction_id || b.transactionId || b.id || b.TransactionId;
    if (!ext) throw new HttpError(400, 'חסר מזהה תנועה');
    const donorId = await upsertDonorFromSource(ctx.params.key, b.customer_id || b.payer_id || b.phone || ext, {
      first_name: b.first_name || b.fullName || b.ClientName || 'תורם', last_name: b.last_name || '', phone: b.phone || b.Phone,
      email: b.email || b.Mail, id_number: b.id_number || b.Zeout, raw: b,
    });
    const failed = /fail|declin|סירוב|נכשל/i.test(String(b.status || b.Status || ''));
    const { row, created } = await recordTransaction({
      donor_id: donorId, source: ctx.params.key, external_id: String(ext), kind: /keva|recurr|הוראת קבע/i.test(JSON.stringify(b)) ? 'keva' : 'one_time',
      method: 'credit', amount: Number(b.sum || b.amount || b.Amount || 0), currency: b.currency || 'ILS', status: failed ? 'failed' : 'paid', raw: b,
    }, null);
    await audit(null, 'webhook', 'provider', ctx.params.key, { tx: row.id, created });
    ctx.json(200, { ok: true });
  });

  // ---------- הגדרות ----------
  r.get('/api/settings/:key', async (ctx) => {
    requirePerm(ctx, 'staff');
    if (!DEFAULTS[ctx.params.key]) throw new HttpError(404, 'הגדרה לא קיימת');
    ctx.json(200, { value: await getSetting(ctx.params.key), defaults: DEFAULTS[ctx.params.key] });
  });

  r.put('/api/settings/:key', async (ctx) => {
    const perm = SETTINGS_PERMS[ctx.params.key];
    if (!perm) throw new HttpError(404, 'הגדרה לא קיימת');
    requirePerm(ctx, perm);
    await setSetting(ctx.params.key, ctx.body.value);
    await audit(ctx.user, 'settings_update', 'settings', ctx.params.key, {});
    ctx.json(200, { ok: true });
  });

  // ---------- התראות ----------
  r.get('/api/notifications', async (ctx) => {
    requireUser(ctx);
    const rows = await many(`SELECT id, title, body, link, at, $1 = ANY(read_by) AS read FROM notifications
      WHERE (user_id = $1 OR $2 = ANY(roles) OR (user_id IS NULL AND cardinality(roles) = 0)) ORDER BY at DESC LIMIT 50`, [ctx.user.id, ctx.user.active_role]);
    ctx.json(200, { rows, unread: rows.filter((x) => !x.read).length });
  });

  r.post('/api/notifications/read', async (ctx) => {
    requireUser(ctx);
    await query('UPDATE notifications SET read_by = array_append(read_by, $1) WHERE NOT ($1 = ANY(read_by)) AND (id = ANY($2::bigint[]) OR $3)', [ctx.user.id, ctx.body.ids || [], !!ctx.body.all]);
    ctx.json(200, { ok: true });
  });

  // ---------- יומן פעולות ----------
  r.get('/api/audit', async (ctx) => {
    requirePerm(ctx, 'audit.read');
    const params = [];
    const conds = [];
    if (ctx.query.user_id) { params.push(Number(ctx.query.user_id)); conds.push(`a.user_id = $${params.length}`); }
    if (ctx.query.entity) { params.push(ctx.query.entity); conds.push(`a.entity = $${params.length}`); }
    if (ctx.query.action) { params.push(`%${ctx.query.action}%`); conds.push(`a.action ILIKE $${params.length}`); }
    if (ctx.query.from) { params.push(ctx.query.from); conds.push(`a.at >= $${params.length}`); }
    if (ctx.query.impersonated === 'true') conds.push('a.impersonator_id IS NOT NULL');
    const page = Math.max(Number(ctx.query.page) || 1, 1);
    const rows = await many(`SELECT a.*, u.name AS user_name, iu.name AS impersonator_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN users iu ON iu.id = a.impersonator_id ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY a.at DESC LIMIT 100 OFFSET ${(page - 1) * 100}`, params);
    ctx.json(200, { rows, page });
  });

  // ---------- נתוני דוגמה ----------
  r.get('/api/demo/preview', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    ctx.json(200, await demoCounts());
  });

  r.post('/api/demo/seed', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    const existing = await demoCounts();
    if (existing.total > 0 && !ctx.body.force) throw new HttpError(409, 'כבר קיימים נתוני דוגמה. יש לנקות לפני יצירה מחדש');
    const result = await seedDemo();
    await audit(ctx.user, 'demo_seed', 'demo', null, result);
    ctx.json(200, result);
  });

  r.post('/api/demo/clear', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    if (ctx.body.confirm !== 'מחק נתוני דוגמה') throw new HttpError(400, 'יש להקליד את משפט האישור');
    const result = await clearDemo();
    await audit(ctx.user, 'demo_clear', 'demo', null, result);
    ctx.json(200, result);
  });

  // ---------- מערכת ----------
  r.get('/api/system/status', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    const tables = ['donors', 'transactions', 'standing_orders', 'documents', 'users', 'call_tasks', 'messages_out', 'audit_log'];
    const counts = {};
    for (const t of tables) counts[t] = (await one(`SELECT COUNT(*)::int AS c FROM ${t}`)).c;
    const db = await one('SELECT version() AS v, current_database() AS name, pg_size_pretty(pg_database_size(current_database())) AS size');
    ctx.json(200, {
      env: envInfo(), counts, db,
      node: process.version, uptime: Math.round(process.uptime()),
      secrets: { SESSION_SECRET: !!process.env.SESSION_SECRET, DATABASE_URL: !!process.env.DATABASE_URL, APP_MODE: process.env.APP_MODE || 'development', FORCE_SANDBOX: process.env.FORCE_SANDBOX || 'true (ברירת מחדל)' },
    });
  });

  r.post('/api/automations/run', async (ctx) => {
    requirePerm(ctx, 'automations.write');
    const res = await runDailyAutomations();
    await audit(ctx.user, 'automations_run', 'automations', null, res);
    ctx.json(200, res);
  });
}
