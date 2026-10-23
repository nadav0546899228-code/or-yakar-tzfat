import React, { useState, useEffect } from 'react';
import { Link, useRoute, api, toast, Logo, Field, navigate, money, date, phoneHref, waHref } from './lib.jsx';

function Icon({ name, size = 20 }) {
  const p = {
    phone: 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z',
    mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm8 7L4.5 7v1.7L12 13.5l7.5-4.8V7z',
    pin: 'M12 2a7 7 0 0 1 7 7c0 5.2-7 13-7 13S5 14.2 5 9a7 7 0 0 1 7-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    wa: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.6 2.1 1.1 1 2.1 1.3 2.4 1.4.3.2.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l2 .9c.3.2.5.2.6.4.1.1.1.8-.1 1.5z',
    fax: 'M6 3h9l3 3v4H6zm-2 8h16a1 1 0 0 1 1 1v6h-3v3H6v-3H3v-6a1 1 0 0 1 1-1zm4 5v3h8v-3z',
    menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
  }[name];
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={p} /></svg>;
}

function Header({ site, org }) {
  const [open, setOpen] = useState(false);
  const { path } = useRoute();
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="site-header">
      <div className="inner">
        <Link to="/" className="site-logo" aria-label={org.name}><Logo src={org.logo_url} alt={org.name} /></Link>
        <nav className={`site-nav ${open ? 'open' : ''}`}>
          {site.nav.map((n) => <Link key={n.path} to={n.path}>{n.label}</Link>)}
        </nav>
        <a className="btn gold hide-sm" href={org.donation_url} target="_blank" rel="noopener">תרומה לקהילה</a>
        <button className="btn ghost burger" onClick={() => setOpen(!open)} aria-label="תפריט"><Icon name="menu" /></button>
      </div>
    </header>
  );
}

function Footer({ org, site }) {
  return (
    <footer className="site-footer">
      <div className="inner">
        <div className="stack">
          <span className="logo-box"><Logo src={org.logo_url} alt={org.name} /></span>
          <h4>{org.short_name}</h4>
          <p>בואו לקחת חלק במפעל הקדוש</p>
          <a className="btn gold" href={org.donation_url} target="_blank" rel="noopener">לחצו לתרומה והשתתפו במצווה</a>
        </div>
        <div>
          <h4>יצירת קשר</h4>
          <div className="stack small">
            <div>טל׳ במשרדים: {org.phones.map((p, i) => <span key={p}>{i ? ' / ' : ''}<a href={phoneHref(p)}>{p}</a></span>)}</div>
            {org.fax && <div>פקס: {org.fax}</div>}
            <div>מייל: <a href={`mailto:${org.email}`}>{org.email}</a></div>
            <div>וואטסאפ: <a href={waHref(org.whatsapp)} target="_blank" rel="noopener">{org.whatsapp.replace(/^(\d{3})(\d+)/, '$1-$2')}</a></div>
            <div>{org.po_box}, {org.address}</div>
          </div>
        </div>
        <div>
          <h4>ניווט</h4>
          <div className="stack small">
            {site.nav.map((n) => <div key={n.path}><Link to={n.path}>{n.label}</Link></div>)}
            <div><Link to="/terms">תקנון האתר</Link></div>
            <div><Link to="/my">אזור תורם - הקבלות והתרומות שלי</Link></div>
            <div><Link to="/login">כניסת צוות</Link></div>
          </div>
        </div>
      </div>
      <div className="bottom">כל הזכויות שמורות ל{org.legal_name} © {new Date().getFullYear()}</div>
    </footer>
  );
}

function Section({ s }) {
  if (s.quote) {
    return <div className="quote"><blockquote>״{s.quote}״{s.cite && <cite>({s.cite})</cite>}</blockquote></div>;
  }
  const body = (
    <div>
      {s.heading && <h2>{s.heading}</h2>}
      {s.sub && <div className="sub">{s.sub}</div>}
      {s.text && s.text.split('\n').map((t, i) => <p key={i}>{t}</p>)}
      {s.cards && <div className="cards3">{s.cards.map((c) => <div className="feature" key={c.title}><h3>{c.title}</h3><p style={{ fontSize: 16 }}>{c.text}</p></div>)}</div>}
      {s.chips && <div className="chips">{s.chips.map((c) => <span key={c}>{c}</span>)}</div>}
      {s.facts && <div className="facts">{s.facts.map(([k, v]) => <div key={k}><b>{k}</b>{v}</div>)}</div>}
      {s.options && (
        <div className="donate-options">
          {s.options.map((o) => (
            <div className="donate-opt" key={o.title}>
              <h3>{o.title}</h3>
              {o.amount && <div className="amount">{o.amount}</div>}
              <div className="muted">{o.text}</div>
              {o.url?.startsWith('/') ? <Link className="btn primary" to={o.url}>להשתתפות</Link> : <a className="btn primary" href={o.url} target="_blank" rel="noopener">להשתתפות</a>}
            </div>
          ))}
        </div>
      )}
      {s.audio && <div className="audio-list">{s.audio.map((a) => <div className="audio-item" key={a.url}><b>{a.title}</b><audio controls preload="none" src={a.url} /></div>)}</div>}
      {s.videos && s.videos.length > 0 && <div className="gallery">{s.videos.map((v) => <iframe key={v} src={v} title="שיעור" style={{ width: '100%', aspectRatio: '16/9', border: 0, borderRadius: 12 }} allowFullScreen />)}</div>}
      {s.gallery && !s.image && <div className="gallery" style={{ marginTop: 12 }}>{s.gallery.map((g) => <img key={g} src={g} alt={s.heading || ''} loading="lazy" />)}</div>}
      {s.link && <div style={{ marginTop: 14 }}><Link className="btn primary" to={s.link.path}>{s.link.label}</Link></div>}
    </div>
  );
  if (s.image) {
    return <section className="section split">{body}<img src={s.image} alt={s.heading || ''} loading="lazy" /></section>;
  }
  return <section className="section">{body}</section>;
}

function CtaBand({ org }) {
  return (
    <div className="cta-band">
      <div className="inner">
        <div><h2>{org.short_name}</h2><div style={{ opacity: 0.9 }}>בואו לקחת חלק במפעל הקדוש</div></div>
        <div className="row">
          <a className="btn gold" href={org.donation_url} target="_blank" rel="noopener">לחצו לתרומה והשתתפו במצווה</a>
          <a className="btn" href={phoneHref(org.phones[0])}>{org.phones[0]}</a>
        </div>
      </div>
    </div>
  );
}

function ContactPage({ org }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', subject: '', message: '', website: '' });
  const [sent, setSent] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    try { await api('/public/contact', { method: 'POST', body: f }); setSent(true); } catch (err) { toast(err.message, 'error'); }
  };
  const mapQ = encodeURIComponent(`${org.address}`);
  return (
    <section className="section">
      <div className="contact-grid">
        <div>
          <h2>צרו איתנו קשר בכל נושא</h2>
          {org.phones.map((p) => <a key={p} className="contact-line" href={phoneHref(p)}><span className="ic"><Icon name="phone" /></span><div><b>טלפון במשרדים</b><div className="num">{p}</div></div></a>)}
          {org.fax && <div className="contact-line"><span className="ic"><Icon name="fax" /></span><div><b>פקס</b><div className="num">{org.fax}</div></div></div>}
          <a className="contact-line" href={`mailto:${org.email}`}><span className="ic"><Icon name="mail" /></span><div><b>מייל</b><div>{org.email}</div></div></a>
          <a className="contact-line" href={waHref(org.whatsapp)} target="_blank" rel="noopener"><span className="ic"><Icon name="wa" /></span><div><b>וואטסאפ בלבד</b><div className="num">{org.whatsapp.replace(/^(\d{3})(\d+)/, '$1-$2')}</div></div></a>
          <a className="contact-line" href={`https://waze.com/ul?q=${mapQ}`} target="_blank" rel="noopener"><span className="ic"><Icon name="pin" /></span><div><b>כתובת</b><div>{org.address} · {org.po_box}</div></div></a>
          <iframe className="map-frame" title="מפה" loading="lazy" src={`https://maps.google.com/maps?q=${mapQ}&z=16&output=embed`} />
        </div>
        <div className="card">
          {sent ? <div className="notice">תודה! פנייתכם התקבלה ונחזור אליכם בהקדם.</div> : (
            <form onSubmit={submit} className="stack">
              <h3>השאירו פרטים ונחזור אליכם</h3>
              <Field label="שם מלא"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="טלפון"><input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
              <Field label="מייל"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              <Field label="נושא">
                <select className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })}>
                  <option value="">כללי</option><option>הצטרפות לישיבה / לכולל</option><option>מדרשה לבנות</option><option>תרומה וקבלות</option><option>סיוע</option><option>אחוזת קורדוברו</option><option>שיעורים</option>
                </select>
              </Field>
              <Field label="הודעה"><textarea className="input" required value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
              <input className="hidden" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
              <button className="btn primary">שליחה</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

// רישום שמות למבצעים רוחניים מהאתר
function NerPage({ org }) {
  const { query } = useRoute();
  const [f, setF] = useState({ kind: query.kind || 'prayer', name_for: '', mother_name: '', request: '', contact_name: '', contact_phone: '', website: '' });
  const [done, setDone] = useState(null);
  const kinds = { prayer: 'תפילה בקבר האר"י הקדוש', memorial: 'אזכרה ולימוד לעילוי נשמה', parnas: 'פרנס יום', pidyon: 'פדיון נפש', tikun: 'תיקון נפטרים', kaddish: 'קדיש' };
  const submit = async (e) => {
    e.preventDefault();
    try { const r = await api('/public/spiritual', { method: 'POST', body: f }); setDone(r); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <section className="section">
      <div className="card" style={{ maxWidth: 640, margin: '0 auto' }}>
        {done ? (
          <div className="stack">
            <div className="notice">השם נרשם בהצלחה. להשלמת ההשתתפות ניתן לתרום עכשיו:</div>
            <a className="btn gold" href={done.donation_url} target="_blank" rel="noopener">מעבר לתרומה מאובטחת</a>
          </div>
        ) : (
          <form className="form-grid" onSubmit={submit}>
            <Field label="סוג" full>
              <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </Field>
            <Field label={f.kind === 'memorial' || f.kind === 'tikun' || f.kind === 'kaddish' ? 'שם הנפטר/ת' : 'שם (פלוני/ת)'}><input className="input" required value={f.name_for} onChange={(e) => setF({ ...f, name_for: e.target.value })} /></Field>
            <Field label={f.kind === 'memorial' || f.kind === 'tikun' || f.kind === 'kaddish' ? 'בן/בת (שם האב)' : 'בן/בת (שם האם)'}><input className="input" value={f.mother_name} onChange={(e) => setF({ ...f, mother_name: e.target.value })} /></Field>
            <Field label="בקשה (רפואה, זיווג, פרנסה…)" full><input className="input" value={f.request} onChange={(e) => setF({ ...f, request: e.target.value })} /></Field>
            <Field label="שם המבקש"><input className="input" value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
            <Field label="טלפון"><input className="input" required type="tel" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
            <input className="hidden" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
            <div className="full"><button className="btn primary">רישום והמשך לתרומה</button></div>
          </form>
        )}
      </div>
    </section>
  );
}

// אזור אישי לתורם: כניסה בקוד חד-פעמי
function DonorArea() {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [hint, setHint] = useState('');
  const [data, setData] = useState(null);
  const load = () => api('/donor/me').then((d) => { setData(d); setStep('in'); }).catch(() => {});
  useEffect(() => { load(); }, []);
  if (step === 'in' && data) {
    return (
      <section className="section stack">
        <div className="row between"><h2>שלום {data.donor.name}</h2><button className="btn" onClick={async () => { await api('/auth/logout', { method: 'POST' }); setData(null); setStep('phone'); }}>יציאה</button></div>
        <div className="card"><h3>הקבלות שלי</h3>
          <div className="table-wrap"><table className="t"><thead><tr><th>מספר</th><th>תאריך</th><th>סכום</th><th>דיווח לרשות המסים</th><th /></tr></thead><tbody>
            {data.documents.map((d) => <tr key={d.id}><td>{d.number}</td><td>{date(d.issued_at)}</td><td>{money(d.amount, d.currency)}</td><td>{d.tax_report_number || '-'}</td><td>{d.pdf_url && <a href={d.pdf_url} target="_blank" rel="noopener">הורדה</a>}</td></tr>)}
            {!data.documents.length && <tr><td colSpan={5} className="empty">אין קבלות</td></tr>}
          </tbody></table></div>
        </div>
        <div className="card"><h3>הוראות קבע</h3>
          {data.keva.map((k) => <div key={k.id} className="row between" style={{ padding: '6px 0' }}><span>{money(k.amount, k.currency)} לחודש · {k.type === 'bank' ? 'בנקאית' : `אשראי ${k.card_last4 ? `****${k.card_last4}` : ''}`}</span>
            <button className="btn sm" onClick={() => api('/donor/request', { method: 'POST', body: { kind: 'card', message: `עדכון פרטי תשלום להו"ק ${k.id}` } }).then(() => toast('הבקשה נשלחה, נחזור אליך', 'ok'))}>בקשה לעדכון כרטיס</button></div>)}
          {!data.keva.length && <div className="muted">אין הוראות קבע פעילות</div>}
        </div>
        <div className="card"><h3>התרומות שלי</h3>
          <div className="table-wrap"><table className="t"><thead><tr><th>תאריך</th><th>סכום</th><th>אמצעי</th></tr></thead><tbody>
            {data.transactions.map((t) => <tr key={t.id}><td>{date(t.date)}</td><td>{money(t.amount, t.currency)}</td><td>{t.method}</td></tr>)}
          </tbody></table></div>
        </div>
      </section>
    );
  }
  return (
    <section className="section">
      <div className="card" style={{ maxWidth: 420, margin: '0 auto' }}>
        <h3>כניסה לאזור התורם</h3>
        <p className="muted small">צפייה בקבלות, בתרומות ובהוראות הקבע. נשלח אליכם קוד חד-פעמי.</p>
        {step === 'phone' ? (
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { const r = await api('/donor/otp', { method: 'POST', body: { phone } }); setHint(r.sandbox_code ? `סביבת פיתוח - הקוד: ${r.sandbox_code}` : 'אם המספר רשום אצלנו, נשלח אליו קוד'); setStep('code'); } catch (err) { toast(err.message, 'error'); } }}>
            <Field label="טלפון"><input className="input" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <button className="btn primary">שליחת קוד</button>
          </form>
        ) : (
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await api('/donor/login', { method: 'POST', body: { phone, code } }); load(); } catch (err) { toast(err.message, 'error'); } }}>
            {hint && <div className="notice small">{hint}</div>}
            <Field label="קוד"><input className="input" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <button className="btn primary">כניסה</button>
            <button type="button" className="btn ghost" onClick={() => setStep('phone')}>חזרה</button>
          </form>
        )}
      </div>
    </section>
  );
}

export function PublicSite({ data }) {
  const { path } = useRoute();
  const { org, site, env } = data;
  const key = path === '/' ? 'home' : path.slice(1).split('/')[0];
  const page = site.pages[key];
  useEffect(() => {
    document.title = page ? (key === 'home' ? `${org.name}` : `${page.title} - ${org.short_name}`) : org.name;
  }, [key]);
  let content;
  if (key === 'home') {
    content = (
      <>
        <div className="hero"><div className="inner">
          <div className="kicker">{page.kicker}</div>
          <h1>{page.title}</h1>
          <div className="quick">{site.nav.slice(0, 4).map((n) => <Link key={n.path} to={n.path}>{n.label.replace(' שליט"א', '')}</Link>)}</div>
        </div></div>
        {page.sections.map((s, i) => <Section key={i} s={s} />)}
      </>
    );
  } else if (key === 'my') {
    content = <><div className="page-hero"><div className="inner"><h1>אזור התורם</h1></div></div><DonorArea /></>;
  } else if (key === 'ner') {
    content = <><div className="page-hero"><div className="inner"><h1>רישום שמות לתפילה והנצחה</h1><div className="kicker">תפילה בקבר האר"י הקדוש, אזכרות ולימוד לעילוי נשמה</div></div></div><NerPage org={org} /></>;
  } else if (page) {
    content = (
      <>
        <div className="page-hero"><div className="inner"><h1>{page.title}</h1>{page.kicker && <div className="kicker">{page.kicker}</div>}
          {key === 'ahuza' && page.phone && <div className="row" style={{ marginTop: 14 }}><a className="btn gold" href={phoneHref(page.phone)}>להזמנה חייגו {page.phone}</a><a className="btn" href={waHref(page.phone)} target="_blank" rel="noopener">וואטסאפ</a></div>}
        </div></div>
        {key === 'contact' ? <ContactPage org={org} /> : page.sections.map((s, i) => <Section key={i} s={s} />)}
      </>
    );
  } else {
    content = <section className="section"><h2>העמוד לא נמצא</h2><Link className="btn primary" to="/">לדף הבית</Link></section>;
  }
  return (
    <>
      {env?.sandbox && <div className="env-bar">{env.label}</div>}
      <Header site={site} org={org} />
      <main>{content}</main>
      {key !== 'contact' && <CtaBand org={org} />}
      <Footer org={org} site={site} />
      <a className="wa-float" href={waHref(org.whatsapp)} target="_blank" rel="noopener" aria-label="וואטסאפ"><Icon name="wa" size={30} /></a>
    </>
  );
}
