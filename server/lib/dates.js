// תאריכים לפי שעון ישראל. השרת ב-Replit רץ ב-UTC, ולכן new Date().toISOString() מחזיר
// את התאריך של אתמול בין חצות לשתיים-שלוש בלילה - בדיוק בשעות שבהן נכנסות תרומות לילה.
const TZ = 'Asia/Jerusalem';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD של היום (או של רגע נתון) בישראל */
export function israelDay(at = new Date()) { return dayFmt.format(at); }

/** YYYY-MM של החודש הנוכחי בישראל */
export function israelMonth(at = new Date()) { return israelDay(at).slice(0, 7); }

/** השעה (0-23) בישראל */
export function israelHour(at = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(at));
}

/** יום בחודש (1-31) בישראל */
export function israelDayOfMonth(at = new Date()) { return Number(israelDay(at).slice(8, 10)); }
