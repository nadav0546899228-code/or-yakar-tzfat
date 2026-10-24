import React, { useEffect, useState } from 'react';
import { Modal, navigate } from './lib.jsx';

// לכידת אירוע ההתקנה של הדפדפן (אנדרואיד / כרום במחשב) כבר בטעינת הדף
let deferredPrompt = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; listeners.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; listeners.forEach((f) => f()); });
}

export function isStandalone() {
  try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch { return false; }
}

export function platform() {
  const ua = navigator.userAgent || '';
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)|GSA\//i.test(ua);
  if (/iPhone|iPad|iPod/i.test(ua)) return { os: 'ios', inApp, safari: /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua) };
  if (/Android/i.test(ua)) return { os: 'android', inApp };
  return { os: 'desktop', inApp: false };
}

function useInstallable() {
  const [, setT] = useState(0);
  useEffect(() => { const f = () => setT((x) => x + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  return deferredPrompt;
}

function InstallSteps() {
  const p = platform();
  const prompt = useInstallable();
  const [done, setDone] = useState(false);
  if (isStandalone()) return <div className="tag ok">האפליקציה כבר מותקנת ופתוחה במכשיר הזה</div>;
  if (done) return <div className="tag ok">ההתקנה התחילה. הסמל יופיע במסך הבית</div>;
  if (prompt) {
    return (
      <div>
        <p>לחיצה אחת והאפליקציה תופיע במסך הבית, עם סמל אור יקר.</p>
        <button className="btn primary" onClick={async () => { prompt.prompt(); const r = await prompt.userChoice.catch(() => null); if (r?.outcome === 'accepted') setDone(true); }}>התקנת האפליקציה</button>
      </div>
    );
  }
  if (p.inApp) {
    return (
      <ol className="steps-list">
        <li>הקישור נפתח בתוך אפליקציה אחרת (למשל וואטסאפ או ג'ימייל), ומשם אי אפשר להתקין.</li>
        <li>לוחצים על שלוש הנקודות או על סמל השיתוף, ובוחרים <b>פתיחה בדפדפן</b> ({p.os === 'ios' ? 'Safari' : 'Chrome'}).</li>
        <li>נכנסים שוב למערכת, וחלון ההתקנה יופיע.</li>
      </ol>
    );
  }
  if (p.os === 'ios') {
    return (
      <ol className="steps-list">
        {!p.safari && <li>באייפון אפשר להתקין רק מ-<b>Safari</b>. יש להעתיק את הכתובת ולפתוח אותה ב-Safari.</li>}
        <li>לוחצים על כפתור <b>השיתוף</b> (ריבוע עם חץ למעלה) בתחתית המסך.</li>
        <li>גוללים ובוחרים <b>הוספה למסך הבית</b>.</li>
        <li>לוחצים <b>הוסף</b>. הסמל של אור יקר יופיע במסך הבית.</li>
      </ol>
    );
  }
  if (p.os === 'android') {
    return (
      <ol className="steps-list">
        <li>לוחצים על <b>שלוש הנקודות</b> בפינה העליונה של Chrome.</li>
        <li>בוחרים <b>התקנת אפליקציה</b> או <b>הוספה למסך הבית</b>.</li>
        <li>מאשרים. הסמל של אור יקר יופיע במסך הבית.</li>
      </ol>
    );
  }
  return (
    <ol className="steps-list">
      <li>בדפדפן Chrome או Edge, לוחצים על סמל ההתקנה בשורת הכתובת (מסך עם חץ), או על שלוש הנקודות ואז <b>התקנה</b>.</li>
      <li>מאשרים. המערכת תיפתח בחלון משלה ותופיע בתפריט ההתחלה.</li>
    </ol>
  );
}

// הצעת התקנה בכניסה הראשונה של איש צוות (פעם אחת לכל משתמש במכשיר)
export function InstallPrompt({ user }) {
  const key = `oy_install_seen_${user.id}`;
  const [open, setOpen] = useState(() => {
    if (isStandalone()) return false;
    try { return !localStorage.getItem(key); } catch { return false; }
  });
  if (!open) return null;
  const close = () => { try { localStorage.setItem(key, String(Date.now())); } catch { /* */ } setOpen(false); };
  return (
    <Modal title="ברוכים הבאים למערכת אור יקר" onClose={close} size="narrow" footer={<><button className="btn" onClick={() => { close(); navigate('/app/help'); }}>למדריך השימוש</button><button className="btn primary" onClick={close}>סגירה</button></>}>
      <p>מומלץ להתקין את המערכת כאפליקציה בטלפון. כך היא נפתחת במסך מלא, בלחיצה אחת ממסך הבית, ומתעדכנת לבד.</p>
      <InstallSteps />
      <p className="small muted" style={{ marginTop: 12 }}>אפשר לחזור לזה בכל רגע מהתפריט: <b>מדריך שימוש</b>.</p>
    </Modal>
  );
}

const SECTIONS = [
  ['כניסה למערכת', [
    'נכנסים בכתובת המערכת ולוחצים "כניסה עם Google", או מזינים טלפון וקוד אישי.',
    'בכניסה הראשונה עם קוד זמני, המערכת מבקשת לבחור קוד אישי חדש.',
    'אחרי 5 ניסיונות שגויים החשבון ננעל ל-15 דקות. אם הוא ננעל שוב ושוב, צריך לפנות למנהל לשחרור.',
    'יציאה מהמערכת: כפתור "יציאה" בפינה העליונה.',
  ]],
  ['מעבר בין תצוגות', [
    'למי שיש כמה תפקידים, מופיעה בראש המסך רשימה "תצוגת ...". בוחרים תפקיד, והמערכת מציגה בדיוק את מה שהתפקיד הזה רואה.',
    'ההרשאות מתחלפות באמת: בתצוגת מזכירה, למשל, אין גישה לניהול משתמשים.',
  ]],
  ['לוח הבקרה', [
    'המסך הראשון אחרי הכניסה. מציג את התרומות היום, החודש ומתחילת השנה, הוראות קבע פעילות, חיובים שנכשלו וקבלות שחסרות.',
    'לחיצה על כרטיס מובילה ישר למסך המתאים.',
  ]],
  ['תורמים', [
    'בתפריט "תורמים" מחפשים לפי שם, טלפון או עיר. לחיצה על תורם פותחת את הכרטיס המלא שלו.',
    'בכרטיס התורם: פרטים, משפחה, כל התרומות מכל המקורות, הוראות קבע, קבלות, שיחות ומשימות.',
    'הוספת תורם: כפתור "+" במסך התורמים. אם התורם כבר קיים, המערכת מתריעה ומפנה לכרטיס הקיים.',
    'ייבוא רשימה: כפתור "ייבוא CSV". קובץ אקסל שומרים קודם בפורמט CSV.',
  ]],
  ['תרומות וקבלות', [
    '"יומן תנועות מאוחד" מרכז את כל התרומות מכל הספקים. העמודה "מקור" מראה מאיפה הגיעה כל תרומה.',
    'לחיצה על תרומה מאפשרת להפיק קבלה, לבטל, לרשום החזר או לשייך לתורם ולמוסד.',
    'ביטול קבלה נעשה בהפקת קבלה נגדית, ולא במחיקה.',
    'תרומה במזומן או בשיק נרשמת ידנית מאותו מסך.',
  ]],
  ['הוראות קבע ומס"ב', [
    'במסך "הוראות קבע" רואים את כל ההוראות, הסכום החודשי ומצב החיובים.',
    'חיוב שנכשל מסומן, ונוצרת משימה לחזור לתורם.',
    'במסך "מס"ב והחזרות" מכינים קובץ חיובים לבנק ועוקבים אחרי החזרות.',
  ]],
  ['זיכויי חברות אשראי', [
    'מורידים מאתר ישראכרט, כאל או מקס את דוח הזיכויים (קובץ CSV).',
    'במסך "זיכויי חברות אשראי" לוחצים "ייבוא דוח" ובוחרים את הקובץ.',
    'המערכת מתאימה לבד כל שורה לתרומה. שורות בלי התאמה ברורה מוצגות לבדיקה ידנית.',
  ]],
  ['מוקד ואפליקציית שטח', [
    'נציג מוקד רואה את רשימת השיחות שלו, ומתעד בכל שיחה את התוצאה ואת המשך הטיפול.',
    'מגייס בשטח פותח את "אפליקציית שטח" ורושם תורם חדש או תרומה ישר מהטלפון.',
  ]],
  ['עדכוני גרסה', [
    'כשיוצאת גרסה חדשה מופיעה הודעה "יש גרסה חדשה של המערכת". לוחצים "עדכון עכשיו", והמערכת נטענת מחדש בגרסה החדשה.',
    'כדאי לסיים קודם שמירה של טופס פתוח, ורק אחר כך לעדכן.',
  ]],
  ['אתר הפיתוח והאתר המפורסם', [
    'אתר הפיתוח מיועד לבדיקות בלבד. מופיע בו פס צהוב למעלה, ובסמל האפליקציה כתוב "אתר פיתוח".',
    'העבודה השוטפת נעשית באתר המפורסם בלבד.',
    'כרגע כל החיבורים לספקים במצב ניסיון: לא נגבה כסף, לא מופקת קבלה רשמית ולא נשלחת הודעה אמיתית לתורם.',
  ]],
];

export function HelpPage() {
  return (
    <div>
      <div className="page-head"><h1>מדריך שימוש</h1></div>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>התקנת האפליקציה במכשיר הזה</h3>
        <InstallSteps />
      </div>
      {SECTIONS.map(([title, items]) => (
        <div className="card" key={title} style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>{title}</h3>
          <ul className="steps-list">{items.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      ))}
      <p className="small muted">יש שאלה או תקלה? פונים למנהל המערכת.</p>
    </div>
  );
}
