import crypto from 'node:crypto';

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32, { N: 16384 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPin(pin, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const hash = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32, { N: 16384 });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

let key = null;
export function setSecretKey(secret) {
  key = crypto.createHash('sha256').update(`or-yakar:${secret}`).digest();
}

// הצפנת מפתחות API של ספקים לפני שמירה במסד (AES-256-GCM)
export function encrypt(obj) {
  if (!key) throw new Error('secret key not set');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decrypt(str) {
  if (!str) return {};
  try {
    const [, ivB, tagB, encB] = str.split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch {
    return {};
  }
}

export function normalizePhone(p) {
  if (!p) return '';
  let d = String(p).replace(/\D/g, '');
  if (d.startsWith('972')) d = `0${d.slice(3)}`;
  return d;
}
