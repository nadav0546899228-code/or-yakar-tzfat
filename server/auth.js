import { one, query, many } from './lib/db.js';
import { hashPin, verifyPin, randomToken, sha256, normalizePhone } from './lib/security.js';
import { HttpError } from './lib/router.js';
import { can, ROLES, canManageRole, PERMS } from './roles.js';
import { audit } from './audit.js';
import { isSandbox, isPublished } from './env.js';
import { registerGoogleRoutes } from './googleAuth.js';

const COOKIE = 'oy_sess';
const SESSION_DAYS = 30;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const MAX_LOCKS = 5;

export async function loadSession(ctx) {
  const token = ctx.cookies[COOKIE];
  ctx.user = null;
  ctx.donor = null;
  if (!token) return;
  const s = await one(
    `SELECT * FROM sessions WHERE token_hash = $1 AND last_seen > now() - interval '${SESSION_DAYS} days'`,
    [sha256(token)],
  );
  if (!s) return;
  ctx.session = s;
  // חידוש תוקף בכל פעילות (לכל היותר פעם בעשר דקות)
  query(`UPDATE sessions SET last_seen = now() WHERE token_hash = $1 AND last_seen < now() - interval '10 minutes'`, [s.token_hash]).catch(() => {});
  if (s.donor_id) {
    ctx.donor = await one('SELECT * FROM donors WHERE id = $1', [s.donor_id]);
    return;
  }
  const u = await one('SELECT * FROM users WHERE id = $1 AND active = TRUE', [s.user_id]);
  if (!u) return;
  const role = s.active_role && u.roles.includes(s.active_role) ? s.active_role : bestRole(u.roles);
  ctx.user = { ...publicUser(u), active_role: role, impersonator_id: s.impersonator_id };
}

export function bestRole(roles = []) {
  return [...roles].sort((a, b) => (ROLES[b]?.rank || 0) - (ROLES[a]?.rank || 0))[0] || null;
}

export function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    email: u.email,
    roles: u.roles,
    institution_id: u.institution_id,
    must_change_pin: u.must_change_pin,
    is_owner: u.is_owner,
    language: u.language,
  };
}

export function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'נדרשת כניסה למערכת');
}

export function requirePerm(ctx, perm) {
  requireUser(ctx);
  if (!can(ctx.user, perm)) throw new HttpError(403, 'אין הרשאה לפעולה זו בתצוגה הנוכחית');
}

async function createSession(ctx, { userId = null, donorId = null, role = null, impersonatorId = null }) {
  const token = randomToken();
  await query(
    'INSERT INTO sessions (token_hash, user_id, donor_id, active_role, impersonator_id, ip) VALUES ($1,$2,$3,$4,$5,$6)',
    [sha256(token), userId, donorId, role, impersonatorId, ctx.ip],
  );
  ctx.setCookie(COOKIE, token, { maxAge: SESSION_DAYS * 86400 });
}

export function registerAuthRoutes(r) {
  registerGoogleRoutes(r, { createSession, bestRole });
  r.post('/api/auth/login', async (ctx) => {
    const phone = normalizePhone(ctx.body.phone);
    const pin = String(ctx.body.pin || '');
    if (!phone || !pin) throw new HttpError(400, 'יש להזין טלפון וקוד');
    const u = await one('SELECT * FROM users WHERE phone = $1', [phone]);
    if (!u || !u.active) {
      await audit(null, 'login_failed', 'user', null, { phone });
      throw new HttpError(401, 'טלפון או קוד שגויים');
    }
    if (u.locked_permanent) throw new HttpError(423, 'החשבון נעול. יש לפנות לממונה לשחרור');
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(u.locked_until) - new Date()) / 60000);
      throw new HttpError(423, `החשבון נעול זמנית. נסו שוב בעוד ${mins} דקות`);
    }
    if (!verifyPin(pin, u.pin_hash)) {
      const failed = u.failed_attempts + 1;
      if (failed >= MAX_FAILED) {
        const locks = u.lock_count + 1;
        const permanent = locks >= MAX_LOCKS;
        await query(
          `UPDATE users SET failed_attempts = 0, lock_count = $2, locked_permanent = $3,
           locked_until = now() + interval '${LOCK_MINUTES} minutes' WHERE id = $1`,
          [u.id, locks, permanent],
        );
        await audit({ id: u.id }, permanent ? 'locked_permanent' : 'locked_temp', 'user', u.id, {});
        throw new HttpError(423, permanent ? 'החשבון ננעל. יש לפנות לממונה לשחרור' : `יותר מדי ניסיונות. החשבון נעול ל-${LOCK_MINUTES} דקות`);
      }
      await query('UPDATE users SET failed_attempts = $2 WHERE id = $1', [u.id, failed]);
      throw new HttpError(401, 'טלפון או קוד שגויים');
    }
    await query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
    await createSession(ctx, { userId: u.id, role: bestRole(u.roles) });
    await audit({ id: u.id }, 'login', 'user', u.id, {});
    ctx.json(200, { ok: true });
  });

  r.post('/api/auth/logout', async (ctx) => {
    if (ctx.session) await query('DELETE FROM sessions WHERE token_hash = $1', [ctx.session.token_hash]);
    ctx.setCookie(COOKIE, '', { maxAge: 0 });
    ctx.json(200, { ok: true });
  });

  r.get('/api/auth/me', async (ctx) => {
    if (ctx.donor) return ctx.json(200, { donor: { id: ctx.donor.id, name: `${ctx.donor.first_name || ''} ${ctx.donor.last_name || ''}`.trim() } });
    if (!ctx.user) return ctx.json(200, { user: null });
    let impersonator = null;
    if (ctx.user.impersonator_id) impersonator = await one('SELECT id, name FROM users WHERE id = $1', [ctx.user.impersonator_id]);
    ctx.json(200, { user: ctx.user, impersonator, roles: ROLES, perms: PERMS });
  });

  r.post('/api/auth/role', async (ctx) => {
    requireUser(ctx);
    const role = ctx.body.role;
    if (!ctx.user.roles.includes(role)) throw new HttpError(400, 'התפקיד אינו משויך למשתמש');
    await query('UPDATE sessions SET active_role = $2 WHERE token_hash = $1', [ctx.session.token_hash, role]);
    ctx.json(200, { ok: true });
  });

  r.post('/api/auth/profile', async (ctx) => {
    requireUser(ctx);
    const { phone, pin, current_pin, email, name } = ctx.body;
    const u = await one('SELECT * FROM users WHERE id = $1', [ctx.user.id]);
    const updates = [];
    const params = [u.id];
    if (pin) {
      if (!u.must_change_pin && !verifyPin(current_pin || '', u.pin_hash)) throw new HttpError(400, 'הקוד הנוכחי שגוי');
      if (!/^\d{4,8}$/.test(String(pin))) throw new HttpError(400, 'הקוד חייב להיות 4-8 ספרות');
      params.push(hashPin(pin));
      updates.push(`pin_hash = $${params.length}`, 'must_change_pin = FALSE');
    }
    if (phone) {
      const p = normalizePhone(phone);
      const exists = await one('SELECT id FROM users WHERE phone = $1 AND id <> $2', [p, u.id]);
      if (exists) throw new HttpError(400, 'מספר הטלפון כבר בשימוש');
      params.push(p);
      updates.push(`phone = $${params.length}`);
    }
    if (email !== undefined) { params.push(email); updates.push(`email = $${params.length}`); }
    if (name) { params.push(name); updates.push(`name = $${params.length}`); }
    if (updates.length) await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $1`, params);
    await audit(ctx.user, 'profile_update', 'user', u.id, { fields: Object.keys(ctx.body).filter((k) => !k.includes('pin')) });
    ctx.json(200, { ok: true });
  });

  // התחזות מתועדת - מתכנת בלבד
  r.post('/api/auth/impersonate/:id', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    const target = await one('SELECT * FROM users WHERE id = $1 AND active = TRUE', [ctx.params.id]);
    if (!target) throw new HttpError(404, 'משתמש לא נמצא');
    await audit(ctx.user, 'impersonate_start', 'user', target.id, { target: target.name });
    await query('DELETE FROM sessions WHERE token_hash = $1', [ctx.session.token_hash]);
    await createSession(ctx, { userId: target.id, role: bestRole(target.roles), impersonatorId: ctx.user.id });
    ctx.json(200, { ok: true });
  });

  r.post('/api/auth/impersonate-stop', async (ctx) => {
    requireUser(ctx);
    const original = ctx.user.impersonator_id;
    if (!original) throw new HttpError(400, 'אין התחזות פעילה');
    await audit({ id: original }, 'impersonate_stop', 'user', ctx.user.id, {});
    await query('DELETE FROM sessions WHERE token_hash = $1', [ctx.session.token_hash]);
    const u = await one('SELECT * FROM users WHERE id = $1', [original]);
    await createSession(ctx, { userId: original, role: bestRole(u.roles) });
    ctx.json(200, { ok: true });
  });

  // ניהול משתמשים
  r.get('/api/users', async (ctx) => {
    requirePerm(ctx, 'users.manage');
    const rows = await many(`SELECT id, name, phone, email, roles, institution_id, active, must_change_pin, locked_permanent,
      locked_until, last_login_at, is_owner, created_at FROM users ORDER BY active DESC, name`);
    const visible = ctx.user.active_role === 'developer' ? rows : rows.filter((u) => !u.roles.includes('developer'));
    ctx.json(200, { rows: visible });
  });

  r.get('/api/users/options', async (ctx) => {
    requirePerm(ctx, 'staff');
    const rows = await many("SELECT id, name, roles FROM users WHERE active = TRUE AND NOT ('developer' = ANY(roles) AND array_length(roles,1) = 1) ORDER BY name");
    ctx.json(200, { rows });
  });

  r.post('/api/users', async (ctx) => {
    requirePerm(ctx, 'users.manage');
    const { name, phone, email, roles = [], institution_id, pin } = ctx.body;
    if (!name || (!phone && !email)) throw new HttpError(400, 'יש להזין שם, וטלפון או מייל (מייל - לכניסה עם Google)');
    for (const role of roles) {
      if (!ROLES[role]) throw new HttpError(400, `תפקיד לא מוכר: ${role}`);
      if (!canManageRole([ctx.user.active_role], role)) throw new HttpError(403, `אין הרשאה להעניק את התפקיד ${ROLES[role].label}`);
    }
    if (roles.includes('developer') && !ctx.body.confirm_developer) throw new HttpError(409, 'הוספת הרשאת מתכנת דורשת אישור מפורש', { needConfirm: 'developer' });
    const p = phone ? normalizePhone(phone) : null;
    if (p && await one('SELECT id FROM users WHERE phone = $1', [p])) throw new HttpError(400, 'מספר הטלפון כבר קיים');
    const em = email ? String(email).trim().toLowerCase() : null;
    if (em && await one('SELECT id FROM users WHERE LOWER(email) = $1', [em])) throw new HttpError(400, 'המייל כבר קיים אצל משתמש אחר');
    const tempPin = pin || String(Math.floor(100000 + Math.random() * 900000));
    const u = await one(
      `INSERT INTO users (name, phone, email, roles, institution_id, pin_hash, must_change_pin) VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id`,
      [name, p, em, roles, institution_id || null, hashPin(tempPin)],
    );
    await audit(ctx.user, 'user_create', 'user', u.id, { name, roles });
    ctx.json(200, { id: u.id, temp_pin: tempPin });
  });

  r.put('/api/users/:id', async (ctx) => {
    requirePerm(ctx, 'users.manage');
    const target = await one('SELECT * FROM users WHERE id = $1', [ctx.params.id]);
    if (!target) throw new HttpError(404, 'משתמש לא נמצא');
    if (target.roles.includes('developer') && ctx.user.active_role !== 'developer') throw new HttpError(403, 'אין הרשאה לערוך משתמש זה');
    if (target.is_owner && ctx.body.active === false) throw new HttpError(400, 'לא ניתן להשבית את חשבון הבעלים');
    const { name, phone, email, roles, institution_id, active } = ctx.body;
    if (roles) {
      const added = roles.filter((x) => !target.roles.includes(x));
      const removed = target.roles.filter((x) => !roles.includes(x));
      for (const role of [...added, ...removed]) {
        if (!canManageRole([ctx.user.active_role], role)) throw new HttpError(403, `אין הרשאה לשנות את התפקיד ${ROLES[role]?.label || role}`);
      }
      if (added.includes('developer') && !ctx.body.confirm_developer) throw new HttpError(409, 'הוספת הרשאת מתכנת דורשת אישור מפורש', { needConfirm: 'developer' });
    }
    await query(
      `UPDATE users SET name = COALESCE($2, name), phone = COALESCE($3, phone), email = COALESCE($4, email),
       roles = COALESCE($5, roles), institution_id = $6, active = COALESCE($7, active) WHERE id = $1`,
      [target.id, name || null, phone ? normalizePhone(phone) : null, email ?? null, roles || null, institution_id ?? target.institution_id, active ?? null],
    );
    if (active === false) await query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    await audit(ctx.user, 'user_update', 'user', target.id, { name, roles, active });
    ctx.json(200, { ok: true });
  });

  r.post('/api/users/:id/reset-pin', async (ctx) => {
    requirePerm(ctx, 'users.manage');
    const target = await one('SELECT * FROM users WHERE id = $1', [ctx.params.id]);
    if (!target) throw new HttpError(404, 'משתמש לא נמצא');
    if (target.roles.includes('developer') && ctx.user.active_role !== 'developer') throw new HttpError(403, 'אין הרשאה');
    const tempPin = String(Math.floor(100000 + Math.random() * 900000));
    await query(`UPDATE users SET pin_hash = $2, must_change_pin = TRUE, failed_attempts = 0, lock_count = 0,
      locked_until = NULL, locked_permanent = FALSE WHERE id = $1`, [target.id, hashPin(tempPin)]);
    await query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    await audit(ctx.user, 'pin_reset', 'user', target.id, {});
    ctx.json(200, { temp_pin: tempPin });
  });

  r.post('/api/users/:id/unlock', async (ctx) => {
    requirePerm(ctx, 'users.manage');
    await query('UPDATE users SET failed_attempts = 0, lock_count = 0, locked_until = NULL, locked_permanent = FALSE WHERE id = $1', [ctx.params.id]);
    await audit(ctx.user, 'user_unlock', 'user', ctx.params.id, {});
    ctx.json(200, { ok: true });
  });

  // כניסת תורם בקוד חד-פעמי (בסביבת פיתוח הקוד מוחזר במסך במקום SMS)
  r.post('/api/donor/otp', async (ctx) => {
    const phone = normalizePhone(ctx.body.phone);
    const donor = phone ? await one('SELECT id FROM donors WHERE phone = $1 OR phone2 = $1 LIMIT 1', [phone]) : null;
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (donor) {
      await query(`INSERT INTO donor_otps (phone, code_hash, expires_at, attempts) VALUES ($1,$2, now() + interval '10 minutes', 0)
        ON CONFLICT (phone) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`, [phone, sha256(code)]);
    }
    // לא חושפים אם הטלפון קיים; בפיתוח מציגים את הקוד לבדיקה
    ctx.json(200, { ok: true, sandbox_code: isSandbox() && !isPublished() && donor ? code : undefined });
  });

  r.post('/api/donor/login', async (ctx) => {
    const phone = normalizePhone(ctx.body.phone);
    const row = await one('SELECT * FROM donor_otps WHERE phone = $1', [phone]);
    if (!row || new Date(row.expires_at) < new Date() || row.attempts >= 5) throw new HttpError(401, 'הקוד אינו בתוקף. בקשו קוד חדש');
    if (row.code_hash !== sha256(String(ctx.body.code || ''))) {
      await query('UPDATE donor_otps SET attempts = attempts + 1 WHERE phone = $1', [phone]);
      throw new HttpError(401, 'קוד שגוי');
    }
    await query('DELETE FROM donor_otps WHERE phone = $1', [phone]);
    const donor = await one('SELECT id FROM donors WHERE phone = $1 OR phone2 = $1 ORDER BY id LIMIT 1', [phone]);
    await createSession(ctx, { donorId: donor.id });
    ctx.json(200, { ok: true });
  });
}
