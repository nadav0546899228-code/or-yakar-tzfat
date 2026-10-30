import { rewriteDonationLinks } from './nedarim.js';
// לוח מודעות דיגיטלי ודף קמפיין גיוס המונים - שני מסכים ציבוריים בלי כניסה למערכת
import { one, many, query, insert } from '../lib/db.js';
import { HttpError } from '../lib/router.js';
import { zmanim, ZMAN_LABELS } from '../lib/zmanim.js';
import { toHebrew, nextOccurrence, isoDate } from '../lib/hebrew.js';
import { isSandbox } from '../env.js';
import { normalizePhone } from '../lib/security.js';
import { upsertDonorFromSource, recordTransaction } from '../providers/engine.js';
import { notify } from '../audit.js';
import { getSetting } from '../settings.js';

const TZ = 'Asia/Jerusalem';
const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function campaignProgress(c) {
  const sum = await one("SELECT COALESCE(SUM(amount_ils),0)::float AS raised, COUNT(*)::int AS donors FROM transactions WHERE campaign_id = $1 AND status = 'paid'", [c.id]);
  const raised = Number(sum.raised) + Number(c.base_raised || 0);
  const matching = Math.max(1, Number(c.matching) || 1);
  return { raised, donors: sum.donors, matching, total: Math.round(raised * matching), goal: Number(c.goal) || 0 };
}

export function registerCommunityRoutes(r) {
  // ---------- לוח מודעות: הנתונים למסך ----------
  r.get('/api/public/board/:slug', async (ctx) => {
    const board = await one('SELECT * FROM boards WHERE slug = $1 AND active = TRUE', [ctx.params.slug]);
    if (!board) throw new HttpError(404, 'הלוח לא נמצא או שאינו פעיל');
    const today = localToday();
    const items = await many(`SELECT id, kind, title, body, image_url FROM board_items
      WHERE active = TRUE AND (board_id IS NULL OR board_id = $1) AND (starts_on IS NULL OR starts_on <= $2::date) AND (ends_on IS NULL OR ends_on >= $2::date)
      ORDER BY sort, id DESC LIMIT 40`, [board.id, today]);
    const out = {
      board: { name: board.name, location: board.location, theme: board.theme, ticker: board.ticker, slide_seconds: Math.max(5, Number(board.slide_seconds) || 12) },
      today, hebrew: toHebrew(new Date(`${today}T12:00:00`)).text,
      items,
      prayers: String(board.prayer_times || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.split(/\s+[-–:]\s+|\t/); return m.length > 1 ? { name: m[0], time: m.slice(1).join(' ') } : { name: l, time: '' }; }),
    };
    if (board.show_zmanim) {
      const z = zmanim(today);
      out.zmanim = ZMAN_LABELS.filter(([k]) => z[k]).map(([k, label]) => ({ key: k, label, time: z[k] }));
      // זמני השבת הקרובה
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      const fri = addDays(today, (5 - dow + 7) % 7);
      const sat = addDays(fri, 1);
      out.shabbat = { candles: zmanim(fri).candles, havdala: zmanim(sat).havdala, date: fri };
    }
    if (board.show_yahrzeits) {
      const rows = await many("SELECT person_name, hebrew_day, hebrew_month, relation FROM donor_dates WHERE kind = 'yahrzeit' AND person_name IS NOT NULL AND hebrew_day IS NOT NULL AND hebrew_month IS NOT NULL");
      const from = new Date(`${today}T12:00:00`);
      const limit = new Date(from.getTime() + 7 * 86400000);
      out.yahrzeits = rows.map((x) => ({ name: x.person_name, at: nextOccurrence(x.hebrew_day, x.hebrew_month, from) }))
        .filter((x) => x.at && x.at <= limit).sort((a, b) => a.at - b.at).slice(0, 18)
        .map((x) => ({ name: x.name, date: toHebrew(x.at).text.split(' ').slice(0, 2).join(' ') }));
    }
    if (board.show_campaign_id) {
      const c = await one('SELECT * FROM campaigns WHERE id = $1', [board.show_campaign_id]);
      if (c) out.campaign = { name: c.headline || c.name, slug: c.public_page ? c.slug : null, ...(await campaignProgress(c)) };
    }
    const org = await getSetting('org');
    out.org = { name: org?.short_name || org?.name, logo_url: org?.logo_url };
    ctx.json(200, out);
  });

  // ---------- דף קמפיין ----------
  r.get('/api/public/campaign/:slug', async (ctx) => {
    const c = await one('SELECT * FROM campaigns WHERE slug = $1 AND public_page = TRUE', [ctx.params.slug]);
    if (!c) throw new HttpError(404, 'הקמפיין לא נמצא');
    const prog = await campaignProgress(c);
    const teams = await many(`SELECT ct.id, ct.name, ct.slug, ct.goal, ct.description, ct.image_url,
      COALESCE((SELECT SUM(amount_ils) FROM transactions t WHERE t.team_id = ct.id AND t.status = 'paid'),0)::float AS raised,
      (SELECT COUNT(*) FROM transactions t WHERE t.team_id = ct.id AND t.status = 'paid')::int AS donors
      FROM campaign_teams ct WHERE ct.campaign_id = $1 AND ct.active = TRUE ORDER BY raised DESC, ct.id`, [c.id]);
    const recent = c.show_donors ? await many(`SELECT t.id, t.amount_ils::float AS amount, t.created_at, t.public_message, t.is_anonymous, t.display_name, ct.name AS team
      FROM transactions t LEFT JOIN campaign_teams ct ON ct.id = t.team_id WHERE t.campaign_id = $1 AND t.status = 'paid' ORDER BY t.created_at DESC LIMIT 40`, [c.id]) : [];
    const org = await getSetting('org');
    ctx.json(200, {
      campaign: {
        id: c.id, name: c.name, headline: c.headline || c.name, description: c.description, image_url: c.image_url, video_url: c.video_url,
        end_at: c.end_at || (c.end_date ? `${String(c.end_date).slice(0, 10)}T23:59:00+02:00` : null), matching_text: c.matching_text,
        amounts: String(c.amounts || '100, 180, 360, 500, 1000, 1800').split(',').map((x) => Number(x.trim())).filter((x) => x > 0).slice(0, 8),
        show_donors: c.show_donors, active: c.active,
      },
      progress: prog,
      teams: teams.map((t) => ({ ...t, total: Math.round(t.raised * prog.matching) })),
      recent: recent.map((x) => ({ id: x.id, name: x.is_anonymous ? 'תורם/ת בעילום שם' : (x.display_name || 'תורם/ת'), amount: x.amount, message: x.public_message, team: x.team, at: x.created_at })),
      org: { name: org?.short_name || org?.name, logo_url: org?.logo_url, donation_url: rewriteDonationLinks(org?.donation_url) },
      sandbox: isSandbox(),
    });
  });

  r.post('/api/public/campaign/:slug/donate', async (ctx) => {
    const c = await one('SELECT * FROM campaigns WHERE slug = $1 AND public_page = TRUE', [ctx.params.slug]);
    if (!c || !c.active) throw new HttpError(404, 'הקמפיין אינו פעיל');
    const b = ctx.body;
    if (b.website) { ctx.json(200, { ok: true }); return; } // מלכודת בוטים
    const amount = Math.round(Number(b.amount) * 100) / 100;
    if (!(amount >= 5) || amount > 1000000) throw new HttpError(400, 'יש לבחור סכום תרומה');
    const name = String(b.name || '').trim().slice(0, 80);
    const phone = normalizePhone(b.phone);
    if (!name || (!phone && !b.email)) throw new HttpError(400, 'יש למלא שם וטלפון או מייל, לצורך הקבלה');
    let teamId = null;
    if (b.team_id) {
      const t = await one('SELECT id FROM campaign_teams WHERE id = $1 AND campaign_id = $2', [b.team_id, c.id]);
      teamId = t ? t.id : null;
    }
    const [first, ...rest] = name.split(/\s+/);
    const donorId = await upsertDonorFromSource('campaign', `${phone || b.email}`, { first_name: first, last_name: rest.join(' '), phone, email: b.email || null });
    const sandbox = isSandbox();
    const { row } = await recordTransaction({
      donor_id: donorId, source: 'campaign', kind: 'one_time', method: 'credit', amount, currency: 'ILS', status: sandbox ? 'paid' : 'pending',
      campaign_id: c.id, institution_id: c.institution_id, team_id: teamId, display_name: name, is_anonymous: !!b.anonymous,
      public_message: String(b.message || '').trim().slice(0, 200) || null, dedication: String(b.dedication || '').trim().slice(0, 200) || null,
      notes: sandbox ? 'תרומה מדף הקמפיין (הדמיה - לא נגבה כסף)' : 'תרומה מדף הקמפיין - ממתינה לאישור הסליקה',
    }, null);
    await notify({ title: `תרומה בקמפיין ${c.name}`, body: `${b.anonymous ? 'בעילום שם' : name} · ${amount.toLocaleString('he-IL')} ₪${sandbox ? ' (הדמיה)' : ''}`, link: '/app/transactions', roles: ['developer', 'manager', 'vp', 'treasurer'] });
    if (!sandbox && c.donation_url) { ctx.json(200, { ok: true, redirect: rewriteDonationLinks(c.donation_url), tx: row.id }); return; }
    ctx.json(200, { ok: true, sandbox, tx: row.id });
  });
}

export { isoDate };
