// מצב סביבה. לבקשת המזמין: כברירת מחדל הכל רץ במצב פיתוח/הדמיה גם כשהאתר מפורסם.
// מעבר לייצור אמיתי דורש במפורש APP_MODE=production וגם FORCE_SANDBOX=false.
export function appMode() {
  return process.env.APP_MODE === 'production' ? 'production' : 'development';
}

export function isSandbox() {
  if (process.env.FORCE_SANDBOX === 'false' && appMode() === 'production') return false;
  return true;
}

export function envInfo() {
  return {
    mode: appMode(),
    sandbox: isSandbox(),
    label: isSandbox() ? 'סביבת פיתוח - כל החיבורים במצב הדמיה (Sandbox)' : 'סביבת ייצור',
  };
}
