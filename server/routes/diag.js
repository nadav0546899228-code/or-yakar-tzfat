// דוח מצב לקריאה בלבד - מאפשר לבדוק את מצב האתר מבחוץ בעזרת מפתח סודי, בלי כניסה למערכת.
// לא מחזיר פרטי תורמים, טלפונים, מיילים או מפתחות API.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { query, one, many } from '../lib/db.js';
import { HttpError } from '../lib/router.js';
import { requirePerm } from '../auth.js';
import { audit } from '../audit.js';
import { getSetting, setSetting } from '../settings.js';
import { envInfo } from '../env.js';
import { PROVIDERS } from '../providers/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const started = new Date();

function scrub(s) {
  // מסתיר טלפונים, מיילים ומספרים ארוכים שעלולים להופיע בהודעות שגיאה
  return String(s || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\+?\d[\d\s-]{7,}\d/g, '[num]')
    .slice(0, 1500);
}

export async function logError({ source = 'server', path: p = null, message, stack = null, userId = null }) {
  try {
    const msg = scrub(message);
    const existing = await one("SELECT id FROM error_log WHERE source = $1 AND message = $2 AND COALESCE(path,'') = COALESCE($3,'') AND last_at > now() - interval '1 day'", [source, msg, p]);
    if (existing) await query('UPDATE error_log SET count = count + 1, last_at = now() WHERE id = $1', [existing.id]);
    else await query('INSERT INTO error_log (source, path, message, stack, user_id) VALUES ($1,$2,$3,$4,$5)', [source, p, msg, stack ? scrub(stack).slice(0, 3000) : null, userId]);
    await query("DELETE FROM error_log WHERE last_at < now() - interval '60 days'");
  } catch (e) {
    console.error('[logError]', e.message);
  }
}

async function diagKey() {
  let s = await getSetting('diag');
  if (!s?.key) {
    s = { key: crypto.randomBytes(18).toString('base64url'), created_at: new Date().toISOString() };
    await setSetting('diag', s);
  }
  return s.key;
}

function buildInfo() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'build.json'), 'utf8')); } catch { return null; }
}

export function registerDiagRoutes(r) {
  // שגיאות מהדפדפן
  r.post('/api/diag/client-error', async (ctx) => {
    const { message, stack, url } = ctx.body || {};
    if (!message) return ctx.json(200, { ok: true });
    await logError({ source: 'client', path: String(url || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 200), message, stack, userId: ctx.user?.id || null });
    ctx.json(200, { ok: true });
  });

  r.get('/api/diag/key', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    ctx.json(200, { key: await diagKey() });
  });

  r.post('/api/diag/rotate', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    await setSetting('diag', { key: crypto.randomBytes(18).toString('base64url'), created_at: new Date().toISOString() });
    await audit(ctx.user, 'diag_rotate', 'diag', null, {});
    ctx.json(200, { key: await diagKey() });
  });

  r.post('/api/diag/clear-errors', async (ctx) => {
    requirePerm(ctx, 'dev.only');
    await query('DELETE FROM error_log');
    await audit(ctx.user, 'diag_clear_errors', 'diag', null, {});
    ctx.json(200, { ok: true });
  });

  // הדוח עצמו - גישה במפתח בלבד
  r.get('/api/diag', async (ctx) => {
    const key = await diagKey();
    const given = String(ctx.query.key || '');
    const a = Buffer.from(given);
    const b = Buffer.from(key);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'מפתח לא תקין');
    const tables = ['users', 'donors', 'transactions', 'standing_orders', 'documents', 'call_tasks', 'interactions', 'donor_dates', 'pledges',
      'tzedaka_boxes', 'box_collections', 'spiritual_orders', 'events', 'event_guests', 'aid_requests', 'campaigns', 'institutions',
      'automations', 'messages_out', 'contact_messages', 'notifications', 'audit_log', 'sessions', 'error_log'];
    const counts = {};
    for (const t of tables) {
      const hasDemo = !['users', 'audit_log', 'sessions', 'error_log'].includes(t);
      const row = await one(`SELECT COUNT(*)::int AS total${hasDemo ? ', COUNT(*) FILTER (WHERE is_demo)::int AS demo' : ''} FROM ${t}`);
      counts[t] = row;
    }
    const providerRows = await many('SELECT key, enabled, auto_sync, last_status, last_error, last_sync_at, (secrets_enc IS NOT NULL) AS has_secrets FROM providers');
    const byKey = Object.fromEntries(providerRows.map((p) => [p.key, p]));
    const providers = PROVIDERS.map((p) => ({
      key: p.key, label: p.label, adapter: p.status, enabled: !!byKey[p.key]?.enabled, has_secrets: !!byKey[p.key]?.has_secrets,
      last_status: byKey[p.key]?.last_status || null, last_error: byKey[p.key]?.last_error ? scrub(byKey[p.key].last_error) : null, last_sync_at: byKey[p.key]?.last_sync_at || null,
    }));
    const [errors, syncRuns, auditRows, users, money, settingsKeys, db] = await Promise.all([
      many('SELECT source, path, message, stack, count, first_at, last_at FROM error_log ORDER BY last_at DESC LIMIT 60'),
      many('SELECT provider, status, imported, updated, message, started_at, finished_at FROM sync_runs ORDER BY started_at DESC LIMIT 15'),
      many('SELECT a.at, a.action, a.entity, a.entity_id, u.name AS user_name, (a.impersonator_id IS NOT NULL) AS impersonated FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT 40'),
      many('SELECT id, name, roles, active, must_change_pin, locked_permanent, (locked_until > now()) AS locked_now, last_login_at, is_owner, is_demo FROM users ORDER BY id'),
      one(`SELECT COALESCE(SUM(amount_ils) FILTER (WHERE status='paid' AND date >= date_trunc('month', CURRENT_DATE)),0) AS month_paid,
        COUNT(*) FILTER (WHERE status IN ('failed','bounced') AND date > CURRENT_DATE - 30)::int AS failed_30d,
        COUNT(*) FILTER (WHERE status='paid' AND document_id IS NULL)::int AS paid_without_document,
        COUNT(*) FILTER (WHERE approved = FALSE)::int AS pending_approval FROM transactions`),
      many('SELECT key, updated_at FROM settings ORDER BY key'),
      one("SELECT current_database() AS name, pg_size_pretty(pg_database_size(current_database())) AS size, now() AS db_time"),
    ]);
    ctx.json(200, {
      generated_at: new Date().toISOString(),
      env: envInfo(),
      build: buildInfo(),
      server: { node: process.version, started_at: started.toISOString(), uptime_sec: Math.round(process.uptime()), memory_mb: Math.round(process.memoryUsage().rss / 1048576) },
      secrets_present: { SESSION_SECRET: !!process.env.SESSION_SECRET, DATABASE_URL: !!process.env.DATABASE_URL, OWNER_PHONE: !!process.env.OWNER_PHONE, APP_MODE: process.env.APP_MODE || 'development', FORCE_SANDBOX: process.env.FORCE_SANDBOX || null },
      db,
      counts,
      money,
      users: users.map((u) => ({ ...u, name: u.name })),
      providers,
      sync_runs: syncRuns,
      errors,
      recent_activity: auditRows,
      settings_updated: settingsKeys,
    });
  });
}
