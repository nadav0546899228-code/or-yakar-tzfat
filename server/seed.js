// נתוני דוגמה מסומנים (is_demo) - ליצירה, תצוגה מקדימה וניקוי בלחיצה ממסך המתכנת.
import { query, one, many, insert } from './lib/db.js';
import { hashPin, bankRef } from './lib/security.js';
import { isPublished } from './env.js';
import crypto from 'node:crypto';

const DEMO_TABLES = [
  'settlements', 'messages_out', 'notifications', 'box_collections', 'event_guests', 'call_tasks', 'pledges', 'interactions', 'donor_dates',
  'spiritual_orders', 'aid_requests', 'transactions', 'documents', 'standing_orders', 'events', 'tzedaka_boxes', 'automations',
  'materials', 'segments', 'contact_messages', 'board_items', 'boards', 'campaign_teams', 'campaigns', 'purposes', 'donors', 'institutions',
];

export async function demoCounts() {
  const counts = {};
  let total = 0;
  for (const t of DEMO_TABLES) {
    const c = (await one(`SELECT COUNT(*)::int AS c FROM ${t} WHERE is_demo = TRUE`)).c;
    if (c) counts[t] = c;
    total += c;
  }
  const users = (await one('SELECT COUNT(*)::int AS c FROM users WHERE is_demo = TRUE')).c;
  if (users) counts.users = users;
  total += users;
  const real = (await one('SELECT (SELECT COUNT(*) FROM donors WHERE is_demo = FALSE) + (SELECT COUNT(*) FROM transactions WHERE is_demo = FALSE) AS c')).c;
  return { counts, total, realRecords: Number(real) };
}

export async function clearDemo() {
  const before = await demoCounts();
  await query('DELETE FROM donor_links WHERE donor_id IN (SELECT id FROM donors WHERE is_demo = TRUE)');
  await query("DELETE FROM sync_runs WHERE message LIKE 'דוגמה:%'");
  await query('UPDATE transactions SET document_id = NULL WHERE is_demo = TRUE');
  for (const t of DEMO_TABLES) await query(`DELETE FROM ${t} WHERE is_demo = TRUE`);
  await query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE is_demo = TRUE)');
  await query('DELETE FROM users WHERE is_demo = TRUE AND is_owner = FALSE');
  return { deleted: before.counts, total: before.total };
}

const FIRST = ['יוסף', 'משה', 'אברהם', 'יעקב', 'דוד', 'שמואל', 'חיים', 'אליהו', 'מאיר', 'רפאל', 'שלמה', 'נתן', 'אהרון', 'בנימין', 'יהודה', 'עמרם', 'מרדכי', 'ציון', 'שמעון', 'יצחק'];
const LAST = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אזולאי', 'דהן', 'אוחיון', 'גבאי', 'חדד', 'אבוטבול', 'עמר', 'בן חמו', 'שטרן', 'פרידמן', 'רוזנברג', 'וייס', 'אלמליח', 'טולדנו', 'בוזגלו'];
const CITIES = ['צפת', 'צפת', 'צפת', 'ירושלים', 'בני ברק', 'בית שמש', 'חיפה', 'אלעד', 'טבריה', 'כרמיאל'];
const OVERSEAS = [['David', 'Goldberg', 'ארה"ב', 'USD', 'en'], ['Michael', 'Stern', 'ארה"ב', 'USD', 'en'], ['Jacques', 'Benhamou', 'צרפת', 'EUR', 'fr'], ['Daniel', 'Cohen', 'אנגליה', 'GBP', 'en'], ['Sarah', 'Levy', 'צרפת', 'EUR', 'fr'], ['Aaron', 'Klein', 'קנדה', 'USD', 'en']];

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export async function seedDemo() {
  const counts = {};
  const inc = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };

  // מוסדות
  const instDefs = [
    ['ישיבה לבחורים', '#16357a'], ['כולל אברכים מצויינים', '#2b6cb0'], ['מדרשה לבנות נוה הדסה', '#9b2c6f'],
    ['חדר סופרים ומכון סת"ם', '#7b5e17'], ['מרכז הסיוע', '#2f855a'], ['אחוזת קורדוברו', '#975a16'],
  ];
  const insts = [];
  for (const [i, [name, color]] of instDefs.entries()) {
    const existing = await one('SELECT * FROM institutions WHERE name = $1', [name]);
    insts.push(existing || (await insert('institutions', { name, color, sort: i, is_demo: true })));
    if (!existing) inc('institutions');
  }

  // צוות לדוגמה
  const demoUsers = [
    ['רחמים (מנהל - דוגמה)', '0500000001', ['manager']],
    ['שרה (גזברית - דוגמה)', '0500000002', ['treasurer']],
    ['אבי (מוקד - דוגמה)', '0500000003', ['call_agent']],
    ['נתנאל (מתרים שטח - דוגמה)', '0500000004', ['recruiter']],
    ['מירי (מזכירות - דוגמה)', '0500000005', ['secretary']],
    ['הרב צבי (מנהל ישיבה - דוגמה)', '0500000006', ['institution_manager']],
    ['יהודית (מרכז הסיוע - דוגמה)', '0500000007', ['aid_coordinator']],
  ];
  const users = [];
  const demoPins = {};
  for (const [name, phone, roles] of demoUsers) {
    let u = await one('SELECT * FROM users WHERE phone = $1', [phone]);
    if (!u) {
      const pin = isPublished() ? String(crypto.randomInt(100000, 999999)) : '1234';
      demoPins[phone] = pin;
      u = await insert('users', { name, phone, roles, pin_hash: hashPin(pin), must_change_pin: isPublished(), is_demo: true, institution_id: roles.includes('institution_manager') ? insts[0].id : null });
      inc('users');
    }
    users.push(u);
  }
  const agent = users[2];
  const recruiter = users[3];

  // מטרות וקמפיינים
  const purposes = [];
  for (const [name, inst, amount] of [['החזקת התורה', 0, 180], ['אימוץ אברך', 1, 1800], ['שרי אלפים', 0, 1000], ['פרנס יום', 1, 1200], ['קרן החגים', 4, 360], ['מלגות בנות', 2, 500]]) {
    purposes.push(await insert('purposes', { name, institution_id: insts[inst].id, default_amount: amount, is_demo: true }));
    inc('purposes');
  }
  const year = new Date().getFullYear();
  const campaigns = [];
  for (const [name, kind, goal, start, end] of [
    ['מגבית ראש השנה', 'holiday', 250000, daysAgo(60), daysAgo(20)],
    ['קמפיין חנוכה - נר לכל משפחה', 'holiday', 180000, daysAgo(-20), daysAgo(-50)],
    ['תפילה 40 יום בקבר האר"י', 'spiritual', 60000, daysAgo(30), daysAgo(-10)],
    [`דינר השנתי ${year}`, 'dinner', 500000, daysAgo(-40), daysAgo(-40)],
    ['מבצע הגדלת הו"ק', 'upgrade', 40000, daysAgo(10), daysAgo(-30)],
  ]) {
    campaigns.push(await insert('campaigns', { name, kind, goal, start_date: start, end_date: end, institution_id: insts[0].id, is_demo: true }));
    inc('campaigns');
  }

  // תורמים
  const donors = [];
  for (let i = 0; i < 60; i++) {
    const overseas = i % 10 === 0;
    const o = rnd(OVERSEAS);
    const d = await insert('donors', overseas ? {
      first_name: o[0], last_name: o[1], country: o[2], currency: o[3], language: o[4], is_overseas: true, city: o[2] === 'ארה"ב' ? 'New York' : o[2] === 'צרפת' ? 'Paris' : 'London',
      phone: `+1${Math.floor(2000000000 + Math.random() * 7000000000)}`, email: `${o[0].toLowerCase()}${i}@example.com`, tags: ['חו"ל'], is_demo: true,
    } : {
      title: i % 7 === 0 ? 'הרב' : null, first_name: rnd(FIRST), last_name: rnd(LAST), city: rnd(CITIES),
      phone: `05${2 + (i % 7)}${String(1000000 + i * 7919).slice(-7)}`, email: i % 3 === 0 ? `donor${i}@example.co.il` : null,
      id_number: i % 2 === 0 ? String(100000000 + i * 1234567).slice(0, 9) : null,
      is_vip: i % 13 === 0, tags: i % 13 === 0 ? ['VIP'] : i % 5 === 0 ? ['בוגר'] : [], status: i % 17 === 0 ? 'dormant' : 'active',
      recruiter_user_id: i % 4 === 0 ? recruiter.id : null, mother_name: i % 3 === 0 ? rnd(['שרה', 'רחל', 'מרים', 'אסתר', 'חנה']) : null, is_demo: true,
    });
    donors.push(d);
    inc('donors');
  }

  // הו"ק
  const sources = ['nedarim', 'nedarim', 'nedarim', 'jgive', 'masav', 'masav', 'cardcom', 'kehilot'];
  const kevas = [];
  for (let i = 0; i < 28; i++) {
    const d = donors[i * 2];
    const src = rnd(sources);
    const status = i % 9 === 0 ? 'cancelled' : i % 11 === 0 ? 'frozen' : i % 13 === 0 ? 'failed' : 'active';
    const so = await insert('standing_orders', {
      donor_id: d.id, source: src, external_id: `DEMO-K-${i}`, type: src === 'masav' ? 'bank' : 'credit', amount: rnd([100, 150, 180, 260, 360, 500, 1000, 1800]),
      currency: d.currency || 'ILS', day_of_month: rnd([1, 10, 15, 20]), start_date: daysAgo(30 * (3 + (i % 20))), status,
      end_date: i % 6 === 0 ? daysAgo(-30 * (1 + (i % 3))) : null, months_paid: 3 + (i % 20), institution_id: insts[i % 4].id, purpose_id: purposes[i % purposes.length].id,
      card_last4: src === 'masav' ? null : String(1000 + i * 37).slice(-4), bank_code: src === 'masav' ? '12' : null, branch_code: src === 'masav' ? '765' : null,
      account_masked: src === 'masav' ? `****${String(1000 + i).slice(-4)}` : null, token_ref: src === 'masav' ? bankRef('12', '765', String(100000 + i)) : null,
      cancelled_at: status === 'cancelled' ? new Date(Date.now() - (i % 40) * 86400000) : null, cancel_reason: status === 'cancelled' ? rnd(['קושי כלכלי', 'כרטיס הוחלף', 'עבר לתרום במקום אחר']) : null,
      recruiter_user_id: i % 3 === 0 ? recruiter.id : null, failures: status === 'failed' ? 3 : 0, is_demo: true,
    });
    kevas.push(so);
    inc('standing_orders');
  }

  // תנועות: 12 חודשים אחורה
  let txCount = 0;
  for (const so of kevas) {
    for (let m = 0; m < 12; m++) {
      if (so.status === 'cancelled' && m < 2) continue;
      const failed = Math.random() < 0.05;
      const tx = await insert('transactions', {
        donor_id: so.donor_id, source: so.source, external_id: `DEMO-KT-${so.id}-${m}`, kind: 'keva', method: so.type === 'bank' ? 'bank_keva' : 'credit',
        amount: so.amount, currency: so.currency, amount_ils: so.currency === 'ILS' ? so.amount : so.amount * 3.7, date: daysAgo(m * 30 + 5),
        status: failed ? 'failed' : 'paid', failure_reason: failed ? 'סירוב חברת אשראי' : null, institution_id: so.institution_id, purpose_id: so.purpose_id,
        standing_order_id: so.id, card_last4: so.card_last4, is_demo: true,
      });
      await query("UPDATE transactions SET serial = 'OY-' || LPAD(id::text, 6, '0') WHERE id = $1", [tx.id]);
      txCount++;
    }
  }
  const oneSources = ['nedarim', 'jgive', 'charidy', 'cardcom', 'grow', 'manual', 'manual', 'kehilot'];
  const methods = { manual: ['cash', 'check', 'transfer'] };
  for (let i = 0; i < 140; i++) {
    const d = rnd(donors);
    const src = rnd(oneSources);
    const method = src === 'manual' ? rnd(methods.manual) : rnd(['credit', 'credit', 'bit']);
    const amount = rnd([36, 50, 100, 180, 260, 360, 500, 1000, 1800, 3600, 5000, 10000]);
    const date = daysAgo(Math.floor(Math.random() * 360));
    const camp = Math.random() < 0.4 ? rnd(campaigns) : null;
    const rate = d.currency === 'USD' ? 3.7 : d.currency === 'EUR' ? 4 : d.currency === 'GBP' ? 4.7 : 1;
    const tx = await insert('transactions', {
      donor_id: d.id, source: src, external_id: src === 'manual' ? null : `DEMO-T-${i}`, kind: method === 'cash' ? 'cash' : method === 'check' ? 'check' : method === 'transfer' ? 'transfer' : 'one_time',
      method, amount, currency: d.currency || 'ILS', amount_ils: amount * rate, date, status: Math.random() < 0.04 ? 'refunded' : 'paid',
      institution_id: rnd(insts).id, purpose_id: rnd(purposes).id, campaign_id: camp?.id || null, check_number: method === 'check' ? String(5000 + i) : null,
      check_bank: method === 'check' ? 'לאומי' : null, check_due_date: method === 'check' ? daysAgo(-Math.floor(Math.random() * 60)) : null,
      approved: !(method === 'cash' && i % 9 === 0), recruiter_user_id: d.recruiter_user_id, dedication: i % 8 === 0 ? 'לעילוי נשמת אבי מורי' : null, is_demo: true,
    });
    await query("UPDATE transactions SET serial = 'OY-' || LPAD(id::text, 6, '0') WHERE id = $1", [tx.id]);
    txCount++;
  }
  inc('transactions', txCount);

  // קבלות לחלק מהתנועות
  const toDoc = await many("SELECT t.*, d.id_number FROM transactions t JOIN donors d ON d.id = t.donor_id WHERE t.is_demo = TRUE AND t.status = 'paid' AND d.id_number IS NOT NULL ORDER BY random() LIMIT 70");
  let n = 1;
  for (const t of toDoc) {
    const doc = await insert('documents', {
      donor_id: t.donor_id, provider: rnd(['greeninvoice', 'greeninvoice', 'nedarim']), type: 'receipt46', number: `DEMO-${String(n++).padStart(5, '0')}`,
      amount: t.amount, currency: t.currency, issued_at: new Date(`${t.date}T10:00:00Z`), tax_report_number: Math.random() < 0.85 ? String(400000000 + n * 997) : null,
      tax_report_status: Math.random() < 0.85 ? 'reported' : 'pending', sent_via: ['email'], sandbox: true, is_demo: true,
    });
    await query('UPDATE transactions SET document_id = $2 WHERE id = $1', [t.id, doc.id]);
    inc('documents');
  }

  // תאריכים עבריים
  const months = ['Tishri', 'Heshvan', 'Kislev', 'Tevet', 'Shevat', 'Adar', 'Nisan', 'Iyar', 'Sivan', 'Tamuz', 'Av', 'Elul'];
  const { toHebrew } = await import('./lib/hebrew.js');
  for (let i = 0; i < 40; i++) {
    const d = donors[i];
    const soon = toHebrew(new Date(Date.now() + (i % 25) * 86400000));
    const kind = i % 3 === 0 ? 'birthday' : i % 3 === 1 ? 'yahrzeit' : 'anniversary';
    await insert('donor_dates', {
      donor_id: d.id, kind, person_name: kind === 'yahrzeit' ? `${rnd(FIRST)} בן ${rnd(['שרה', 'רחל', 'מזל', 'אסתר'])}` : `${d.first_name}`,
      relation: kind === 'yahrzeit' ? rnd(['אב', 'אם', 'סב', 'סבתא']) : 'עצמו', hebrew_day: i < 20 ? soon.day : 1 + (i % 28),
      hebrew_month: i < 20 ? soon.month : rnd(months), notify: true, is_demo: true,
    });
    inc('donor_dates');
  }

  // תיעוד קשר, משימות, התחייבויות
  for (let i = 0; i < 50; i++) {
    const d = rnd(donors);
    await insert('interactions', {
      donor_id: d.id, user_id: rnd(users).id, kind: rnd(['call', 'call', 'meeting', 'whatsapp', 'note']),
      summary: rnd(['שוחחנו על הגדלת הו"ק, ביקש לחזור אחרי החגים', 'פגישה במשרד - מעוניין לאמץ אברך', 'שלחתי סרטון תדמית', 'הודה על הקבלה, מבקש קבלה שנתית', 'ביקש לעדכן כרטיס אשראי']),
      follow_up_date: i % 4 === 0 ? daysAgo(-(i % 10)) : null, at: new Date(Date.now() - Math.random() * 90 * 86400000), is_demo: true,
    });
    inc('interactions');
  }
  for (let i = 0; i < 25; i++) {
    const d = donors[(i * 3) % donors.length];
    await insert('call_tasks', {
      donor_id: d.id, assigned_user_id: i % 3 === 0 ? null : agent.id, reason: rnd(['upgrade', 'renewal', 'follow_up', 'failed_charge', 'thank_you', 'yahrzeit']),
      priority: 1 + (i % 3), due_date: daysAgo(-(i % 4)), status: i % 6 === 0 ? 'callback' : 'open', campaign_id: i % 2 === 0 ? campaigns[4].id : null, is_demo: true,
    });
    inc('call_tasks');
  }
  for (let i = 0; i < 12; i++) {
    await insert('pledges', { donor_id: rnd(donors).id, amount: rnd([180, 360, 500, 1000, 1800]), reason: rnd(['עלייה לתורה - שמחת תורה', 'נדר בעת צרה', 'מפטיר יום כיפור', 'התחייבות בדינר']), due_date: daysAgo(-(i * 5)), status: i % 5 === 0 ? 'paid' : 'open', is_demo: true });
    inc('pledges');
  }

  // קופות צדקה
  const hoods = ['העיר העתיקה', 'כנען', 'הדר', 'שכונת צה"ל', 'מרום כנען', 'קריית חב"ד', 'דרום'];
  for (let i = 0; i < 18; i++) {
    const last = daysAgo(Math.floor(Math.random() * 90));
    const box = await insert('tzedaka_boxes', {
      code: `ק-${String(i + 1).padStart(3, '0')}`, location_name: rnd(['מכולת', 'בית כנסת', 'מאפייה', 'ירקן', 'בית מרקחת', 'מספרה']) + ` ${rnd(LAST)}`,
      neighborhood: rnd(hoods), address: `רחוב ${rnd(['ירושלים', 'הפלמ"ח', 'כנען', 'הגליל', 'ויצמן'])} ${1 + i}, צפת`, collection_interval_days: 60,
      last_collected_at: last, contact_name: rnd(FIRST), contact_phone: `0504${String(100000 + i * 37).slice(-6)}`, is_demo: true,
    });
    inc('tzedaka_boxes');
    for (let k = 1; k <= 3; k++) {
      await insert('box_collections', { box_id: box.id, collected_at: daysAgo(Math.floor(Math.random() * 60) + (k - 1) * 60), amount: 80 + Math.floor(Math.random() * 400), collector_user_id: recruiter.id, is_demo: true });
      inc('box_collections');
    }
  }

  // מבצעים רוחניים
  for (let i = 0; i < 20; i++) {
    await insert('spiritual_orders', {
      kind: rnd(['prayer', 'prayer', 'pidyon', 'memorial', 'tikun', 'kaddish']), name_for: rnd(FIRST), mother_name: rnd(['שרה', 'רחל', 'מרים', 'לאה', 'חנה']),
      request: rnd(['רפואה שלמה', 'זיווג הגון', 'פרנסה טובה', 'זרע של קיימא', 'הצלחה', 'לעילוי נשמה']), location: 'קבר האר"י הקדוש',
      donor_id: i % 2 === 0 ? rnd(donors).id : null, amount: rnd([18, 36, 180, 360]), status: rnd(['pending', 'active', 'done']), campaign_id: campaigns[2].id,
      source: i % 3 === 0 ? 'website' : 'office', contact_phone: '0501234567', is_demo: true,
    });
    inc('spiritual_orders');
  }

  // אירוע (דינר)
  const ev = await insert('events', { name: `דינר השנתי ${year}`, date: daysAgo(-40), location: 'אולמי הגליל, צפת', goal: 500000, campaign_id: campaigns[3].id, is_demo: true });
  inc('events');
  await insert('events', { name: 'ערב הוקרה לתורמים', date: daysAgo(90), location: 'בית הכנסת האר"י, צפת', goal: 150000, is_demo: true });
  await insert('events', { name: 'הילולת רבי משה קורדוברו', date: daysAgo(-15), location: 'אחוזת קורדוברו, צפת', goal: 80000, is_demo: true });
  inc('events', 2);
  for (let i = 0; i < 30; i++) {
    const d = donors[i];
    const rsvp = rnd(['yes', 'yes', 'pending', 'no', 'maybe']);
    await insert('event_guests', { event_id: ev.id, donor_id: d.id, rsvp, seats: rnd([1, 2, 2, 4]), table_no: rsvp === 'yes' ? String(1 + (i % 8)) : null, pledged_amount: rsvp === 'yes' ? rnd([0, 1800, 3600, 5000, 10000]) : 0, is_demo: true });
    inc('event_guests');
  }

  // מרכז הסיוע
  for (let i = 0; i < 10; i++) {
    await insert('aid_requests', { family_name: `משפחת ${rnd(LAST)}`, phone: '0521112233', kind: rnd(['holiday', 'food', 'rent', 'medical', 'wedding']), description: 'בקשה לדוגמה', amount_requested: rnd([500, 1000, 1500, 3000]), status: rnd(['new', 'review', 'approved', 'paid']), is_demo: true });
    inc('aid_requests');
  }

  // חומרים ואוטומציות
  const brochure = await insert('materials', { title: 'פרוספקט מוסדות אור יקר', kind: 'brochure', url: 'https://or-yakar-blue.co.il/', is_demo: true });
  await insert('materials', { title: 'סרט תדמית', kind: 'video', url: 'https://or-yakar-blue.co.il/classes/', is_demo: true });
  inc('materials', 2);
  const autos = [
    ['מזל טוב ליום הולדת', 'birthday', 'whatsapp', 'מזל טוב {שם}! כל משפחת אור יקר מברכת אותך ביום הולדתך, שתזכה לשנה של בריאות, שמחה ונחת. נתפלל עליך בקבר האר"י הקדוש.', null, 0],
    ['תזכורת יארצייט', 'yahrzeit', 'whatsapp', 'שלום {שם}, ביום {תאריך} חל יום הזיכרון של {נפטר}. אברכי הכולל ילמדו ויאמרו קדיש לעילוי נשמתו. ניתן להוסיף תרומה לעילוי נשמה.', null, 3],
    ['התראה על תרומה גבוהה', 'large_donation', 'notify', 'תרומה גבוהה מ{שם} ({סכום}) - לבצע שיחת תודה אישית', 5000, 0],
    ['שיחת תודה לתרומה גבוהה', 'large_donation', 'task', 'שיחת תודה אישית על תרומה בסך {סכום}', 5000, 0],
    ['חידוש הו"ק שבוטלה', 'keva_cancelled', 'task', 'הו"ק של {שם} בוטלה/הסתיימה - לשיחת חידוש', null, 0],
    ['ברוכים הבאים לתורם חדש', 'first_donation', 'whatsapp', 'שלום {שם}, תודה על תרומתך הראשונה למוסדות אור יקר! מצרפים פרוספקט קצר על פעילותנו.', null, 0],
  ];
  for (const [name, trigger, channel, template, threshold, days] of autos) {
    await insert('automations', { name, trigger, channel, template, threshold, days_before: days, material_id: trigger === 'first_donation' ? brochure.id : null, is_demo: true });
    inc('automations');
  }

  const contacts = [
    ['ישראל ישראלי', '0529998877', 'הצטרפות לישיבה', 'שלום, הבן שלי מעוניין לשמוע על הישיבה. אשמח שיחזרו אליי.'],
    ['רחל כהן', '0541112233', 'תרומה לעילוי נשמה', 'אני רוצה לתרום לעילוי נשמת אבי ולהזמין קדיש ולימוד. איך עושים את זה?'],
    ['משה לוי', '0533334455', 'קבלה על תרומה', 'תרמתי בחודש שעבר דרך נדרים פלוס ולא קיבלתי קבלה. אשמח לעזרה.'],
    ['אסתר מזרחי', '0525556677', 'סיוע למשפחה', 'אנחנו משפחה מצפת שזקוקה לעזרה לקראת החגים. למי פונים?'],
    ['David Goldberg', '+12125550100', 'Visit to Tzfat', 'We are visiting Tzfat next month and would love to visit the yeshiva.'],
  ];
  for (const [name, phone, subject, message] of contacts) {
    await insert('contact_messages', { name, phone, subject, message, is_demo: true });
    inc('contact_messages');
  }
  await insert('segments', { name: 'תורמי VIP', filter: { is_vip: true }, is_demo: true });
  await insert('segments', { name: 'רדומים 12 חודשים', filter: { dormant_months: 12 }, is_demo: true });
  await insert('segments', { name: 'תורמי חו"ל', filter: { is_overseas: true }, is_demo: true });
  inc('segments', 3);
  // זיכויי חברות אשראי לדוגמה: רוב תרומות האשראי מותאמות, חלקן ללא התאמה
  const creditTx = await many("SELECT id, date, amount_ils, card_last4 FROM transactions WHERE is_demo = TRUE AND method = 'credit' AND status = 'paid' AND date < CURRENT_DATE - 7 ORDER BY random() LIMIT 120");
  const acq = ['isracard', 'cal', 'max'];
  for (const [i, t] of creditTx.entries()) {
    const fee = Math.round(Number(t.amount_ils) * 0.007 * 100) / 100;
    const linked = i % 9 !== 0;
    await insert('settlements', {
      acquirer: acq[i % 3], batch: 'demo', transaction_date: t.date, deposit_date: new Date(new Date(t.date).getTime() + 3 * 86400000).toISOString().slice(0, 10),
      amount_gross: t.amount_ils, fee, amount_net: Number(t.amount_ils) - fee, card_last4: t.card_last4, card_brand: ['Visa', 'Mastercard', 'Isracard'][i % 3],
      approval_number: String(100000 + i * 37), voucher_number: String(900000 + i), transaction_id: linked ? t.id : null, match_status: linked ? 'auto' : 'unmatched', is_demo: true,
    });
    inc('settlements');
  }
  // קמפיין גיוס המונים עם דף ציבורי, הכפלה ושגרירים
  const cfEnd = new Date(Date.now() + 9 * 86400000 + 5 * 3600000).toISOString();
  const cf = await insert('campaigns', {
    name: `קמפיין חנוכה ${year} - מאירים את צפת`, kind: 'holiday', goal: 400000, start_date: daysAgo(3), end_date: daysAgo(-9), institution_id: insts[0].id,
    description: 'מוסדות אור יקר צפת מחזיקים ישיבה, כולל, מדרשה ומרכז סיוע למשפחות הקהילה.\nבקמפיין הזה אנחנו מגייסים את התקציב השנתי לאברכים ולמשפחות שזקוקות לעזרה.\nכל תרומה מוכפלת על ידי קבוצת תורמים שותפים, כך שכל שקל שווה כפליים.',
    active: true, public_page: true, slug: 'demo-chanuka', headline: 'מאירים את צפת - קמפיין חנוכה של מוסדות אור יקר', matching: 2, matching_text: 'בזכות קבוצת שותפים מחו"ל', amounts: '100, 180, 360, 500, 1000, 1800',
    end_at: cfEnd, show_donors: true, base_raised: 15000, is_demo: true,
  });
  inc('campaigns');
  const teamDefs = [['הרב יעקב לוי', 'yaakov', 40000], ['בוגרי הישיבה', 'alumni', 60000], ['משפחת מזרחי', 'mizrahi', 25000], ['שגרירי חו"ל', 'overseas', 80000], ['נשות הקהילה', 'nashim', 30000]];
  const teams = [];
  for (const [name, slug, goal] of teamDefs) {
    teams.push(await insert('campaign_teams', { campaign_id: cf.id, name, slug, goal, description: 'מצטרפים אליי לקמפיין ועוזרים לי להגיע ליעד!', active: true, is_demo: true }));
    inc('campaign_teams');
  }
  const msgs = ['לעילוי נשמת אבי מורי', 'בהצלחה רבה!', 'לרפואת כל חולי ישראל', null, null, 'שנזכה לראות נחת', 'חג אורים שמח', null, 'לזכות הילדים'];
  for (let i = 0; i < 70; i++) {
    const d = donors[i % donors.length];
    const amount = rnd([100, 180, 180, 360, 360, 500, 1000, 1800, 250, 52]);
    const t = await insert('transactions', {
      donor_id: d.id, source: 'campaign', kind: 'one_time', method: 'credit', amount, currency: 'ILS', amount_ils: amount, date: daysAgo(Math.floor(i / 25)), status: 'paid',
      campaign_id: cf.id, institution_id: insts[0].id, team_id: i % 4 === 3 ? null : teams[i % teams.length].id, display_name: `${d.first_name} ${d.last_name}`.trim(),
      is_anonymous: i % 11 === 0, public_message: rnd(msgs), approved: true, is_demo: true,
    });
    await query("UPDATE transactions SET serial = 'OY-' || LPAD(id::text, 6, '0'), created_at = now() - ($2 || ' minutes')::interval WHERE id = $1", [t.id, String(i * 37)]);
    inc('transactions');
  }
  // לוחות מודעות לדוגמה
  const board = await insert('boards', {
    name: 'בית הכנסת המרכזי', slug: 'demo-beit-knesset', location: 'מעלה הרמ"ק 2, צפת', theme: 'navy', show_zmanim: true, show_yahrzeits: true, show_campaign_id: cf.id,
    prayer_times: 'שחרית ותיקין - הנץ\nשחרית - 06:30\nשחרית ב - 08:00\nמנחה - 13:30\nמנחה גדולה - 16:15\nערבית - צאת הכוכבים\nשיעור דף יומי - 20:30',
    ticker: 'ברוכים הבאים לבית הכנסת של מוסדות אור יקר · נא לשמור על שקט בעת התפילה · קמפיין חנוכה בעיצומו - כל תרומה מוכפלת!', slide_seconds: 10, active: true, is_demo: true,
  });
  await insert('boards', { name: 'מסך המשרד', slug: 'demo-office', location: 'משרדי העמותה', theme: 'light', show_zmanim: true, show_yahrzeits: false, show_campaign_id: cf.id, slide_seconds: 12, active: true, is_demo: true });
  inc('boards', 2);
  const boardItems = [
    [null, 'announcement', 'שיעור הרב השבועי', 'כל יום שלישי בשעה 20:30 בהיכל הישיבה.\nהשיעור פתוח לכל הקהילה.'],
    [board.id, 'mazal_tov', 'מזל טוב למשפחת כהן', 'להולדת הבן. יזכו לגדלו לתורה, לחופה ולמעשים טובים'],
    [board.id, 'memorial', 'לעילוי נשמת ר׳ אברהם בן שרה ז"ל', 'הלימוד היום מוקדש לעילוי נשמתו'],
    [null, 'shiur', 'דף יומי עם הרב משה', 'כל ערב אחרי ערבית'],
    [null, 'donor', 'תודה לתורמי קמפיין חנוכה', 'בזכותכם הישיבה והכולל ממשיכים לפעול'],
    [board.id, 'announcement', 'סעודה שלישית בשבת', 'בהשתתפות כל הקהילה. ההרשמה במשרד'],
  ];
  for (const [i, [bid, kind, title, body]] of boardItems.entries()) {
    await insert('board_items', { board_id: bid, kind, title, body, sort: i, active: true, starts_on: daysAgo(2), ends_on: daysAgo(-20), is_demo: true });
    inc('board_items');
  }

  // קישורי תורמים למערכות חיצוניות (מאיפה התורם מוכר: נדרים, JGive, קהילות)
  for (const [i, d] of donors.entries()) {
    if (i % 3 === 0) continue;
    const src = ['nedarim', 'jgive', 'kehilot'][i % 3];
    await query('INSERT INTO donor_links (donor_id, source, external_id, raw) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [d.id, src, `DEMO-${src}-${1000 + i}`, JSON.stringify({ demo: true })]);
    inc('donor_links');
  }
  // יומן הודעות יוצאות: תודות, ברכות, תזכורות וקבלות שנשלחו
  const msgTpl = [
    ['whatsapp', null, 'תודה רבה על תרומתך למוסדות אור יקר! הקבלה מצורפת.'],
    ['whatsapp', null, 'מזל טוב ליום הולדתך! כל משפחת אור יקר מברכת אותך.'],
    ['sms', null, 'שלום, הוראת הקבע שלך לא עברה החודש. נשמח שתעדכן אמצעי תשלום.'],
    ['email', 'קבלה על תרומה', 'מצורפת קבלה לפי סעיף 46 על תרומתך. תודה!'],
    ['email', 'הזמנה לדינר השנתי', 'נשמח לראותך בדינר השנתי של מוסדות אור יקר.'],
    ['whatsapp', null, 'תזכורת: השבוע חל יום הזיכרון. אברכי הכולל יאמרו קדיש לעילוי הנשמה.'],
  ];
  const statuses = ['sent_sandbox', 'sent_sandbox', 'sent_sandbox', 'sent_sandbox', 'sent_sandbox', 'failed', 'queued'];
  for (let i = 0; i < 60; i++) {
    const d = rnd(donors);
    const [channel, subject, body] = rnd(msgTpl);
    const st = rnd(statuses);
    await insert('messages_out', {
      donor_id: d.id, channel, to_addr: channel === 'email' ? (d.email || `demo${i}@example.com`) : (d.phone || '0500000000'),
      subject, body, status: st, error: st === 'failed' ? 'המספר לא זמין (הדמיה)' : null, at: new Date(Date.now() - Math.floor(Math.random() * 60) * 86400000 - i * 3600000).toISOString(), is_demo: true,
    });
    inc('messages_out');
  }
  // היסטוריית סנכרון מספקים (הדמיה)
  for (const [prov, n] of [['nedarim', 6], ['jgive', 3], ['kehilot', 3], ['greeninvoice', 2], ['masav', 2]]) {
    for (let i = 0; i < n; i++) {
      const started = new Date(Date.now() - (i * 3 + 1) * 86400000);
      await query('INSERT INTO sync_runs (provider, started_at, finished_at, status, imported, updated, message) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [prov, started.toISOString(), new Date(started.getTime() + 40000).toISOString(), i === 2 ? 'error' : 'ok', i === 2 ? 0 : 3 + ((i * 7) % 15), (i * 3) % 6, i === 2 ? 'דוגמה: תם הזמן לחיבור, ינוסה שוב' : 'דוגמה: סנכרון הדמיה']);
      inc('sync_runs');
    }
  }
  const notifs = [
    ['ברוכים הבאים למערכת', 'נוצרו נתוני דוגמה לבדיקה. ניתן לנקות אותם ממסך המתכנת', '/app/dev', '{developer,manager}'],
    ['תרומה גבוהה התקבלה', 'תרומה של 18,000 ש"ח דרך נדרים פלוס (דוגמה)', '/app/transactions', '{developer,manager,vp,treasurer}'],
    ['3 חיובי הו"ק נכשלו', 'נוצרו משימות שיחה לחזרה לתורמים (דוגמה)', '/app/keva', '{developer,manager,vp,treasurer,secretary}'],
    ['פנייה חדשה מהאתר', 'ישראל ישראלי ביקש שיחזרו אליו (דוגמה)', '/app/r/contact_messages', '{developer,manager,secretary}'],
    ['קופות צדקה לפריקה', 'יש קופות שהגיע מועד הפריקה שלהן (דוגמה)', '/app/r/tzedaka_boxes', '{developer,manager,secretary,recruiter}'],
    ['דוח זיכויים נקלט', 'דוח ישראכרט נקלט, יש שורות לבדיקה ידנית (דוגמה)', '/app/settlements', '{developer,manager,treasurer}'],
  ];
  for (const [title, body, link, roles] of notifs) {
    await query('INSERT INTO notifications (title, body, link, roles, is_demo) VALUES ($1,$2,$3,$4,TRUE)', [title, body, link, roles]);
    inc('notifications');
  }

  return { created: counts, demoPin: isPublished() ? null : '1234', demoUsers: demoUsers.map(([name, phone]) => ({ name, phone, pin: demoPins[phone] || null })) };
}
