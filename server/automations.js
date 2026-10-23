// אוטומציות: התראות על תרומות גבוהות, מזל טוב, יארצייט, נטישת הו"ק ועוד.
import { many, one, query } from './lib/db.js';
import { nextOccurrence, isoDate, toHebrew } from './lib/hebrew.js';
import { getSetting } from './settings.js';
import { notify } from './audit.js';

let engine = null;
async function eng() {
  if (!engine) engine = await import('./providers/engine.js');
  return engine;
}

function fill(template, vars) {
  return String(template || '').replace(/\{(\S+?)\}/g, (_, k) => (vars[k] ?? ''));
}

function donorName(d) {
  return `${d.title ? `${d.title} ` : ''}${d.first_name || ''} ${d.last_name || ''}`.trim();
}

async function runAutomation(a, donor, vars, dedupeKey) {
  const { sendMessage } = await eng();
  const body = fill(a.template, { שם: donorName(donor), ...vars });
  if (a.channel === 'task') {
    await query("INSERT INTO call_tasks (donor_id, reason, priority, due_date, notes, is_demo) VALUES ($1,$2,1, CURRENT_DATE, $3, $4)",
      [donor.id, a.trigger === 'large_donation' ? 'thank_you' : a.trigger === 'yahrzeit' ? 'yahrzeit' : 'follow_up', body || a.name, donor.is_demo]);
    return;
  }
  if (a.channel === 'notify') {
    await notify({ title: a.name, body, link: `/app/donors/${donor.id}`, isDemo: donor.is_demo });
    return;
  }
  if (donor.no_contact) return;
  let finalBody = body;
  if (a.material_id) {
    const m = await one('SELECT title, url FROM materials WHERE id = $1', [a.material_id]);
    if (m?.url) finalBody += `\n${m.title}: ${m.url}`;
  }
  await sendMessage({ donorId: donor.id, channel: a.channel, body: finalBody, automationId: a.id, dedupeKey, isDemo: donor.is_demo });
}

export async function onTransactionCreated(tx) {
  if (!tx.donor_id || tx.status !== 'paid') return;
  const donor = await one('SELECT * FROM donors WHERE id = $1', [tx.donor_id]);
  if (!donor) return;
  const docs = await getSetting('documents');
  const threshold = Number(docs?.large_donation_threshold || 5000);
  if (Number(tx.amount_ils) >= threshold) {
    await notify({
      title: `תרומה גבוהה: ${Number(tx.amount_ils).toLocaleString('he-IL')} ₪`,
      body: `${donorName(donor)} - מומלץ לבצע שיחת תודה אישית`,
      link: `/app/donors/${donor.id}`,
      isDemo: tx.is_demo,
    });
  }
  const autos = await many("SELECT * FROM automations WHERE enabled = TRUE AND trigger IN ('large_donation','first_donation')");
  for (const a of autos) {
    if (a.trigger === 'large_donation' && Number(tx.amount_ils) < Number(a.threshold || threshold)) continue;
    if (a.trigger === 'first_donation') {
      const c = await one("SELECT COUNT(*)::int AS c FROM transactions WHERE donor_id = $1 AND status = 'paid'", [donor.id]);
      if (c.c !== 1) continue;
    }
    await runAutomation(a, donor, { סכום: Number(tx.amount).toLocaleString('he-IL') }, `auto-${a.id}-tx-${tx.id}`);
  }
}

export async function onDonorCreated(donor) {
  const autos = await many("SELECT * FROM automations WHERE enabled = TRUE AND trigger = 'new_donor'");
  for (const a of autos) await runAutomation(a, donor, {}, `auto-${a.id}-donor-${donor.id}`);
}

// ריצה יומית: תאריכים עבריים, הו"ק שהסתיימו, חיובים שנכשלו
export async function runDailyAutomations() {
  const today = new Date();
  const result = { messages: 0, tasks: 0, ended: 0 };
  // הו"ק שתאריך הסיום שלהן עבר -> הסתיימו + משימת חידוש
  const ended = await many("UPDATE standing_orders SET status = 'ended' WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE RETURNING id, donor_id, is_demo");
  for (const so of ended) {
    await query("INSERT INTO call_tasks (donor_id, reason, priority, due_date, standing_order_id, notes, is_demo) VALUES ($1,'renewal',1, CURRENT_DATE + 2, $2, 'הו\"ק הסתיימה - לחידוש', $3)", [so.donor_id, so.id, so.is_demo]);
    result.ended++;
  }
  const autos = await many("SELECT * FROM automations WHERE enabled = TRUE AND trigger IN ('birthday','yahrzeit','anniversary','keva_cancelled','keva_failed')");
  if (!autos.length) return result;
  const dates = await many(`SELECT dd.*, d.first_name, d.last_name, d.title, d.no_contact, d.is_demo AS d_demo, d.phone, d.email
    FROM donor_dates dd JOIN donors d ON d.id = dd.donor_id WHERE dd.notify = TRUE AND dd.hebrew_day IS NOT NULL AND dd.hebrew_month IS NOT NULL`);
  for (const a of autos.filter((x) => ['birthday', 'yahrzeit', 'anniversary'].includes(x.trigger))) {
    const target = new Date(today.getTime() + (a.days_before || 0) * 86400000);
    const targetIso = isoDate(target);
    for (const dd of dates.filter((x) => x.kind === a.trigger)) {
      const occ = nextOccurrence(dd.hebrew_day, dd.hebrew_month, today);
      if (!occ || isoDate(occ) !== targetIso) continue;
      const donor = { id: dd.donor_id, first_name: dd.first_name, last_name: dd.last_name, title: dd.title, no_contact: dd.no_contact, is_demo: dd.d_demo };
      await runAutomation(a, donor, { נפטר: dd.person_name || '', תאריך: toHebrew(occ).text }, `auto-${a.id}-date-${dd.id}-${targetIso}`);
      result.messages++;
    }
  }
  for (const a of autos.filter((x) => x.trigger === 'keva_cancelled')) {
    const list = await many(`SELECT d.*, s.id AS so_id FROM standing_orders s JOIN donors d ON d.id = s.donor_id
      WHERE s.status IN ('cancelled','ended') AND COALESCE(s.cancelled_at, s.end_date::timestamptz) > now() - interval '2 days'`);
    for (const d of list) { await runAutomation(a, d, {}, `auto-${a.id}-so-${d.so_id}`); result.messages++; }
  }
  for (const a of autos.filter((x) => x.trigger === 'keva_failed')) {
    const list = await many(`SELECT d.*, t.id AS tx_id FROM transactions t JOIN donors d ON d.id = t.donor_id
      WHERE t.kind = 'keva' AND t.status = 'failed' AND t.created_at > now() - interval '2 days'`);
    for (const d of list) { await runAutomation(a, d, {}, `auto-${a.id}-txf-${d.tx_id}`); result.messages++; }
  }
  await query('UPDATE automations SET last_run_at = now() WHERE enabled = TRUE');
  return result;
}
