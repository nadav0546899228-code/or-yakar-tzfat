// חישוב זמני היום לפי מיקום (ברירת מחדל: צפת), באלגוריתם השמש המקובל (NOAA). בלי שירות חיצוני.
// הזמנים מחושבים לפי שעות זמניות של הגר"א. הדלקת נרות: 30 דקות לפני השקיעה (מנהג צפת)
const TZ = 'Asia/Jerusalem';
export const TZFAT = { lat: 32.9646, lon: 35.496, elevation: 0 };

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// מחזיר זמן UTC (Date) שבו השמש בגובה depression מעלות מתחת לאופק, בבוקר או בערב
function sunTime(date, { lat, lon }, depression, morning) {
  const y = date.getUTCFullYear(); const m = date.getUTCMonth() + 1; const d = date.getUTCDate();
  const jd = 367 * y - Math.floor((7 * (y + Math.floor((m + 9) / 12))) / 4) + Math.floor((275 * m) / 9) + d + 1721013.5;
  let t = (jd - 2451545.0) / 36525 + (morning ? 0.25 : 0.75) / 36525 - lon / 360 / 36525;
  let utcMin = 0;
  for (let i = 0; i < 3; i += 1) {
    const L0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
    const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const C = Math.sin(rad(M)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * M)) * 0.000289;
    const trueLong = L0 + C;
    const omega = 125.04 - 1934.136 * t;
    const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
    const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(rad(omega));
    const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
    const yv = Math.tan(rad(eps / 2)) ** 2;
    const eqTime = 4 * deg(yv * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * yv * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * yv * yv * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
    const zenith = 90 + depression;
    const cosH = (Math.cos(rad(zenith)) - Math.sin(rad(lat)) * Math.sin(rad(decl))) / (Math.cos(rad(lat)) * Math.cos(rad(decl)));
    if (cosH > 1 || cosH < -1) return null;
    const ha = deg(Math.acos(cosH)) * (morning ? 1 : -1);
    utcMin = 720 - 4 * (lon + ha) - eqTime;
    t = (jd - 2451545.0) / 36525 + utcMin / 1440 / 36525;
  }
  return new Date(Date.UTC(y, m - 1, d) + utcMin * 60000);
}

const fmt = (dt) => (dt ? dt.toLocaleTimeString('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const add = (dt, min) => (dt ? new Date(dt.getTime() + min * 60000) : null);

// date: תאריך מקומי (YYYY-MM-DD או Date). מחזיר את זמני היום כמחרוזות HH:MM
export function zmanim(date = new Date(), place = TZFAT) {
  const local = typeof date === 'string' ? date : new Date(date).toLocaleDateString('en-CA', { timeZone: TZ });
  const [Y, M, D] = local.split('-').map(Number);
  const base = new Date(Date.UTC(Y, M - 1, D, 12));
  const sunrise = sunTime(base, place, 0.833, true);
  const sunset = sunTime(base, place, 0.833, false);
  const alot = sunTime(base, place, 16.1, true);
  const misheyakir = sunTime(base, place, 11.5, true);
  const tzeit = sunTime(base, place, 8.5, false);
  const hour = sunrise && sunset ? (sunset - sunrise) / 12 / 60000 : 60;
  const weekday = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
  const out = {
    date: local,
    alot: fmt(alot),
    misheyakir: fmt(misheyakir),
    sunrise: fmt(sunrise),
    shema: fmt(add(sunrise, hour * 3)),
    tefila: fmt(add(sunrise, hour * 4)),
    chatzot: fmt(add(sunrise, hour * 6)),
    mincha_gedola: fmt(add(sunrise, hour * 6.5)),
    plag: fmt(add(sunrise, hour * 10.75)),
    sunset: fmt(sunset),
    tzeit: fmt(tzeit),
  };
  if (weekday === 5) out.candles = fmt(add(sunset, -30));
  if (weekday === 6) out.havdala = fmt(tzeit);
  return out;
}

export const ZMAN_LABELS = [
  ['alot', 'עלות השחר'], ['misheyakir', 'זמן טלית ותפילין'], ['sunrise', 'הנץ החמה'], ['shema', 'סוף זמן ק"ש (גר"א)'],
  ['tefila', 'סוף זמן תפילה (גר"א)'], ['chatzot', 'חצות היום'], ['mincha_gedola', 'מנחה גדולה'], ['plag', 'פלג המנחה'],
  ['sunset', 'שקיעה'], ['tzeit', 'צאת הכוכבים'], ['candles', 'הדלקת נרות'], ['havdala', 'צאת השבת'],
];
