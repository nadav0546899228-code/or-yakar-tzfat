// לקוח PostgreSQL מינימלי לבדיקות מקומיות בלבד (כשאין גישה ל-npm).
// בסביבת Replit המערכת משתמשת בחבילת pg הרשמית - הקובץ הזה לא נטען שם.
import net from 'node:net';

const OID = {
  bool: 16, int8: 20, int2: 21, int4: 23, oid: 26, json: 114, float4: 700, float8: 701,
  numeric: 1700, jsonb: 3802, date: 1082, timestamp: 1114, timestamptz: 1184,
  textArr: 1009, varcharArr: 1015, int4Arr: 1007, int8Arr: 1016,
};

function parseArray(str, mapFn = (x) => x) {
  if (str === '{}') return [];
  const inner = str.slice(1, -1);
  const out = [];
  let cur = '';
  let inQ = false;
  let esc = false;
  let quoted = false;
  for (const ch of inner) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inQ = !inQ; quoted = true; continue; }
    if (ch === ',' && !inQ) { out.push(!quoted && cur === 'NULL' ? null : mapFn(cur)); cur = ''; quoted = false; continue; }
    cur += ch;
  }
  out.push(!quoted && cur === 'NULL' ? null : mapFn(cur));
  return out;
}

function parseValue(type, s) {
  if (s === null) return null;
  switch (type) {
    case OID.bool: return s === 't';
    case OID.int2: case OID.int4: case OID.oid: case OID.int8: return parseInt(s, 10);
    case OID.float4: case OID.float8: case OID.numeric: return parseFloat(s);
    case OID.json: case OID.jsonb: return JSON.parse(s);
    case OID.timestamp: case OID.timestamptz: return new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
    case OID.textArr: case OID.varcharArr: return parseArray(s);
    case OID.int4Arr: case OID.int8Arr: return parseArray(s, (x) => parseInt(x, 10));
    default: return s;
  }
}

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Array.isArray(v)) {
    const items = v.map((x) => (x === null ? 'NULL' : `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`));
    return `'{${items.join(',').replace(/'/g, "''")}}'`;
  }
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function interpolate(sql, params = []) {
  return sql.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]));
}

export class DevClient {
  constructor({ host = '127.0.0.1', port = 5432, user = 'postgres', database = 'postgres' }) {
    Object.assign(this, { host, port, user, database });
    this.queue = Promise.resolve();
    this.buf = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.createConnection({ host: this.host, port: this.port }, () => {
        const params = Buffer.from(`user\0${this.user}\0database\0${this.database}\0client_encoding\0UTF8\0\0`);
        const len = Buffer.alloc(8);
        len.writeInt32BE(8 + params.length, 0);
        len.writeInt32BE(196608, 4);
        this.sock.write(Buffer.concat([len, params]));
      });
      this.sock.on('error', reject);
      this.pending = { resolve, reject, rows: [], fields: [], startup: true };
      this.sock.on('data', (d) => this.onData(d));
    });
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 5) {
      const type = String.fromCharCode(this.buf[0]);
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) return;
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      this.handle(type, body);
    }
  }

  handle(type, body) {
    const p = this.pending;
    if (!p) return;
    if (type === 'T') {
      const n = body.readInt16BE(0);
      let off = 2;
      p.fields = [];
      for (let i = 0; i < n; i++) {
        const end = body.indexOf(0, off);
        const name = body.toString('utf8', off, end);
        off = end + 1;
        const typeOid = body.readInt32BE(off + 6);
        off += 18;
        p.fields.push({ name, type: typeOid });
      }
    } else if (type === 'D') {
      const n = body.readInt16BE(0);
      let off = 2;
      const row = {};
      for (let i = 0; i < n; i++) {
        const l = body.readInt32BE(off);
        off += 4;
        let v = null;
        if (l >= 0) { v = body.toString('utf8', off, off + l); off += l; }
        const f = p.fields[i];
        row[f.name] = parseValue(f.type, v);
      }
      p.rows.push(row);
    } else if (type === 'C') {
      const tag = body.toString('utf8', 0, body.length - 1);
      const m = tag.match(/(\d+)$/);
      p.rowCount = m ? parseInt(m[1], 10) : 0;
    } else if (type === 'E') {
      const fields = {};
      let off = 0;
      while (off < body.length && body[off] !== 0) {
        const code = String.fromCharCode(body[off]);
        const end = body.indexOf(0, off + 1);
        fields[code] = body.toString('utf8', off + 1, end);
        off = end + 1;
      }
      const err = new Error(fields.M || 'database error');
      err.code = fields.C;
      err.detail = fields.D;
      p.error = err;
    } else if (type === 'Z') {
      this.pending = null;
      if (p.error) p.reject(p.error);
      else p.resolve({ rows: p.rows, rowCount: p.rowCount ?? p.rows.length, fields: p.fields });
    } else if (type === 'R') {
      const code = body.readInt32BE(0);
      if (code !== 0) p.error = new Error('devpg supports trust auth only');
    }
  }

  query(sql, params) {
    const text = interpolate(sql, params);
    const run = () => new Promise((resolve, reject) => {
      this.pending = { resolve, reject, rows: [], fields: [] };
      const q = Buffer.from(`${text}\0`);
      const head = Buffer.alloc(5);
      head.write('Q', 0);
      head.writeInt32BE(4 + q.length, 1);
      this.sock.write(Buffer.concat([head, q]));
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  end() { this.sock?.end(); }
}
