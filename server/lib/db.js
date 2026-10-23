// שכבת מסד נתונים: בייצור ובפיתוח ב-Replit - חבילת pg הרשמית מול DATABASE_URL.
// מקומית בלבד, כשאין pg מותקן, נטען לקוח הבדיקות devpg.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let impl = null;

async function init() {
  if (impl) return impl;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('חסר DATABASE_URL - יש להפעיל מסד PostgreSQL בפרויקט');
  try {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(20, (v) => parseInt(v, 10));
    pg.types.setTypeParser(1700, (v) => parseFloat(v));
    pg.types.setTypeParser(1082, (v) => v);
    const pool = new pg.Pool({
      connectionString: url,
      max: 10,
      ssl: /localhost|127\.0\.0\.1|sslmode=disable/.test(url) ? false : { rejectUnauthorized: false },
    });
    impl = { query: (sql, params) => pool.query(sql, params), kind: 'pg' };
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    const { DevClient } = await import('./devpg.js');
    const u = new URL(url);
    const client = new DevClient({
      host: u.hostname,
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username || 'postgres'),
      database: u.pathname.slice(1),
    });
    await client.connect();
    impl = { query: (sql, params) => client.query(sql, params), kind: 'devpg' };
    console.warn('[db] pg לא מותקן - משתמש בלקוח בדיקות מקומי (devpg)');
  }
  return impl;
}

export async function query(sql, params = []) {
  const db = await init();
  return db.query(sql, params);
}

export async function one(sql, params = []) {
  const r = await query(sql, params);
  return r.rows[0] || null;
}

export async function many(sql, params = []) {
  const r = await query(sql, params);
  return r.rows;
}

export async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const db = await init();
  if (db.kind === 'pg') {
    await db.query(sql);
  } else {
    await db.query(sql);
  }
}

// בניית INSERT/UPDATE בטוחים מתוך אובייקט ושמות עמודות מותרות
export async function insert(table, data, allowed) {
  const keys = Object.keys(data).filter((k) => !allowed || allowed.includes(k));
  const cols = keys.map((k) => `"${k}"`).join(', ');
  const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
  const sql = keys.length
    ? `INSERT INTO ${table} (${cols}) VALUES (${vals}) RETURNING *`
    : `INSERT INTO ${table} DEFAULT VALUES RETURNING *`;
  return one(sql, keys.map((k) => data[k]));
}

export async function update(table, id, data, allowed) {
  const keys = Object.keys(data).filter((k) => k !== 'id' && (!allowed || allowed.includes(k)));
  if (!keys.length) return one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
  return one(`UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`, [...keys.map((k) => data[k]), id]);
}
