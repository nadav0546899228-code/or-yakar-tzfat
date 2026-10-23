// תאריכים עבריים באמצעות ICU המובנה ב-Node (ללא ספריות חיצוניות)
const fmt = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' });
const fmtHe = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', timeZone: 'Asia/Jerusalem' });

// שמות החודשים כפי ש-ICU מחזיר באנגלית -> מפתח פנימי ושם עברי
export const HEB_MONTHS = [
  { key: 'Tishri', he: 'תשרי' },
  { key: 'Heshvan', he: 'חשוון' },
  { key: 'Kislev', he: 'כסלו' },
  { key: 'Tevet', he: 'טבת' },
  { key: 'Shevat', he: 'שבט' },
  { key: 'Adar', he: 'אדר' },
  { key: 'Adar I', he: 'אדר א׳' },
  { key: 'Adar II', he: 'אדר ב׳' },
  { key: 'Nisan', he: 'ניסן' },
  { key: 'Iyar', he: 'אייר' },
  { key: 'Sivan', he: 'סיוון' },
  { key: 'Tamuz', he: 'תמוז' },
  { key: 'Av', he: 'אב' },
  { key: 'Elul', he: 'אלול' },
];

const LETTERS = [
  [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'],
  [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'],
  [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א'],
];

export function gematria(n) {
  let num = n % 1000;
  let s = '';
  for (const [v, l] of LETTERS) {
    while (num >= v) {
      if (num === 15) { s += 'טו'; num = 0; break; }
      if (num === 16) { s += 'טז'; num = 0; break; }
      s += l;
      num -= v;
    }
  }
  if (s.length === 1) return `${s}׳`;
  return `${s.slice(0, -1)}"${s.slice(-1)}`;
}

export function toHebrew(date) {
  const d = date instanceof Date ? date : new Date(`${date}T12:00:00`);
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const day = parseInt(parts.day, 10);
  const year = parseInt(parts.year, 10);
  const monthKey = parts.month;
  const m = HEB_MONTHS.find((x) => x.key === monthKey);
  return {
    day,
    month: monthKey,
    monthHe: m ? m.he : monthKey,
    year,
    text: `${gematria(day)} ${m ? m.he : monthKey} ${gematria(year)}`,
    short: fmtHe.format(d),
  };
}

function isLeapHebrewYear(year) {
  return ((7 * year + 1) % 19) < 7;
}

// מחזיר את התאריך הלועזי הקרוב (מהיום והלאה) שבו חל יום ומחודש עבריים נתונים
export function nextOccurrence(hebDay, hebMonth, from = new Date()) {
  const start = new Date(from);
  start.setHours(12, 0, 0, 0);
  for (let i = 0; i < 400; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const h = toHebrew(d);
    let month = hebMonth;
    // אדר בשנה מעוברת -> אדר ב׳ (כמנהג יארצייט רווח); אדר א׳/ב׳ בשנה פשוטה -> אדר
    if (month === 'Adar' && isLeapHebrewYear(h.year)) month = 'Adar II';
    if ((month === 'Adar I' || month === 'Adar II') && !isLeapHebrewYear(h.year)) month = 'Adar';
    if (h.month === month && h.day === Number(hebDay)) return d;
    // ל׳ בחודש שאין בו ל׳ -> כ״ט
    if (Number(hebDay) === 30 && h.month === month && h.day === 29) {
      const next = toHebrew(new Date(d.getTime() + 86400000));
      if (next.month !== month) return d;
    }
  }
  return null;
}

export function isoDate(d) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
