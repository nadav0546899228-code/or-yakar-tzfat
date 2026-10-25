// חיפוש כללי, פעולות מרובות, ייבוא כללי והודעות פנימיות
import { query, one, many, insert } from '../lib/db.js';
import { HttpError } from '../lib/router.js';
import { requirePerm, requireUser } from '../auth.js';
import { can } from '../roles.js';
import { audit, notify } from '../audit.js';
import { RESOURCES, OPTIONS, writableFields } from '../resources.js';
import { cleanBody, LABEL_SQL } from './crud.js';

const DONOR_NAME = "TRIM(COALESCE(d.title || ' ','') || COALESCE(d.first_name,'') || ' ' || COALESCE(d.last_name,''))";

function getRes(key) {
  const r = RESOURCES[key];
  if (!r) throw new HttpError(404, 'מודול לא קיים');
  return r;
}

export function registerExtraRoutes(r) {
  // ---------- חיפוש אחד לכל המערכת ----------
  r.get('/api/search', async (ctx) => {
    requirePerm(ctx, 'staff');
    const q = String(ctx.query.q || '').trim();
    if (q.length < 2) { ctx.json(200, { results: [] }); return; }
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, '');
    const results = [];
    if (can(ctx.user, 'donors.read')) {
      const donors = await many(`SELECT d.id, ${DONOR_NAME} AS name, d.phone, d.city FROM donors d
        WHERE ${DONOR_NAME} ILIKE $1 OR d.email ILIKE $1 OR d.city ILIKE $1 OR d.id_number ILIKE $1
        ${digits.length >= 4 ? 'OR regexp_replace(COALESCE(d.phone,\'\'), \'\\D\', \'\', \'g\') LIKE $2 OR regexp_replace(COALESCE(d.phone2,\'\'), \'\\D\', \'\', \'g\') LIKE $2' : ''}
        ORDER BY d.id DESC LIMIT 8`, digits.length >= 4 ? [like, `%${digits}%`] : [like]);
      donors.forEach((d) => results.push({ type: 'donor', id: d.id, title: d.name || `תורם #${d.id}`, sub: [d.phone, d.city].filter(Boolean).join(' · '), link: `/app/donors/${d.id}` }));
    }
    if (can(ctx.user, 'tx.read')) {
      const amount = Number(q.replace(/[,₪\s]/g, ''));
      const tx = await many(`SELECT t.id, t.serial, t.amount, t.currency, t.date, t.donor_id, ${DONOR_NAME} AS donor FROM transactions t LEFT JOIN donors d ON d.id = t.donor_id
        WHERE t.serial ILIKE $1 OR t.external_id ILIKE $1 OR t.check_number ILIKE $1 OR t.dedication ILIKE $1 ${Number.isFinite(amount) && amount > 0 ? 'OR t.amount = $2' : ''}
        ORDER BY t.date DESC LIMIT 6`, Number.isFinite(amount) && amount > 0 ? [like, amount] : [like]);
      tx.forEach((t) => results.push({ type: 'tx', id: t.id, title: `תרומה ${Number(t.amount).toLocaleString('he-IL')} ${t.currency === 'ILS' ? '₪' : t.currency}`, sub: [t.donor, String(t.date).slice(0, 10), t.serial].filter(Boolean).join(' · '), link: t.donor_id ? `/app/donors/${t.donor_id}` : '/app/transactions' }));
    }
    if (can(ctx.user, 'docs.read')) {
      const docs = await many(`SELECT x.id, x.number, x.amount, x.donor_id, ${DONOR_NAME} AS donor FROM documents x LEFT JOIN donors d ON d.id = x.donor_id
        WHERE x.number ILIKE $1 ORDER BY x.id DESC LIMIT 5`, [like]);
      docs.forEach((x) => results.push({ type: 'doc', id: x.id, title: `קבלה ${x.number}`, sub: [x.donor, x.amount ? `${Number(x.amount).toLocaleString('he-IL')} ₪` : ''].filter(Boolean).join(' · '), link: x.donor_id ? `/app/donors/${x.donor_id}` : '/app/documents' }));
    }
    const pages = [['campaigns', 'קמפיין', 'name'], ['events', 'אירוע', 'name'], ['institutions', 'מוסד', 'name']];
    for (const [res, label, col] of pages) {
      const def = RESOURCES[res];
      if (!def || !can(ctx.user, def.perms.read)) continue;
      const rows = await many(`SELECT id, ${col} AS name FROM ${def.table} WHERE ${col} ILIKE $1 LIMIT 3`, [like]);
      rows.forEach((x) => results.push({ type: res, id: x.id, title: `${label}: ${x.name}`, sub: '', link: res === 'events' ? `/app/events/${x.id}` : `/app/r/${res}` }));
    }
    ctx.json(200, { results });
  });

  // ---------- פעולה אחת על כמה שורות ----------
  r.post('/api/r/:res/bulk', async (ctx) => {
    const res = getRes(ctx.params.res);
    if (res.readonly) throw new HttpError(400, 'מודול לקריאה בלבד');
    requirePerm(ctx, res.perms.write);
    const ids = (ctx.body.ids || []).map(Number).filter(Boolean).slice(0, 500);
    if (!ids.length) throw new HttpError(400, 'לא נבחרו שורות');
    const { action } = ctx.body;
    if (action === 'delete') {
      const reason = String(ctx.body.reason || '').trim();
      if (!reason) throw new HttpError(400, 'יש לציין סיבת מחיקה');
      const rows = await many(`SELECT id FROM ${res.table} WHERE id = ANY($1::int[])`, [ids]);
      await query(`DELETE FROM ${res.table} WHERE id = ANY($1::int[])`, [rows.map((x) => x.id)]);
      await audit(ctx.user, 'delete', ctx.params.res, null, { count: rows.length, ids: rows.map((x) => x.id), reason });
      ctx.json(200, { ok: true, count: rows.length, message: `נמחקו ${rows.length} רשומות` });
      return;
    }
    if (action === 'set') {
      const field = res.fields.find((f) => f.key === ctx.body.field);
      if (!field || !writableFields(res).includes(field.key) || ['file'].includes(field.type)) throw new HttpError(400, 'שדה לא ניתן לעדכון מרוכז');
      const data = cleanBody({ ...res, fields: [field] }, { [field.key]: ctx.body.value }, { creating: false });
      await query(`UPDATE ${res.table} SET ${field.key} = $1 WHERE id = ANY($2::int[])`, [data[field.key] ?? null, ids]);
      await audit(ctx.user, 'update', ctx.params.res, null, { count: ids.length, field: field.key, bulk: true });
      ctx.json(200, { ok: true, count: ids.length, message: `עודכנו ${ids.length} רשומות` });
      return;
    }
    if (action === 'add_tag') {
      const field = res.fields.find((f) => f.type === 'tags');
      const tag = String(ctx.body.value || '').trim();
      if (!field || !tag) throw new HttpError(400, 'אין תגית להוספה');
      await query(`UPDATE ${res.table} SET ${field.key} = array_append(COALESCE(${field.key}, '{}'), $1) WHERE id = ANY($2::int[]) AND NOT ($1 = ANY(COALESCE(${field.key}, '{}')))`, [tag, ids]);
      await audit(ctx.user, 'update', ctx.params.res, null, { count: ids.length, add_tag: tag, bulk: true });
      ctx.json(200, { ok: true, message: `התגית "${tag}" נוספה ל-${ids.length} רשומות` });
      return;
    }
    throw new HttpError(400, 'פעולה לא מוכרת');
  });

  // ---------- ייבוא כללי לכל מודול (מאקסל / CSV, לפי שמות העמודות בעברית) ----------
  r.post('/api/r/:res/import', async (ctx) => {
    const res = getRes(ctx.params.res);
    if (res.readonly) throw new HttpError(400, 'מודול לקריאה בלבד');
    requirePerm(ctx, res.perms.write);
    const rows = (ctx.body.rows || []).slice(0, 5000);
    const byLabel = Object.fromEntries(res.fields.flatMap((f) => [[f.label, f], [f.key, f]]));
    let created = 0;
    const errors = [];
    for (const [i, raw] of rows.entries()) {
      const body = {};
      for (const [k, v] of Object.entries(raw)) {
        const f = byLabel[String(k).replace(/\s*\*$/, '').trim()];
        if (!f || v === '' || v === null || v === undefined) continue;
        if (f.type === 'ref') {
          const table = RESOURCES[f.ref]?.table || f.ref;
          const exp = LABEL_SQL[f.ref] || 'name';
          const found = /^\d+$/.test(String(v)) ? { id: Number(v) } : await one(`SELECT id FROM ${table} WHERE ${exp} = $1 LIMIT 1`, [String(v).trim()]);
          if (found) body[f.key] = found.id;
          continue;
        }
        if (f.type === 'select') {
          const o = (OPTIONS[f.options] || []).find((x) => x.label === String(v).trim() || x.value === String(v).trim());
          body[f.key] = o ? o.value : v;
          continue;
        }
        body[f.key] = v;
      }
      try {
        const data = cleanBody(res, body, { creating: true });
        if (res.autoUser && !data[res.autoUser]) data[res.autoUser] = ctx.user.id;
        await insert(res.table, data, writableFields(res));
        created += 1;
      } catch (e) {
        errors.push(`שורה ${i + 2}: ${e.message}`);
      }
    }
    await audit(ctx.user, 'import', ctx.params.res, null, { created, failed: errors.length });
    ctx.json(200, { created, failed: errors.length, errors: errors.slice(0, 20) });
  });

  // ---------- הודעות פנימיות בין אנשי צוות ----------
  r.get('/api/inbox', async (ctx) => {
    requirePerm(ctx, 'staff');
    const box = ctx.query.box === 'sent' ? 'sent' : 'in';
    const rows = box === 'in'
      ? await many(`SELECT m.*, fu.name AS from_name, tu.name AS to_name FROM staff_messages m LEFT JOIN users fu ON fu.id = m.from_user LEFT JOIN users tu ON tu.id = m.to_user
          WHERE m.to_user = $1 AND NOT m.deleted_by_recipient ORDER BY m.at DESC LIMIT 200`, [ctx.user.id])
      : await many(`SELECT m.*, fu.name AS from_name, tu.name AS to_name FROM staff_messages m LEFT JOIN users fu ON fu.id = m.from_user LEFT JOIN users tu ON tu.id = m.to_user
          WHERE m.from_user = $1 AND NOT m.deleted_by_sender ORDER BY m.at DESC LIMIT 200`, [ctx.user.id]);
    const unread = (await one('SELECT COUNT(*)::int AS c FROM staff_messages WHERE to_user = $1 AND read_at IS NULL AND NOT deleted_by_recipient', [ctx.user.id])).c;
    ctx.json(200, { rows, unread });
  });

  r.get('/api/inbox/users', async (ctx) => {
    requirePerm(ctx, 'staff');
    ctx.json(200, { rows: await many("SELECT id, name, roles FROM users WHERE active = TRUE AND id <> $1 AND NOT ('donor' = ANY(roles)) ORDER BY name", [ctx.user.id]) });
  });

  r.post('/api/inbox', async (ctx) => {
    requirePerm(ctx, 'staff');
    const body = String(ctx.body.body || '').trim();
    if (!body) throw new HttpError(400, 'אין תוכן להודעה');
    let to = (ctx.body.to || []).map(Number).filter(Boolean);
    if (ctx.body.reply_to) {
      const orig = await one('SELECT from_user, to_user, subject FROM staff_messages WHERE id = $1 AND (to_user = $2 OR from_user = $2)', [ctx.body.reply_to, ctx.user.id]);
      if (!orig) throw new HttpError(404, 'ההודעה המקורית לא נמצאה');
      to = [orig.from_user === ctx.user.id ? orig.to_user : orig.from_user];
      ctx.body.subject = ctx.body.subject || (orig.subject ? `תשובה: ${orig.subject.replace(/^תשובה: /, '')}` : 'תשובה');
    }
    if (!to.length) throw new HttpError(400, 'לא נבחר נמען');
    const valid = await many('SELECT id FROM users WHERE id = ANY($1::int[]) AND active = TRUE', [to]);
    for (const u of valid) {
      await query('INSERT INTO staff_messages (from_user, to_user, subject, body, reply_to, link) VALUES ($1,$2,$3,$4,$5,$6)',
        [ctx.user.id, u.id, ctx.body.subject || null, body, ctx.body.reply_to || null, ctx.body.link || null]);
      await notify({ title: `הודעה מ${ctx.user.name}`, body: (ctx.body.subject ? `${ctx.body.subject}: ` : '') + body.slice(0, 80), link: '/app/inbox', userId: u.id, roles: [] });
    }
    ctx.json(200, { ok: true, count: valid.length });
  });

  r.post('/api/inbox/read', async (ctx) => {
    requirePerm(ctx, 'staff');
    const ids = (ctx.body.ids || []).map(Number);
    await query('UPDATE staff_messages SET read_at = COALESCE(read_at, now()) WHERE to_user = $1 AND id = ANY($2::bigint[])', [ctx.user.id, ids]);
    ctx.json(200, { ok: true });
  });

  r.post('/api/inbox/delete', async (ctx) => {
    requirePerm(ctx, 'staff');
    const ids = (ctx.body.ids || []).map(Number);
    await query('UPDATE staff_messages SET deleted_by_recipient = TRUE WHERE to_user = $1 AND id = ANY($2::bigint[])', [ctx.user.id, ids]);
    await query('UPDATE staff_messages SET deleted_by_sender = TRUE WHERE from_user = $1 AND id = ANY($2::bigint[])', [ctx.user.id, ids]);
    ctx.json(200, { ok: true });
  });
}
