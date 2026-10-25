import React, { useEffect, useMemo, useState } from 'react';
import { api, useApi, run, toast, money, Link, navigate, AppCtx, Spinner } from './lib.jsx';
import { Icon } from './icons.jsx';
import { ResourceForm } from './crm.jsx';
import { can } from './app.jsx';

const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
const fmtNum = (n) => Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 });

// =====================================================================
// לוח מודעות דיגיטלי - מסך מלא לטלוויזיה בבית הכנסת / במשרד
// =====================================================================
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

export function BoardScreen({ slug }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [idx, setIdx] = useState(0);
  const now = useClock();
  useEffect(() => {
    let alive = true;
    const load = () => api(`/public/board/${encodeURIComponent(slug)}`).then((d) => { if (alive) { setData(d); setErr(null); } }).catch((e) => alive && setErr(e));
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    // גרסה חדשה של המערכת - המסך נטען מחדש לבד (אין מי שילחץ על כפתור)
    // eslint-disable-next-line no-undef
    const mine = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null;
    const v = setInterval(() => fetch(`/build.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).then((b) => { if (mine && b.build_id && b.build_id !== mine) window.location.reload(); }).catch(() => {}), 10 * 60 * 1000);
    return () => { alive = false; clearInterval(t); clearInterval(v); };
  }, [slug]);
  const slides = data?.items || [];
  useEffect(() => {
    if (slides.length < 2) return undefined;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), (data.board.slide_seconds || 12) * 1000);
    return () => clearInterval(t);
  }, [slides.length, data?.board?.slide_seconds]);
  useEffect(() => { document.title = data?.board?.name || 'לוח מודעות'; }, [data?.board?.name]);
  if (err) return <div className="bd-error">{err.message}</div>;
  if (!data) return <div className="bd-error">טוען…</div>;
  const s = slides[idx % Math.max(1, slides.length)];
  const KIND = { memorial: 'לעילוי נשמת', mazal_tov: 'מזל טוב', shiur: 'שיעור', donor: 'הוקרה ותודה', announcement: 'הודעה', image: '' };
  return (
    <div className={`bd bd-${data.board.theme || 'navy'}`}>
      <header className="bd-head">
        <div className="bd-brand">{data.org?.logo_url && <img src={data.org.logo_url} alt="" />}<div><b>{data.board.name}</b>{data.board.location && <span>{data.board.location}</span>}</div></div>
        <div className="bd-clock num">{now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })}</div>
        <div className="bd-date"><b>{data.hebrew}</b><span>{now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' })}</span></div>
      </header>
      <main className="bd-main">
        <aside className="bd-col">
          {data.zmanim && (
            <section className="bd-box">
              <h3><Icon name="clock" />זמני היום · צפת</h3>
              {data.zmanim.map((z) => <div key={z.key} className={`bd-row ${['candles', 'havdala'].includes(z.key) ? 'hi' : ''}`}><span>{z.label}</span><b className="num">{z.time}</b></div>)}
            </section>
          )}
          {data.shabbat && (
            <section className="bd-box bd-shabbat">
              <h3><Icon name="candle" />שבת הקרובה</h3>
              <div className="bd-row"><span>הדלקת נרות</span><b className="num">{data.shabbat.candles}</b></div>
              <div className="bd-row"><span>צאת השבת</span><b className="num">{data.shabbat.havdala}</b></div>
            </section>
          )}
        </aside>
        <section className="bd-stage">
          {s ? (
            <div key={s.id} className={`bd-slide k-${s.kind}`}>
              {s.image_url && <img className="bd-img" src={s.image_url} alt="" />}
              {KIND[s.kind] && <div className="bd-kind">{KIND[s.kind]}</div>}
              <h1>{s.title}</h1>
              {s.body && <p>{s.body}</p>}
            </div>
          ) : <div className="bd-slide"><h1>{data.org?.name}</h1><p>ברוכים הבאים</p></div>}
          {slides.length > 1 && <div className="bd-dots">{slides.map((x, i) => <i key={x.id} className={i === idx % slides.length ? 'on' : ''} />)}</div>}
        </section>
        <aside className="bd-col">
          {data.prayers?.length > 0 && (
            <section className="bd-box">
              <h3><Icon name="building" />זמני תפילות</h3>
              {data.prayers.map((p, i) => <div key={i} className="bd-row"><span>{p.name}</span><b className="num">{p.time}</b></div>)}
            </section>
          )}
          {data.yahrzeits?.length > 0 && (
            <section className="bd-box bd-memorial">
              <h3><Icon name="candle" />אזכרות השבוע</h3>
              {data.yahrzeits.map((y, i) => <div key={i} className="bd-row"><span>{y.name}</span><b>{y.date}</b></div>)}
            </section>
          )}
          {data.campaign && (
            <section className="bd-box bd-camp">
              <h3><Icon name="megaphone" />{data.campaign.name}</h3>
              <div className="bd-camp-num num">₪{fmtNum(data.campaign.total)}</div>
              {data.campaign.goal > 0 && <><div className="cf-bar"><i style={{ width: `${pct(data.campaign.total, data.campaign.goal)}%` }} /></div><div className="bd-row"><span>מתוך ₪{fmtNum(data.campaign.goal)}</span><b>{pct(data.campaign.total, data.campaign.goal)}%</b></div></>}
            </section>
          )}
        </aside>
      </main>
      {data.board.ticker && <footer className="bd-ticker"><div className="bd-marquee"><span>{data.board.ticker}</span><span aria-hidden="true">{data.board.ticker}</span></div></footer>}
    </div>
  );
}

// =====================================================================
// דף קמפיין גיוס המונים - שלנו, בלי פלטפורמה חיצונית
// =====================================================================
function Countdown({ end }) {
  const now = useClock();
  if (!end) return null;
  const ms = new Date(end) - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return <div className="cf-count ended">הקמפיין הסתיים</div>;
  const d = Math.floor(ms / 86400000); const h = Math.floor((ms / 3600000) % 24); const m = Math.floor((ms / 60000) % 60); const sec = Math.floor((ms / 1000) % 60);
  return (
    <div className="cf-count" aria-label="זמן שנותר">
      {[[d, 'ימים'], [h, 'שעות'], [m, 'דקות'], [sec, 'שניות']].map(([v, l]) => <div key={l}><b className="num">{String(v).padStart(2, '0')}</b><span>{l}</span></div>)}
    </div>
  );
}

function ytEmbed(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

export function CampaignPage({ slug, team }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api(`/public/campaign/${encodeURIComponent(slug)}`).then((d) => { setData(d); setErr(null); }).catch(setErr);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [slug]);
  useEffect(() => { if (data) document.title = data.campaign.headline; }, [data?.campaign?.headline]);
  const teamRow = useMemo(() => data?.teams.find((t) => t.slug === team) || null, [data, team]);
  if (err) return <div className="cf-wrap"><div className="cf-card empty">{err.message}</div></div>;
  if (!data) return <div className="cf-wrap"><Spinner /></div>;
  const { campaign: c, progress: p } = data;
  const share = `${window.location.origin}/c/${slug}${teamRow ? `/${teamRow.slug}` : ''}`;
  const video = ytEmbed(c.video_url);
  return (
    <div className="cf-wrap">
      <header className="cf-top">
        <a href="/" className="cf-org">{data.org?.logo_url && <img src={data.org.logo_url} alt="" />}<span>{data.org?.name}</span></a>
        <div className="row"><a className="btn sm" href={`https://wa.me/?text=${encodeURIComponent(`${c.headline}\n${share}`)}`} target="_blank" rel="noopener"><Icon name="chat" size={16} />שיתוף</a>
          <button className="btn sm" onClick={() => navigator.clipboard?.writeText(share).then(() => toast('הקישור הועתק', 'ok'))}><Icon name="link" size={16} />העתקה</button></div>
      </header>
      {data.sandbox && <div className="cf-sandbox">דף בהדמיה: תרומות כאן נרשמות לבדיקה בלבד ולא נגבה כסף</div>}
      <section className="cf-hero">
        <div className="cf-media">
          {video ? <iframe src={video} title={c.headline} allow="encrypted-media; picture-in-picture" allowFullScreen /> : c.image_url ? <img src={c.image_url} alt="" /> : <div className="cf-media-ph"><Icon name="megaphone" size={64} /></div>}
        </div>
        <div className="cf-card cf-stats">
          {teamRow && <div className="cf-team-badge"><Icon name="user" size={16} />דף השגריר: {teamRow.name}</div>}
          <h1>{c.headline}</h1>
          {p.matching > 1 && <div className="cf-match"><Icon name="sparkle" size={18} />כל תרומה מוכפלת פי {p.matching}{c.matching_text ? ` · ${c.matching_text}` : ''}</div>}
          <div className="cf-total num">₪{fmtNum(teamRow ? teamRow.total : p.total)}</div>
          {(teamRow ? teamRow.goal : p.goal) > 0 && <>
            <div className="cf-bar big"><i style={{ width: `${pct(teamRow ? teamRow.total : p.total, teamRow ? teamRow.goal : p.goal)}%` }} /></div>
            <div className="row between small"><span>{pct(teamRow ? teamRow.total : p.total, teamRow ? teamRow.goal : p.goal)}% מהיעד</span><span>יעד: ₪{fmtNum(teamRow ? teamRow.goal : p.goal)}</span></div>
          </>}
          <div className="cf-meta"><span><Icon name="donors" size={16} />{fmtNum(teamRow ? teamRow.donors : p.donors)} תורמים</span></div>
          <Countdown end={c.end_at} />
        </div>
      </section>
      <div className="cf-grid">
        <section className="cf-card">
          <DonateBox slug={slug} c={c} teams={data.teams} defaultTeam={teamRow?.id} matching={p.matching} onDone={load} />
        </section>
        <section className="cf-card">
          {c.description && <div className="cf-desc">{c.description}</div>}
          {data.teams.length > 0 && (
            <>
              <h3><Icon name="donors" />שגרירים וקבוצות</h3>
              <div className="cf-teams">
                {data.teams.map((t, i) => (
                  <a key={t.id} href={`/c/${slug}/${t.slug}`} className={`cf-team ${teamRow?.id === t.id ? 'on' : ''}`} onClick={(e) => { e.preventDefault(); navigate(`/c/${slug}/${t.slug}`); }}>
                    <span className="cf-rank num">{i + 1}</span>
                    <span className="cf-team-main"><b>{t.name}</b><span className="small muted num">₪{fmtNum(t.total)}{t.goal ? ` מתוך ₪${fmtNum(t.goal)}` : ''} · {t.donors} תורמים</span>{t.goal > 0 && <span className="cf-bar"><i style={{ width: `${pct(t.total, t.goal)}%` }} /></span>}</span>
                  </a>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
      {c.show_donors && data.recent.length > 0 && (
        <section className="cf-card">
          <h3><Icon name="heart" />תורמים אחרונים</h3>
          <div className="cf-feed">
            {data.recent.map((x) => (
              <div key={x.id} className="cf-don">
                <span className="cf-av">{x.name.slice(0, 1)}</span>
                <span className="cf-don-main"><b>{x.name}</b>{x.team && <span className="small muted"> · דרך {x.team}</span>}{x.message && <span className="cf-msg">{x.message}</span>}</span>
                <b className="num">₪{fmtNum(x.amount)}</b>
              </div>
            ))}
          </div>
        </section>
      )}
      <footer className="cf-foot">{data.org?.name} · תרומות מוכרות לצורכי מס לפי סעיף 46</footer>
    </div>
  );
}

function DonateBox({ slug, c, teams, defaultTeam, matching, onDone }) {
  const [f, setF] = useState({ amount: '', name: '', phone: '', email: '', anonymous: false, message: '', team_id: defaultTeam || '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => setF((x) => ({ ...x, team_id: defaultTeam || x.team_id })), [defaultTeam]);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  if (!c.active) return <div className="empty">הקמפיין אינו פעיל כרגע</div>;
  if (done) {
    return (
      <div className="cf-thanks">
        <div className="cf-thanks-ico"><Icon name="heart" size={34} /></div>
        <h2>תודה רבה!</h2>
        <p>{done.sandbox ? 'התרומה נרשמה בהדמיה (לא נגבה כסף).' : 'מעבירים אותך לדף התשלום המאובטח…'}</p>
        <button className="btn" onClick={() => setDone(null)}>תרומה נוספת</button>
      </div>
    );
  }
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api(`/public/campaign/${encodeURIComponent(slug)}/donate`, { method: 'POST', body: f });
      if (r.redirect) window.location.href = r.redirect;
      setDone(r); onDone();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const amt = Number(f.amount) || 0;
  return (
    <div className="stack">
      <h3><Icon name="shekel" />תרומה לקמפיין</h3>
      <div className="amount-chips">{c.amounts.map((v) => <button type="button" key={v} className={`chip-amt ${amt === v ? 'on' : ''}`} onClick={() => set('amount')(String(v))}>₪{fmtNum(v)}</button>)}</div>
      <input className="input num" type="number" inputMode="decimal" min="5" placeholder="סכום אחר (₪)" value={f.amount} onChange={set('amount')} />
      {amt > 0 && matching > 1 && <div className="cf-match small">התרומה שלך שווה לעמותה ₪{fmtNum(amt * matching)}</div>}
      <input className="input" placeholder="שם מלא *" value={f.name} onChange={set('name')} autoComplete="name" />
      <input className="input num" type="tel" placeholder="טלפון *" value={f.phone} onChange={set('phone')} autoComplete="tel" />
      <input className="input" type="email" placeholder="מייל (לקבלה)" value={f.email} onChange={set('email')} autoComplete="email" />
      {teams.length > 0 && <select className="input" value={f.team_id} onChange={set('team_id')}><option value="">דרך שגריר / קבוצה (לא חובה)</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
      <input className="input" placeholder="הקדשה או ברכה שתופיע בדף (לא חובה)" maxLength={200} value={f.message} onChange={set('message')} />
      <label className="check small"><input type="checkbox" checked={f.anonymous} onChange={set('anonymous')} />להציג אותי בעילום שם</label>
      <input type="text" name="website" value={f.website || ''} onChange={set('website')} style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
      <button className="btn gold cf-give" disabled={busy || amt < 5 || !f.name || !f.phone} onClick={submit}>{busy ? 'שולח…' : `תרמו ₪${amt ? fmtNum(amt) : ''}`}</button>
      <div className="small muted">קבלה לפי סעיף 46 תישלח לפי הפרטים שמילאתם.</div>
    </div>
  );
}

// =====================================================================
// ניהול במערכת
// =====================================================================
export function BoardsPage() {
  const { user } = React.useContext(AppCtx);
  const { data, reload } = useApi('/r/boards?size=100');
  const [edit, setEdit] = useState(null);
  const write = can(user, 'campaigns.write');
  const link = (b) => `${window.location.origin}/board/${b.slug}`;
  return (
    <div>
      <div className="page-head"><h1>לוחות מודעות</h1>
        <div className="row">{write && <Link className="btn" to="/app/r/board_items"><Icon name="note" size={16} />כל המודעות</Link>}{write && <button className="btn primary" onClick={() => setEdit({ res: 'boards' })}>+ לוח חדש</button>}</div></div>
      <p className="muted small">כל לוח הוא מסך מלא שפותחים בטלוויזיה או במחשב שמחובר למסך. זמני היום מחושבים לצפת, והמודעות מתחלפות לבד.</p>
      {!data ? <Spinner /> : (
        <div className="hub-grid">
          {data.rows.map((b) => (
            <div key={b.id} className="hub-card">
              <div className="hub-ico" style={{ background: '#16357a' }}><Icon name="tv" size={26} /></div>
              <div className="hub-main"><b>{b.name}</b><span className="small muted">{b.location || ''}{b.active ? '' : ' · לא פעיל'}</span><span className="small muted num" dir="ltr">/board/{b.slug}</span></div>
              <div className="hub-acts">
                <a className="btn sm primary" href={`/board/${b.slug}`} target="_blank" rel="noopener"><Icon name="eye" size={15} />פתיחת המסך</a>
                <button className="btn sm" onClick={() => navigator.clipboard?.writeText(link(b)).then(() => toast('הקישור הועתק', 'ok'))}><Icon name="link" size={15} />קישור</button>
                {write && <button className="btn sm" onClick={() => navigate(`/app/r/board_items?f_board_id=${b.id}`)}><Icon name="note" size={15} />מודעות</button>}
                {write && <button className="btn sm" onClick={() => setEdit({ res: 'boards', row: b })}><Icon name="pen" size={15} />הגדרות</button>}
              </div>
            </div>
          ))}
          {!data.rows.length && <div className="empty">עוד אין לוחות. לוחצים "+ לוח חדש".</div>}
        </div>
      )}
      {edit && <ResourceForm resKey={edit.res} row={edit.row} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

export function CrowdfundingPage() {
  const { user } = React.useContext(AppCtx);
  const { data, reload } = useApi('/r/campaigns?size=100');
  const [edit, setEdit] = useState(null);
  const write = can(user, 'campaigns.write');
  const rows = (data?.rows || []).slice().sort((a, b) => Number(b.public_page) - Number(a.public_page));
  return (
    <div>
      <div className="page-head"><h1>קמפיין גיוס המונים</h1>
        <div className="row">{write && <Link className="btn" to="/app/r/campaign_teams"><Icon name="donors" size={16} />שגרירים</Link>}{write && <button className="btn primary" onClick={() => setEdit({ row: { public_page: true, matching: 1, show_donors: true } })}>+ קמפיין חדש</button>}</div></div>
      <p className="muted small">דף קמפיין משלנו: יעד, מונה בזמן אמת, הכפלה, שגרירים עם דף אישי, רשימת תורמים וספירה לאחור. כדי לפתוח דף ציבורי מסמנים בקמפיין "דף קמפיין ציבורי פעיל" וממלאים כתובת באנגלית (בהגדרות המתקדמות של הטופס).</p>
      {!data ? <Spinner /> : (
        <div className="hub-grid">
          {rows.map((c) => {
            const raised = Number(c.raised || 0) + Number(c.base_raised || 0);
            const total = raised * Math.max(1, Number(c.matching) || 1);
            return (
              <div key={c.id} className="hub-card">
                <div className="hub-ico" style={{ background: c.public_page ? '#d9465f' : '#94a3b8' }}><Icon name="megaphone" size={26} /></div>
                <div className="hub-main">
                  <b>{c.name}</b>
                  <span className="small muted">{c.public_page && c.slug ? <span dir="ltr">/c/{c.slug}</span> : 'אין דף ציבורי'}{Number(c.matching) > 1 ? ` · הכפלה פי ${Number(c.matching)}` : ''}</span>
                  <span className="num"><b>{money(total)}</b>{c.goal ? <span className="small muted"> מתוך {money(c.goal)}</span> : null}</span>
                  {c.goal > 0 && <span className="cf-bar"><i style={{ width: `${pct(total, c.goal)}%` }} /></span>}
                </div>
                <div className="hub-acts">
                  {c.public_page && c.slug && <a className="btn sm primary" href={`/c/${c.slug}`} target="_blank" rel="noopener"><Icon name="eye" size={15} />הדף</a>}
                  {c.public_page && c.slug && <a className="btn sm" href={`https://wa.me/?text=${encodeURIComponent(`${window.location.origin}/c/${c.slug}`)}`} target="_blank" rel="noopener"><Icon name="chat" size={15} />שיתוף</a>}
                  {write && <button className="btn sm" onClick={() => navigate(`/app/r/campaign_teams?f_campaign_id=${c.id}`)}><Icon name="donors" size={15} />שגרירים</button>}
                  {write && <button className="btn sm" onClick={() => setEdit({ row: c })}><Icon name="pen" size={15} />עריכה</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {edit && <ResourceForm resKey="campaigns" row={edit.row?.id ? edit.row : null} preset={edit.row?.id ? {} : edit.row} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}
