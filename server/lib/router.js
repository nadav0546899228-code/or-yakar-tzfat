// נתב HTTP קטן ללא תלויות - מחליף את Express כדי שבשרת Replit לא יידרש שום build
import { URL } from 'node:url';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) {
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  });
  return out;
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, ...handlers) {
    const keys = [];
    const pattern = path
      .replace(/\/$/, '')
      .replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
    this.routes.push({ method, regex: new RegExp(`^${pattern}/?$`), keys, handlers });
  }

  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  put(p, ...h) { this.add('PUT', p, ...h); }
  patch(p, ...h) { this.add('PATCH', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.regex);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route: r, params };
      }
    }
    return null;
  }
}

export async function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'הקובץ או הבקשה גדולים מדי')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const type = req.headers['content-type'] || '';
      if (type.includes('application/json')) {
        try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'גוף בקשה לא תקין')); }
      } else if (type.includes('application/x-www-form-urlencoded')) {
        resolve(Object.fromEntries(new URLSearchParams(raw)));
      } else {
        resolve({ raw });
      }
    });
    req.on('error', reject);
  });
}

export function makeContext(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ctx = {
    req,
    res,
    url,
    query: Object.fromEntries(url.searchParams),
    cookies: parseCookies(req.headers.cookie),
    params: {},
    body: {},
    ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim(),
    secure: req.headers['x-forwarded-proto'] === 'https',
    headersOut: {},
    setCookie(name, value, opts = {}) {
      const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
      if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
      if (ctx.secure) parts.push('Secure');
      const prev = ctx.headersOut['Set-Cookie'] || [];
      ctx.headersOut['Set-Cookie'] = [...prev, parts.join('; ')];
    },
    json(status, data) {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...ctx.headersOut });
      res.end(JSON.stringify(data));
    },
    send(status, body, type = 'text/plain; charset=utf-8', extraHeaders = {}) {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': type, ...ctx.headersOut, ...extraHeaders });
      res.end(body);
    },
  };
  return ctx;
}
