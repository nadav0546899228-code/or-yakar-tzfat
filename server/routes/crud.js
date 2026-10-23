import { RESOURCES, writableFields, publicMeta } from '../resources.js';
import { query, one, many, insert, update } from '../lib/db.js';
import { HttpError } from '../lib/router.js';
import { requirePerm } from '../auth.js';
import { audit } from '../audit.js';
import { normalizePhone } from '../lib/security.js';
import { onDonorCreated } from '../automations.js';

export const LABEL_SQL = {
  donors: "TRIM(COALESCE(title || ' ','') || COALESCE(first_name,'') || ' ' || COALESCE(last_name,''))",
  institutions: 'name',
  campaigns: 'name',
  purposes: 'name',
  events: 'name',
  tzedaka_boxes: "COALESCE(code || ' - ','') || location_name",
  materials: 'title',
  users: 'name',
};

function getRes(key) {
  const r = RESOURCES[key];
  if (!r) throw new HttpError(404, 'מודול לא קיים');
  return r;
}

function scopeClause(res, user, params) {
  if (!res.scope) return '';
  const s = res.scope(user);
  if (!s) return '';
  let where = s.where;
  if (where.includes('$U')) { params.push(user.id); where = where.replaceAll('$U', `$${params.length}`); }
  if (where.includes('$I')) { params.push(user.institution_id || -1); where = where.replaceAll('$I', `$${params.length}`); }
  return where;
}

function coerce(field, v) {
  if (v === undefined) return undefined;
  if (v === '' && field.type !== 'text' && field.type !== 'textarea') return null;
  switch (field.type) {
    case 'number': case 'money': case 'ref': case 'user': {
      if (v === null || v === '') return null;
      const n = Number(v);
      if (Number.isNaN(n)) throw new HttpError(400, `ערך לא תקין בשדה ${field.label}`);
      return n;
    }
    case 'bool': return v === true || v === 'true' || v === 1 || v === '1';
    case 'tags': return Array.isArray(v) ? v.filter(Boolean).map(String) : String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
    case 'phone': return v ? normalizePhone(v) : null;
    case 'json': return typeof v === 'string' ? JSON.parse(v || '{}') : v;
    case 'file': {
      if (v && String(v).length > 7_000_000) throw new HttpError(413, 'הקובץ גדול מדי (עד 5MB)');
      return v;
    }
    default: return v === null ? null : String(v);
  }
}

export function cleanBody(res, body, { creating }) {
  const out = {};
  for (const f of res.fields) {
    let v = coerce(f, body[f.key]);
    if (creating && (v === undefined || v === null) && f.default !== undefined) {
      v = f.default === 'today' ? new Date().toISOString().slice(0, 10) : f.default;
    }
    if (v !== undefined) out[f.key] = v;
    if (creating && f.required && (out[f.key] === undefined || out[f.key] === null || out[f.key] === '')) {
      throw new HttpError(400, `השדה "${f.label}" הוא חובה`);
    }
  }
  if (body.file_name !== undefined && res.fields.some((f) => f.type === 'file')) out.file_name = body.file_name;
  return out;
}

export async function resolveLabels(res, rows) {
  const refs = res.fields.filter((f) => f.type === 'ref' || f.type === 'user');
  const extra = (res.readonlyFields || []).filter((f) => f.type === 'user');
  const labels = {};
  for (const f of [...refs, ...extra]) {
    const table = f.type === 'user' ? 'users' : RESOURCES[f.ref]?.table || f.ref;
    const ids = [...new Set(rows.map((r) => r[f.key]).filter((x) => x != null))];
    if (!ids.length) continue;
    const exp = LABEL_SQL[f.type === 'user' ? 'users' : f.ref] || 'name';
    const found = await many(`SELECT id, ${exp} AS label FROM ${table} WHERE id = ANY($1::int[])`, [ids]);
    labels[f.key] = Object.fromEntries(found.map((x) => [x.id, x.label]));
  }
  return labels;
}

export function registerCrudRoutes(r) {
  r.get('/api/meta', async (ctx) => {
    requirePerm(ctx, 'staff');
    ctx.json(200, publicMeta());
  });

  // רשימה עם חיפוש, סינון ועימוד
  r.get('/api/r/:res', async (ctx) => {
    const res = getRes(ctx.params.res);
    requirePerm(ctx, res.perms.read);
    const params = [];
    const where = [];
    const q = (ctx.query.q || '').trim();
    if (q && res.search?.length) {
      params.push(`%${q}%`);
      where.push(`(${res.search.map((c) => `${res.table}.${c}::text ILIKE $${params.length}`).join(' OR ')})`);
    }
    for (const f of res.fields) {
      const v = ctx.query[`f_${f.key}`];
      if (v === undefined || v === '') continue;
      if (f.type === 'tags') { params.push(v); where.push(`$${params.length} = ANY(${res.table}.${f.key})`); continue; }
      if (f.type === 'bool') { params.push(v === 'true'); } else params.push(v);
      where.push(`${res.table}.${f.key}::text = $${params.length}::text`);
    }
    if (ctx.query.demo === 'only') where.push(`${res.table}.is_demo = TRUE`);
    if (ctx.query.demo === 'hide') where.push(`${res.table}.is_demo = FALSE`);
    const scope = scopeClause(res, ctx.user, params);
    if (scope) where.push(scope);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const size = Math.min(Number(ctx.query.size) || 50, 500);
    const page = Math.max(Number(ctx.query.page) || 1, 1);
    const computed = Object.entries(res.computed || {}).map(([k, sql]) => `${sql} AS ${k}`);
    const select = [`${res.table}.*`, ...computed].join(', ');
    const total = await one(`SELECT COUNT(*)::int AS c FROM ${res.table} ${whereSql}`, params);
    const rows = await many(
      `SELECT ${select} FROM ${res.table} ${whereSql} ORDER BY ${res.sort || 'id DESC'} LIMIT ${size} OFFSET ${(page - 1) * size}`,
      params,
    );
    for (const row of rows) if (row.file_data) row.file_data = row.file_data.slice(0, 64) ? '[קובץ]' : null;
    const labels = await resolveLabels(res, rows);
    ctx.json(200, { rows, total: total.c, page, size, labels });
  });

  r.get('/api/r/:res/options', async (ctx) => {
    const res = getRes(ctx.params.res);
    requirePerm(ctx, 'staff');
    const exp = LABEL_SQL[ctx.params.res] || 'name';
    const q = (ctx.query.q || '').trim();
    const params = [];
    let where = '';
    if (q) { params.push(`%${q}%`); where = `WHERE ${exp} ILIKE $1${ctx.params.res === 'donors' ? ' OR phone ILIKE $1' : ''}`; }
    if (ctx.query.id) { params.length = 0; params.push(Number(ctx.query.id)); where = 'WHERE id = $1'; }
    const rows = await many(`SELECT id, ${exp} AS label${ctx.params.res === 'donors' ? ', phone' : ''} FROM ${res.table} ${where} ORDER BY label LIMIT 30`, params);
    ctx.json(200, { rows });
  });

  r.get('/api/r/:res/:id', async (ctx) => {
    const res = getRes(ctx.params.res);
    requirePerm(ctx, res.perms.read);
    const computed = Object.entries(res.computed || {}).map(([k, sql]) => `${sql} AS ${k}`);
    const row = await one(`SELECT ${[`${res.table}.*`, ...computed].join(', ')} FROM ${res.table} WHERE id = $1`, [ctx.params.id]);
    if (!row) throw new HttpError(404, 'לא נמצא');
    const labels = await resolveLabels(res, [row]);
    ctx.json(200, { row, labels });
  });

  r.post('/api/r/:res', async (ctx) => {
    const res = getRes(ctx.params.res);
    if (res.readonly) throw new HttpError(400, 'מודול לקריאה בלבד');
    requirePerm(ctx, res.perms.write);
    const data = cleanBody(res, ctx.body, { creating: true });
    if (res.autoUser && !data[res.autoUser]) data[res.autoUser] = ctx.user.id;
    if (ctx.params.res === 'donors' && !ctx.body.force) {
      const dup = await findDuplicateDonor(data);
      if (dup) throw new HttpError(409, `ייתכן שהתורם כבר קיים: ${dup.label}`, { duplicate: dup });
    }
    if (ctx.params.res === 'donors' && ctx.user.active_role === 'recruiter' && !data.recruiter_user_id) data.recruiter_user_id = ctx.user.id;
    const row = await insert(res.table, data, writableFields(res).concat(['file_name']));
    await audit(ctx.user, 'create', ctx.params.res, row.id, summarize(data));
    if (ctx.params.res === 'donors') onDonorCreated(row).catch(() => {});
    ctx.json(200, { row });
  });

  r.put('/api/r/:res/:id', async (ctx) => {
    const res = getRes(ctx.params.res);
    if (res.readonly) throw new HttpError(400, 'מודול לקריאה בלבד');
    requirePerm(ctx, res.perms.write);
    const before = await one(`SELECT * FROM ${res.table} WHERE id = $1`, [ctx.params.id]);
    if (!before) throw new HttpError(404, 'לא נמצא');
    const data = cleanBody(res, ctx.body, { creating: false });
    if (ctx.params.res === 'donors') data.updated_at = new Date();
    const row = await update(res.table, ctx.params.id, data, writableFields(res).concat(['updated_at', 'file_name']));
    const changed = Object.keys(data).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(row[k]) && k !== 'updated_at');
    await audit(ctx.user, 'update', ctx.params.res, row.id, { changed });
    ctx.json(200, { row });
  });

  r.delete('/api/r/:res/:id', async (ctx) => {
    const res = getRes(ctx.params.res);
    if (res.readonly) throw new HttpError(400, 'מודול לקריאה בלבד');
    requirePerm(ctx, res.perms.write);
    const before = await one(`SELECT * FROM ${res.table} WHERE id = $1`, [ctx.params.id]);
    if (!before) throw new HttpError(404, 'לא נמצא');
    if (!ctx.body.reason && ['donors', 'institutions'].includes(ctx.params.res)) throw new HttpError(400, 'יש לציין סיבת מחיקה');
    await query(`DELETE FROM ${res.table} WHERE id = $1`, [ctx.params.id]);
    await audit(ctx.user, 'delete', ctx.params.res, ctx.params.id, { reason: ctx.body.reason || null, snapshot: summarize(before) });
    ctx.json(200, { ok: true });
  });
}

function summarize(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === 'file_data' || k === 'signature_data') continue;
    if (typeof v === 'string' && v.length > 120) out[k] = `${v.slice(0, 120)}…`;
    else out[k] = v;
  }
  return out;
}

export async function findDuplicateDonor(data) {
  const conds = [];
  const params = [];
  if (data.phone) { params.push(normalizePhone(data.phone)); conds.push(`phone = $${params.length} OR phone2 = $${params.length}`); }
  if (data.id_number) { params.push(String(data.id_number).trim()); conds.push(`id_number = $${params.length}`); }
  if (data.email) { params.push(String(data.email).trim().toLowerCase()); conds.push(`LOWER(email) = $${params.length}`); }
  if (!conds.length) return null;
  return one(`SELECT id, ${LABEL_SQL.donors} AS label FROM donors WHERE ${conds.join(' OR ')} LIMIT 1`, params);
}
