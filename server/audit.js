import { query } from './lib/db.js';

export async function audit(user, action, entity, entityId, details = {}) {
  try {
    await query(
      'INSERT INTO audit_log (user_id, impersonator_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [user?.id || null, user?.impersonator_id || null, action, entity || null, entityId != null ? String(entityId) : null, details || {}],
    );
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

export async function notify({ title, body, link, roles = ['developer', 'manager'], userId = null, isDemo = false }) {
  try {
    await query('INSERT INTO notifications (title, body, link, roles, user_id, is_demo) VALUES ($1,$2,$3,$4,$5,$6)', [title, body || null, link || null, roles, userId, isDemo]);
  } catch (e) {
    console.error('[notify]', e.message);
  }
}
