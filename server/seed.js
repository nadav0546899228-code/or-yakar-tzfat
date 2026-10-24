// נתוני דוגמה מסומנים (is_demo) - ליצירה, תצוגה מקדימה וניקוי בלחיצה ממסך המתכנת.
import { query, one, many, insert } from './lib/db.js';
import { hashPin } from './lib/security.js';

const DEMO_TABLES = [
  'settlements', 'messages_out', 'notifications', 'box_collections', 'event_guests', 'call_tasks', 'pledges', 'interactions', 'donor_dates',
  'spiritual_orders', 'aid_requests', 'transactions', 'documents', 'standing_orders', 'events', 'tzedaka_boxes', 'automations',
  'materials', 'segments', 'contact_messages', 'campaigns', 'purposes', 'donors', 'institutions',
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
  for (const [name, phone, roles] of demoUsers) {
    let u = await one('SELECT * FROM users WHERE phone = $1', [phone]);
    if (!u) {
      u = await insert('users', { name, phone, roles, pin_hash: hashPin('1234'), is_demo: true, institution_id: roles.includes('institution_manager') ? insts[0].id : null });
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
      account_masked: src === 'masav' ? `****${String(1000 + i).slice(-4)}` : null, token_ref: src === 'masav' ? `BANK:12-765-${100000 + i}` : null,
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

  await insert('contact_messages', { name: 'ישראל ישראלי', phone: '0529998877', subject: 'הצטרפות לישיבה', message: 'שלום, הבן שלי מעוניין לשמוע על הישיבה. אשמח שיחזרו אליי.', is_demo: true });
  inc('contact_messages');
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
  await query("INSERT INTO notifications (title, body, link, roles, is_demo) VALUES ('ברוכים הבאים למערכת', 'נוצרו נתוני דוגמה לבדיקה. ניתן לנקות אותם ממסך המתכנת', '/app/dev', '{developer,manager}', TRUE)");

  return { created: counts, demoPin: '1234', demoUsers: demoUsers.map(([name, phone]) => ({ name, phone })) };
}
