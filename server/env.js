// מצב סביבה. לבקשת המזמין: כברירת מחדל הכל רץ במצב פיתוח/הדמיה גם כשהאתר מפורסם.
// מעבר לייצור אמיתי דורש במפורש APP_MODE=production וגם FORCE_SANDBOX=false.
export function appMode() {
  return process.env.APP_MODE === 'production' ? 'production' : 'development';
}

export function isSandbox() {
  if (process.env.FORCE_SANDBOX === 'false' && appMode() === 'production') return false;
  return true;
}

// באתר המפורסם Replit מגדיר REPLIT_DEPLOYMENT=1
export function isPublished() {
  return process.env.REPLIT_DEPLOYMENT === '1' || process.env.PUBLISHED_SITE === 'true';
}

export function envInfo() {
  return {
    mode: appMode(),
    sandbox: isSandbox(),
    published: isPublished(),
    // הפס הצהוב מוצג רק באתר הפיתוח
    show_banner: !isPublished(),
    label: isSandbox() ? 'סביבת פיתוח - כל החיבורים במצב הדמיה (Sandbox)' : 'סביבת ייצור',
  };
}
