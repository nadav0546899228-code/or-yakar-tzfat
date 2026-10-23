// מנוע החיבורים: סנכרון, פעולות על תנועות/הו"ק, הפקת מסמכים ושליחת הודעות.
// בסביבת פיתוח: ספק עם מתאם אמיתי פונה ל-Sandbox של הספק; ספק בהדמיה מייצר נתונים מסומנים כדוגמה.
import { query, one, many, insert } from '../lib/db.js';
import { encrypt, decrypt, normalizePhone } from '../lib/security.js';
import { HttpError } from '../lib/router.js';
import { isSandbox } from '../env.js';
import { getProvider, PROVIDERS } from './registry.js';
import { audit, notify } from '../audit.js';
import { getSetting } from '../settings.js';
import { onTransactionCreated } from '../automations.js';

export async function providerState(key) {
  const def = getProvider(key);
  if (!def) throw new HttpError(404, 'ספק לא מוכר');
  const row = (await one('SELECT * FROM providers WHERE key = $1', [key])) || { key, enabled: false, mode: 'sandbox', config: {}, auto_sync: false };
  return { def, row, secrets: decrypt(row.secrets_enc) };
}

export async function listProviders() {
  const rows = await many('SELECT * FROM providers');
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  return PROVIDERS.map((def) => {
    const row = byKey[def.key] || {};
    const secrets = decrypt(row.secrets_enc);
    const secretsSet = Object.fromEntries(def.fields.filter((x) => x.secret).map((x) => [x.key, !!secrets[x.key]]));
    const configured = def.fields.filter((x) => x.secret).every((x) => secretsSet[x.key]) && def.fields.filter((x) => x.secret).length > 0;
    return {
      ...def,
      enabled: !!row.enabled,
      auto_sync: !!row.auto_sync,
      config: row.config || {},
      secrets_set: secretsSet,
      configured,
      effective_mode: isSandbox() ? 'sandbox' : row.mode || 'sandbox',
      last_sync_at: row.last_sync_at,
      last_status: row.last_status,
      last_error: row.last_error,
    };
  });
}

export async function saveProvider(key, { enabled, auto_sync, config = {}, secrets = {}, clear = [] }, user) {
  const { def, row, secrets: current } = await providerState(key);
  const nextSecrets = { ...current };
  for (const fdef of def.fields.filter((x) => x.secret)) {
    if (secrets[fdef.key]) nextSecrets[fdef.key] = String(secrets[fdef.key]).trim();
    if (clear.includes(fdef.key)) delete nextSecrets[fdef.key];
  }
  const cleanConfig = {};
  for (const fdef of def.fields.filter((x) => !x.secret)) {
    if (config[fdef.key] !== undefined) cleanConfig[fdef.key] = config[fdef.key];
    else if (row.config?.[fdef.key] !== undefined) cleanConfig[fdef.key] = row.config[fdef.key];
  }
  await query(
    `INSERT INTO providers (key, enabled, auto_sync, config, secrets_enc, updated_at) VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (key) DO UPDATE SET enabled = $2, auto_sync = $3, config = $4, secrets_enc = $5, updated_at = now()`,
    [key, enabled ?? row.enabled ?? false, auto_sync ?? row.auto_sync ?? false, cleanConfig, encrypt(nextSecrets)],
  );
  await audit(user, 'provider_save', 'provider', key, { enabled, config: cleanConfig, secretsChanged: Object.keys(secrets).filter((k) => secrets[k]), cleared: clear });
}

async function setStatus(key, status, error = null) {
  await query(
    `INSERT INTO providers (key, last_status, last_error, last_sync_at) VALUES ($1,$2,$3, now())
     ON CONFLICT (key) DO UPDATE SET last_status = $2, last_error = $3, last_sync_at = now()`,
    [key, status, error],
  );
}

// ---------- חשבונית ירוקה (מתאם אמיתי) ----------
const GI = {
  base: () => (isSandbox() ? 'https://sandbox.d.greeninvoice.co.il/api/v1' : 'https://api.greeninvoice.co.il/api/v1'),
  async token(secrets) {
    if (!secrets.api_key_id || !secrets.api_key_secret) throw new HttpError(400, 'חסרים מפתחות API של חשבונית ירוקה');
    const r = await fetch(`${GI.base()}/account/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: secrets.api_key_id, secret: secrets.api_key_secret }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) throw new HttpError(502, `חשבונית ירוקה: ${j.errorMessage || r.status}`);
    return j.token;
  },
  typeCode(type, config) {
    if (type === 'receipt46') return Number(config.default_doc_type) || 405;
    if (type === 'receipt') return 400;
    if (type === 'invoice_receipt') return 320;
    if (type === 'invoice') return 305;
    if (type === 'credit') return 330;
    return 405;
  },
  paymentType(method) {
    return { cash: 1, check: 2, credit: 3, transfer: 4, bank_keva: 4, bit: 10, paypal: 5 }[method] || 11;
  },
  async issue({ secrets, config }, { donor, tx, type, amount, currency, lang, description }) {
    if (!amount || Number(amount) <= 0) throw new HttpError(400, 'לא ניתן להפיק מסמך על סכום 0 (חשבונית ירוקה דוחה מסמך כזה)');
    const token = await GI.token(secrets);
    const body = {
      description: description || 'תרומה למוסדות אור יקר צפת',
      type: GI.typeCode(type, config),
      date: (tx?.date || new Date().toISOString().slice(0, 10)),
      lang: lang === 'en' ? 'en' : 'he',
      currency: currency || 'ILS',
      vatType: 0,
      client: {
        name: donor ? `${donor.first_name || ''} ${donor.last_name || ''}`.trim() : 'תורם',
        taxId: donor?.id_number || undefined,
        emails: donor?.email ? [donor.email] : [],
        phone: donor?.phone || undefined,
        add: false,
      },
      payment: [{ type: GI.paymentType(tx?.method), price: Number(amount), currency: currency || 'ILS', date: tx?.date || new Date().toISOString().slice(0, 10) }],
      remarks: tx?.dedication || undefined,
    };
    const r = await fetch(`${GI.base()}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(502, `חשבונית ירוקה: ${j.errorMessage || r.status}`);
    return {
      external_id: j.id,
      number: String(j.number || ''),
      pdf_url: j.url?.he || j.url?.origin || null,
      tax_report_number: j.donationReportNumber || j.allocationNumber || null,
      raw: j,
    };
  },
  async cancel({ secrets }, doc) {
    const token = await GI.token(secrets);
    const r = await fetch(`${GI.base()}/documents/${doc.external_id}/close`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new HttpError(502, 'חשבונית ירוקה: ביטול נכשל - יש להפיק מסמך זיכוי');
    return true;
  },
};

export async function testProvider(key, user) {
  const st = await providerState(key);
  let result;
  try {
    if (key === 'greeninvoice' && st.secrets.api_key_id) {
      await GI.token(st.secrets);
      result = { ok: true, message: `התחברות הצליחה (${isSandbox() ? 'Sandbox' : 'ייצור'})` };
    } else if (st.def.status === 'real') {
      result = { ok: true, message: 'המתאם פנימי ומוכן לשימוש' };
    } else {
      result = { ok: true, simulated: true, message: 'מצב הדמיה: המתאם יופעל מול הספק לאחר קבלת תיעוד ומפתחות' };
    }
    await setStatus(key, result.simulated ? 'simulated' : 'ok');
  } catch (e) {
    result = { ok: false, message: e.message };
    await setStatus(key, 'error', e.message);
  }
  await audit(user, 'provider_test', 'provider', key, result);
  return result;
}

// ---------- איגוד תורמים ממקורות שונים ----------
export async function upsertDonorFromSource(source, externalId, info, { isDemo = false } = {}) {
  const link = await one('SELECT donor_id FROM donor_links WHERE source = $1 AND external_id = $2', [source, String(externalId)]);
  if (link) return link.donor_id;
  const phone = normalizePhone(info.phone);
  let donor = null;
  if (info.id_number) donor = await one('SELECT id FROM donors WHERE id_number = $1 LIMIT 1', [info.id_number]);
  if (!donor && phone) donor = await one('SELECT id FROM donors WHERE phone = $1 OR phone2 = $1 LIMIT 1', [phone]);
  if (!donor && info.email) donor = await one('SELECT id FROM donors WHERE LOWER(email) = LOWER($1) LIMIT 1', [info.email]);
  if (!donor) {
    donor = await insert('donors', {
      first_name: info.first_name || 'תורם',
      last_name: info.last_name || '',
      phone: phone || null,
      email: info.email || null,
      id_number: info.id_number || null,
      city: info.city || null,
      country: info.country || 'ישראל',
      currency: info.currency || 'ILS',
      is_overseas: !!info.is_overseas,
      tags: [`מקור:${source}`],
      is_demo: isDemo,
    });
  }
  await query('INSERT INTO donor_links (donor_id, source, external_id, raw) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [donor.id, source, String(externalId), info.raw || null]);
  return donor.id;
}

export async function toIls(amount, currency) {
  if (!currency || currency === 'ILS') return Number(amount);
  const rates = await getSetting('rates');
  return Math.round(Number(amount) * (Number(rates?.[currency]) || 1) * 100) / 100;
}

export async function recordTransaction(data, user, { isDemo = false } = {}) {
  const amount_ils = await toIls(data.amount, data.currency);
  let row;
  if (data.external_id) {
    row = await one('SELECT * FROM transactions WHERE source = $1 AND external_id = $2', [data.source, String(data.external_id)]);
    if (row) {
      await query('UPDATE transactions SET status = $2, synced_at = now() WHERE id = $1', [row.id, data.status || row.status]);
      return { row, created: false };
    }
  }
  row = await insert('transactions', { ...data, amount_ils, created_by: user?.id || null, synced_at: data.source !== 'manual' ? new Date() : null, is_demo: isDemo || !!data.is_demo });
  row = await one("UPDATE transactions SET serial = 'OY-' || LPAD(id::text, 6, '0') WHERE id = $1 RETURNING *", [row.id]);
  onTransactionCreated(row).catch((e) => console.error('[automation]', e.message));
  return { row, created: true };
}

// ---------- סנכרון (בהדמיה: יוצר תנועות דוגמה מסומנות) ----------
const SIM_NAMES = [
  ['יוסף', 'כהן'], ['משה', 'לוי'], ['אברהם', 'מזרחי'], ['יעקב', 'פרץ'], ['דוד', 'ביטון'], ['שמואל', 'אזולאי'],
  ['חיים', 'דהן'], ['אליהו', 'אוחיון'], ['מאיר', 'גבאי'], ['רפאל', 'חדד'], ['David', 'Goldberg'], ['Michael', 'Stern'],
];

export async function syncProvider(key, user) {
  const st = await providerState(key);
  const run = await insert('sync_runs', { provider: key, status: 'running', triggered_by: user?.id || null });
  let imported = 0;
  let updated = 0;
  let message = '';
  try {
    const canPull = st.def.capabilities.some((c) => ['pull_transactions', 'pull_keva', 'webhook'].includes(c));
    if (!canPull) {
      message = 'לספק זה אין משיכת תנועות';
    } else if (st.def.status === 'sim' || isSandbox()) {
      const institutions = await many('SELECT id FROM institutions WHERE active = TRUE ORDER BY sort, id');
      const count = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < count; i++) {
        const [first, last] = SIM_NAMES[Math.floor(Math.random() * SIM_NAMES.length)];
        const overseas = /^[A-Z]/.test(first);
        const extDonor = `SIM-D-${first}-${last}`;
        const donorId = await upsertDonorFromSource(key, extDonor, {
          first_name: first, last_name: last, phone: `05${Math.floor(20000000 + Math.random() * 79999999)}`,
          currency: overseas ? 'USD' : 'ILS', is_overseas: overseas, country: overseas ? 'ארה"ב' : 'ישראל',
        }, { isDemo: true });
        const isKeva = Math.random() < 0.4 && st.def.capabilities.includes('pull_keva');
        const amount = isKeva ? [100, 180, 260, 360, 500][Math.floor(Math.random() * 5)] : [50, 100, 180, 360, 1000, 1800][Math.floor(Math.random() * 6)];
        let soId = null;
        if (isKeva) {
          const so = await one(
            `INSERT INTO standing_orders (donor_id, source, external_id, type, amount, currency, day_of_month, start_date, status, next_charge_date, institution_id, synced_at, is_demo)
             VALUES ($1,$2,$3,'credit',$4,$5,10, CURRENT_DATE, 'active', CURRENT_DATE + 30, $6, now(), TRUE)
             ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET synced_at = now() RETURNING id, (xmax = 0) AS inserted`,
            [donorId, key, `SIM-K-${extDonor}`, amount, overseas ? 'USD' : 'ILS', institutions[0]?.id || null],
          );
          soId = so.id;
        }
        const res = await recordTransaction({
          donor_id: donorId, source: key, external_id: `SIM-T-${Date.now()}-${i}`, kind: isKeva ? 'keva' : 'one_time',
          method: 'credit', amount, currency: overseas ? 'USD' : 'ILS', date: new Date().toISOString().slice(0, 10), status: 'paid',
          institution_id: institutions[i % Math.max(institutions.length, 1)]?.id || null, standing_order_id: soId,
          card_last4: String(1000 + Math.floor(Math.random() * 8999)),
        }, user, { isDemo: true });
        if (res.created) imported++; else updated++;
      }
      message = `הדמיה: נקלטו ${imported} תנועות (מסומנות כנתוני דוגמה)`;
    } else {
      message = 'מתאם ייצור לספק זה טרם הופעל';
    }
    await query('UPDATE sync_runs SET finished_at = now(), status = $2, imported = $3, updated = $4, message = $5 WHERE id = $1', [run.id, 'ok', imported, updated, message]);
    await setStatus(key, 'ok');
  } catch (e) {
    await query('UPDATE sync_runs SET finished_at = now(), status = $2, message = $3 WHERE id = $1', [run.id, 'error', e.message]);
    await setStatus(key, 'error', e.message);
    throw e;
  }
  await audit(user, 'provider_sync', 'provider', key, { imported, updated });
  return { imported, updated, message };
}

// ---------- פעולות על תנועה במקור שלה ----------
export async function transactionAction(txId, action, user, extra = {}) {
  const tx = await one('SELECT * FROM transactions WHERE id = $1', [txId]);
  if (!tx) throw new HttpError(404, 'תנועה לא נמצאה');
  const sourceLabel = getProvider(tx.source)?.label || 'ידני';
  let message;
  if (action === 'refund') {
    if (tx.status !== 'paid') throw new HttpError(400, 'ניתן לזכות רק תנועה ששולמה');
    await query("UPDATE transactions SET status = 'refunded' WHERE id = $1", [tx.id]);
    message = `זיכוי נשלח ל${sourceLabel}${isSandbox() ? ' (הדמיה)' : ''}`;
    if (tx.document_id) message += '. יש להפיק מסמך זיכוי לקבלה המקורית';
  } else if (action === 'cancel') {
    await query("UPDATE transactions SET status = 'cancelled' WHERE id = $1", [tx.id]);
    message = 'התנועה בוטלה';
  } else if (action === 'retry') {
    if (!['failed', 'bounced'].includes(tx.status)) throw new HttpError(400, 'ניתן לחייב מחדש רק תנועה שנכשלה');
    const ok = isSandbox() ? Math.random() > 0.3 : false;
    await query('UPDATE transactions SET status = $2, failure_reason = $3 WHERE id = $1', [tx.id, ok ? 'paid' : 'failed', ok ? null : 'סירוב חוזר (הדמיה)']);
    message = ok ? 'החיוב החוזר הצליח (הדמיה)' : 'החיוב החוזר נכשל (הדמיה)';
  } else if (action === 'approve') {
    await query('UPDATE transactions SET approved = TRUE, approved_by = $2 WHERE id = $1', [tx.id, user.id]);
    message = 'התנועה אושרה';
  } else if (action === 'bounce') {
    await query("UPDATE transactions SET status = 'bounced', failure_reason = $2 WHERE id = $1", [tx.id, extra.reason || 'צ׳ק חזר']);
    message = 'סומן כחזר';
  } else {
    throw new HttpError(400, 'פעולה לא מוכרת');
  }
  await audit(user, `tx_${action}`, 'transaction', tx.id, { source: tx.source, ...extra });
  return { message };
}

export async function kevaAction(soId, action, user, extra = {}) {
  const so = await one('SELECT * FROM standing_orders WHERE id = $1', [soId]);
  if (!so) throw new HttpError(404, 'הוראת קבע לא נמצאה');
  const src = getProvider(so.source)?.label || 'ידני';
  const sim = isSandbox() ? ' (הדמיה)' : '';
  let message;
  switch (action) {
    case 'freeze':
      await query("UPDATE standing_orders SET status = 'frozen' WHERE id = $1", [so.id]);
      message = `הוקפאה ב${src}${sim}`; break;
    case 'resume':
      await query("UPDATE standing_orders SET status = 'active', failures = 0 WHERE id = $1", [so.id]);
      message = `הופעלה מחדש ב${src}${sim}`; break;
    case 'cancel':
      await query("UPDATE standing_orders SET status = 'cancelled', cancel_reason = $2, cancelled_at = now() WHERE id = $1", [so.id, extra.reason || null]);
      message = `בוטלה ב${src}${sim}`;
      await query("INSERT INTO call_tasks (donor_id, reason, priority, due_date, standing_order_id, notes) VALUES ($1,'renewal',1, CURRENT_DATE + 3, $2, $3)", [so.donor_id, so.id, `הו"ק בוטלה: ${extra.reason || ''}`]);
      break;
    case 'amount': {
      const amount = Number(extra.amount);
      if (!amount || amount <= 0) throw new HttpError(400, 'סכום לא תקין');
      await query('UPDATE standing_orders SET amount = $2 WHERE id = $1', [so.id, amount]);
      message = `הסכום עודכן ל-${amount} ב${src}${sim}`; break;
    }
    case 'charge_once': {
      const amount = Number(extra.amount || so.amount);
      const { row } = await recordTransaction({
        donor_id: so.donor_id, source: so.source, kind: 'keva', method: so.type === 'bank' ? 'bank_keva' : 'credit',
        amount, currency: so.currency, status: 'paid', institution_id: so.institution_id, purpose_id: so.purpose_id,
        standing_order_id: so.id, notes: 'חיוב בודד מתוך המערכת',
      }, user, { isDemo: so.is_demo });
      await query('UPDATE standing_orders SET last_charge_date = CURRENT_DATE, months_paid = months_paid + 1 WHERE id = $1', [so.id]);
      message = `בוצע חיוב בודד ${amount}${sim} (תנועה ${row.id})`; break;
    }
    default: throw new HttpError(400, 'פעולה לא מוכרת');
  }
  await audit(user, `keva_${action}`, 'standing_order', so.id, { source: so.source, ...extra });
  return { message };
}

// ---------- מסמכים ----------
export async function issueDocument({ transactionId, donorId, type = 'receipt46', amount, currency, lang, providerKey, description, annualYear }, user) {
  const tx = transactionId ? await one('SELECT * FROM transactions WHERE id = $1', [transactionId]) : null;
  if (tx?.document_id) {
    const existing = await one('SELECT * FROM documents WHERE id = $1 AND status = $2', [tx.document_id, 'active']);
    if (existing) throw new HttpError(409, `כבר הופק מסמך לתנועה זו (${existing.number})`);
  }
  const donor = await one('SELECT * FROM donors WHERE id = $1', [tx?.donor_id || donorId]);
  const docSettings = await getSetting('documents');
  const pKey = providerKey || docSettings?.default_provider || 'greeninvoice';
  const finalAmount = Number(amount ?? tx?.amount ?? 0);
  const finalCurrency = currency || tx?.currency || 'ILS';
  if (finalAmount <= 0) throw new HttpError(400, 'לא ניתן להפיק מסמך על סכום 0');
  if (type === 'receipt46' && !donor?.id_number) {
    throw new HttpError(400, 'לקבלה לפי סעיף 46 נדרש מספר ת.ז./ח.פ. של התורם (חובה לדיווח ל"תרומות ישראל")');
  }
  const st = await providerState(pKey);
  let result;
  let sandbox = isSandbox();
  if (pKey === 'greeninvoice' && st.secrets.api_key_id) {
    result = await GI.issue(st, { donor, tx, type, amount: finalAmount, currency: finalCurrency, lang: lang || donor?.language, description });
  } else {
    const seq = await one("SELECT COUNT(*)::int + 1 AS n FROM documents WHERE provider = $1", [pKey]);
    result = {
      external_id: `SBX-${pKey}-${Date.now()}`,
      number: `${isSandbox() ? 'SBX-' : ''}${String(seq.n).padStart(5, '0')}`,
      pdf_url: null,
      tax_report_number: type === 'receipt46' ? `SBX-${Math.floor(100000000 + Math.random() * 899999999)}` : null,
    };
    sandbox = true;
  }
  const doc = await insert('documents', {
    donor_id: donor?.id || null,
    provider: pKey,
    type,
    number: result.number,
    external_id: result.external_id ? String(result.external_id) : null,
    amount: finalAmount,
    currency: finalCurrency,
    lang: lang || donor?.language || 'he',
    tax_report_number: result.tax_report_number,
    tax_report_status: type === 'receipt46' ? (result.tax_report_number ? 'reported' : 'pending') : 'not_required',
    pdf_url: result.pdf_url,
    is_annual: !!annualYear,
    sandbox,
    notes: annualYear ? `קבלה מרוכזת לשנת ${annualYear}` : null,
    is_demo: !!(tx?.is_demo || donor?.is_demo),
  });
  if (tx) await query('UPDATE transactions SET document_id = $2 WHERE id = $1', [tx.id, doc.id]);
  await audit(user, 'document_issue', 'document', doc.id, { type, provider: pKey, amount: finalAmount, tx: tx?.id });
  return doc;
}

export async function cancelDocument(docId, user, { reason } = {}) {
  const doc = await one('SELECT * FROM documents WHERE id = $1', [docId]);
  if (!doc) throw new HttpError(404, 'מסמך לא נמצא');
  if (doc.status === 'cancelled') throw new HttpError(400, 'המסמך כבר בוטל');
  const st = await providerState(doc.provider);
  if (doc.provider === 'greeninvoice' && st.secrets.api_key_id && !doc.sandbox) await GI.cancel(st, doc);
  // לפי חוק ניהול ספרים לא מוחקים מסמך: מסמנים בוטל ומפיקים זיכוי
  await query("UPDATE documents SET status = 'cancelled' WHERE id = $1", [doc.id]);
  const credit = await insert('documents', {
    donor_id: doc.donor_id, provider: doc.provider, type: 'credit', number: `${doc.number}-Z`, amount: doc.amount, currency: doc.currency,
    lang: doc.lang, tax_report_status: doc.type === 'receipt46' ? 'pending' : 'not_required', related_document_id: doc.id,
    sandbox: doc.sandbox, notes: `ביטול: ${reason || ''}`, is_demo: doc.is_demo,
  });
  await query('UPDATE transactions SET document_id = NULL WHERE document_id = $1', [doc.id]);
  await audit(user, 'document_cancel', 'document', doc.id, { reason, credit: credit.id });
  return { credit };
}

// ---------- הודעות ----------
export async function sendMessage({ donorId, channel, to, subject, body, automationId, dedupeKey, isDemo = false }, user) {
  let addr = to;
  if (!addr && donorId) {
    const d = await one('SELECT phone, email FROM donors WHERE id = $1', [donorId]);
    addr = channel === 'email' ? d?.email : d?.phone;
  }
  if (!addr) return { skipped: true, reason: 'אין כתובת לשליחה' };
  const provider = { whatsapp: 'whatsapp', sms: 'sms', email: 'email' }[channel];
  const st = provider ? await providerState(provider) : null;
  const status = isSandbox() || !st?.row?.enabled ? 'sent_sandbox' : 'queued';
  try {
    const row = await insert('messages_out', {
      donor_id: donorId || null, channel, to_addr: addr, subject: subject || null, body, status,
      automation_id: automationId || null, dedupe_key: dedupeKey || null, sent_by: user?.id || null, is_demo: isDemo,
    });
    return { row };
  } catch (e) {
    if (e.code === '23505') return { skipped: true, reason: 'נשלח כבר' };
    throw e;
  }
}

export { GI, notify };
