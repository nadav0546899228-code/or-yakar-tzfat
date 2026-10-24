// כניסה עם Google (Google Identity Services).
// אימות: אסימון ה-ID נבדק מול Google בצד השרת (חתימה, קהל, תוקף, מייל מאומת).
// קישור למשתמש: לפי מזהה Google הקבוע (sub). בכניסה ראשונה - לפי מייל מאומת שתואם משתמש פעיל,
// או לפי OWNER_EMAIL לחשבון הבעלים.
import { one, query } from './lib/db.js';
import { HttpError } from './lib/router.js';
import { providerState } from './providers/engine.js';
import { audit, notify } from './audit.js';

async function googleConfig() {
  let clientId = process.env.GOOGLE_CLIENT_ID || '';
  let allowed = [];
  try {
    const st = await providerState('google_login');
    if (!clientId && st.row?.config?.client_id) clientId = st.row.config.client_id;
    allowed = String(st.row?.config?.allowed_emails || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  } catch { /* */ }
  const owner = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
  if (owner) allowed.push(owner);
  return { clientId: clientId.trim(), allowed, owner };
}

const VALID_INVITE_ROLES = ['manager', 'vp', 'treasurer', 'institution_manager', 'aid_coordinator', 'call_agent', 'recruiter', 'secretary', 'advisor', 'accountant'];
export function invites() {
  return String(process.env.INVITE_EMAILS || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const [email, roles = 'manager'] = x.split(':');
    // מתכנת לא ניתן להזמנה - רק דרך OWNER_EMAIL
    return { email: email.toLowerCase(), roles: roles.split('+').filter((r) => VALID_INVITE_ROLES.includes(r)) };
  }).filter((x) => x.email.includes('@') && x.roles.length);
}

async function verifyIdToken(credential, clientId) {
  let r;
  try {
    r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  } catch {
    throw new HttpError(502, 'לא ניתן להתחבר ל-Google כרגע, נסו שוב');
  }
  const t = await r.json().catch(() => ({}));
  if (!r.ok || t.error_description || t.error) throw new HttpError(401, 'אימות Google נכשל');
  if (t.aud !== clientId) throw new HttpError(401, 'האסימון לא הונפק לאתר הזה');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)) throw new HttpError(401, 'מנפיק לא תקין');
  if (Number(t.exp) * 1000 < Date.now()) throw new HttpError(401, 'פג תוקף הכניסה, נסו שוב');
  if (String(t.email_verified) !== 'true') throw new HttpError(401, 'המייל בחשבון Google אינו מאומת');
  return { sub: String(t.sub), email: String(t.email).toLowerCase(), name: t.name || '' };
}

export function registerGoogleRoutes(r, { createSession, bestRole }) {
  r.get('/api/auth/google-config', async (ctx) => {
    const { clientId } = await googleConfig();
    ctx.json(200, { client_id: clientId || null });
  });

  r.post('/api/auth/google', async (ctx) => {
    const { clientId, allowed, owner } = await googleConfig();
    if (!clientId) throw new HttpError(400, 'כניסת Google עדיין לא הוגדרה (חסר GOOGLE_CLIENT_ID)');
    if (!ctx.body.credential) throw new HttpError(400, 'חסר אסימון');
    const g = await verifyIdToken(ctx.body.credential, clientId);
    let u = await one('SELECT * FROM users WHERE google_sub = $1', [g.sub]);
    if (!u) {
      // כניסה ראשונה: בעלים לפי OWNER_EMAIL, אחרת משתמש פעיל עם אותו מייל
      if (owner && g.email === owner) u = await one('SELECT * FROM users WHERE is_owner = TRUE ORDER BY id LIMIT 1');
      if (!u) u = await one('SELECT * FROM users WHERE LOWER(email) = $1 AND active = TRUE AND google_sub IS NULL ORDER BY id LIMIT 1', [g.email]);
      // הזמנות קבועות מה-Secret INVITE_EMAILS (פורמט: email:role[+role],email:role) - יוצר משתמש בכניסה הראשונה
      if (!u) {
        const inv = invites().find((x) => x.email === g.email);
        if (inv) {
          u = await one('INSERT INTO users (name, email, roles, google_sub) VALUES ($1,$2,$3,$4) RETURNING *', [g.name || g.email, g.email, inv.roles, g.sub]);
          await audit(null, 'user_create_invite', 'user', u.id, { email: g.email, roles: inv.roles });
          await notify({ title: 'משתמש חדש נכנס עם Google', body: `${u.name} · ${g.email} · ${inv.roles.join(', ')}`, link: '/app/users', roles: ['developer', 'manager'] });
        }
      }
      if (!u) {
        await audit(null, 'google_login_denied', 'user', null, { email: g.email });
        throw new HttpError(403, `החשבון ${g.email} לא מורשה. יש לבקש מהמנהל להוסיף את המייל לפרופיל המשתמש`);
      }
      // הרשאת מתכנת מקושרת רק למייל שברשימה המורשית
      if (u.roles.includes('developer') && !allowed.includes(g.email)) throw new HttpError(403, 'מייל זה אינו מורשה לחשבון מתכנת');
      await query('UPDATE users SET google_sub = $2, email = COALESCE(email, $3) WHERE id = $1', [u.id, g.sub, g.email]);
      await notify({ title: 'חשבון Google קושר', body: `${u.name} · ${g.email}`, link: '/app/audit', roles: ['developer'] });
    }
    if (!u.active) throw new HttpError(403, 'המשתמש מושבת');
    if (u.locked_permanent) throw new HttpError(423, 'החשבון נעול. יש לפנות לממונה לשחרור');
    await query('UPDATE users SET last_login_at = now(), failed_attempts = 0 WHERE id = $1', [u.id]);
    await createSession(ctx, { userId: u.id, role: bestRole(u.roles) });
    await audit({ id: u.id }, 'login_google', 'user', u.id, { email: g.email });
    ctx.json(200, { ok: true });
  });
}
