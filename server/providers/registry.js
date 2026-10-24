// מפת כל הספקים האפשריים. כל ספק = כרטיס במסך המתכנת.
// status: 'real' - מתאם אמיתי ממומש (Sandbox של הספק) | 'sim' - מתאם במצב הדמיה עד קבלת תיעוד/מפתחות
export const CATEGORIES = {
  donations: 'פלטפורמות תרומה',
  documents: 'קבלות וחשבוניות',
  clearing: 'סליקת אשראי',
  acquirers: 'חברות כרטיסי אשראי (זיכויים)',
  bank: 'הוראות קבע בנקאיות ובנקים',
  tax: 'רשות המסים',
  accounting: 'הנהלת חשבונות',
  messaging: 'תקשורת',
  infra: 'תשתית',
  ai: 'בינה מלאכותית',
};

const f = (key, label, extra = {}) => ({ key, label, ...extra });
const secret = (key, label, extra = {}) => ({ key, label, secret: true, ...extra });

export const PROVIDERS = [
  {
    key: 'nedarim', label: 'נדרים פלוס', category: 'donations', status: 'sim',
    docs: 'https://www.matara.pro/nedarimplus/',
    note: 'יש API ציבורי ישן (DebitCard / DebitKeva) וממשק ניהול חדש עם מפתח מוסד (npk_...) המאפשר רשימה, חיפוש, עריכה, הקפאה וחיוב בודד של הו"ק. התיעוד ניתן ע"י נדרים לפי בקשת המוסד. יש להימנע מניסויים חוזרים בקצב גבוה.',
    fields: [f('mosad', 'מספר מוסד', { placeholder: '7000318' }), secret('api_key', 'מפתח API (npk_...)'), secret('api_password', 'סיסמת API (ישן)'), f('base_url', 'כתובת בסיס', { placeholder: 'https://www.matara.pro/nedarimplus' })],
    capabilities: ['pull_transactions', 'pull_keva', 'keva_freeze', 'keva_cancel', 'keva_amount', 'keva_charge_once', 'refund', 'pull_receipts'],
  },
  {
    key: 'kehilot', label: 'קהילות', category: 'donations', status: 'sim',
    note: 'מערכת ניהול קהילות ותרומות. יש לבקש מהספק גישת API / ייצוא תקופתי.',
    fields: [f('account_id', 'מזהה חשבון'), secret('api_key', 'מפתח API'), f('base_url', 'כתובת API')],
    capabilities: ['pull_transactions', 'pull_keva'],
  },
  {
    key: 'jgive', label: 'JGive', category: 'donations', status: 'sim', docs: 'https://www.jgive.com',
    note: 'פלטפורמת תרומות לעמותות הכוללת סליקה והוראות קבע. חיבור דרך API שותפים / Webhook לפי אישור JGive.',
    fields: [f('org_id', 'מזהה עמותה ב-JGive'), secret('api_key', 'מפתח API'), secret('webhook_secret', 'סוד Webhook')],
    capabilities: ['pull_transactions', 'pull_keva', 'webhook'],
  },
  {
    key: 'charidy', label: 'Charidy', category: 'donations', status: 'sim', docs: 'https://www.charidy.com',
    note: 'קמפיינים ממוקדים. משיכת תרומות קמפיין דרך API / ייצוא.',
    fields: [f('campaign_id', 'מזהה קמפיין'), secret('api_key', 'מפתח API')],
    capabilities: ['pull_transactions'],
  },
  {
    key: 'greeninvoice', label: 'חשבונית ירוקה (מורנינג)', category: 'documents', status: 'real',
    docs: 'https://www.greeninvoice.co.il/api-docs',
    note: 'API רשמי עם Sandbox. מחובר ל"תרומות ישראל" ומחזיר מספר דיווח. מסמך על סכום 0 נדחה. בסביבת פיתוח הפנייה היא ל-sandbox.d.greeninvoice.co.il.',
    fields: [secret('api_key_id', 'API Key ID'), secret('api_key_secret', 'API Key Secret'), f('default_doc_type', 'סוג מסמך ברירת מחדל', { placeholder: '405 = קבלה על תרומה' })],
    capabilities: ['issue_receipt46', 'issue_receipt', 'issue_invoice', 'cancel_document', 'pull_documents', 'tax_report_number', 'clearing_page'],
  },
  {
    key: 'icount', label: 'iCount', category: 'documents', status: 'sim', docs: 'https://www.icount.co.il',
    fields: [f('company_id', 'מזהה חברה (cid)'), f('user', 'משתמש'), secret('pass', 'סיסמה / Token')],
    capabilities: ['issue_receipt46', 'issue_receipt', 'cancel_document', 'clearing_page'],
  },
  {
    key: 'ezcount', label: 'Hyp Invoice (EZcount)', category: 'documents', status: 'sim', docs: 'https://developers.hyp.co.il',
    fields: [secret('api_key', 'API Key'), f('developer_email', 'מייל מפתח')],
    capabilities: ['issue_receipt46', 'issue_receipt', 'cancel_document'],
  },
  {
    key: 'rivhit', label: 'ריווחית', category: 'documents', status: 'sim', docs: 'https://rivhit-api.readme.io/docs/general',
    fields: [secret('api_token', 'API Token')],
    capabilities: ['issue_receipt', 'issue_invoice', 'pull_documents'],
  },
  {
    key: 'invoice4u', label: 'Invoice4U', category: 'documents', status: 'sim',
    fields: [f('user', 'משתמש'), secret('password', 'סיסמה'), secret('api_key', 'API Key')],
    capabilities: ['issue_receipt', 'issue_invoice'],
  },
  {
    key: 'sumit', label: 'סאמיט (OfficeGuy)', category: 'documents', status: 'sim', docs: 'https://www.myofficeguy.com/developers',
    note: 'כולל קבלת תרומה, סליקה, הוראות קבע וייצוא לחשבשבת.',
    fields: [f('company_id', 'Company ID'), secret('api_key', 'API Key (פרטי)'), f('public_key', 'Public Key')],
    capabilities: ['issue_receipt46', 'issue_receipt', 'charge', 'keva_create', 'export_hashavshevet'],
  },
  {
    key: 'cardcom', label: 'קארדקום', category: 'clearing', status: 'sim', docs: 'https://kb.cardcom.solutions',
    fields: [f('terminal', 'מספר מסוף'), f('api_name', 'שם משתמש API'), secret('api_password', 'סיסמת API')],
    capabilities: ['clearing_page', 'charge_token', 'keva_create', 'refund', 'webhook', 'issue_receipt'],
  },
  {
    key: 'tranzila', label: 'טרנזילה', category: 'clearing', status: 'sim', docs: 'https://docs.tranzila.com',
    fields: [f('terminal', 'שם מסוף'), secret('app_key', 'App Key'), secret('secret', 'Secret')],
    capabilities: ['clearing_page', 'charge_token', 'keva_create', 'refund', 'bank_keva'],
  },
  {
    key: 'grow', label: 'Grow (משולם)', category: 'clearing', status: 'sim', docs: 'https://grow-il.readme.io',
    note: 'תומך ב-Webhooks להו"ק ולחיובים שנכשלו (מהחיוב השני ואילך).',
    fields: [f('user_id', 'User ID'), f('page_code', 'Page Code'), secret('api_key', 'API Key'), secret('webhook_secret', 'סוד Webhook')],
    capabilities: ['clearing_page', 'keva_create', 'webhook', 'keva_failed_webhook', 'bit'],
  },
  {
    key: 'payplus', label: 'PayPlus', category: 'clearing', status: 'sim', docs: 'https://docs.payplus.co.il',
    fields: [secret('api_key', 'API Key'), secret('secret_key', 'Secret Key'), f('page_uid', 'Payment Page UID')],
    capabilities: ['clearing_page', 'charge_token', 'keva_create', 'refund', 'webhook'],
  },
  {
    key: 'hyp', label: 'Hyp (יעד שריג)', category: 'clearing', status: 'sim', docs: 'https://developers.hyp.co.il',
    fields: [f('masof', 'מספר מסוף (Masof)'), secret('pass_p', 'PassP'), secret('api_key', 'KEY')],
    capabilities: ['clearing_page', 'charge_token', 'keva_create', 'issue_receipt'],
  },
  {
    key: 'pelecard', label: 'Pelecard', category: 'clearing', status: 'sim',
    fields: [f('terminal', 'מסוף'), f('user', 'משתמש'), secret('password', 'סיסמה')],
    capabilities: ['clearing_page', 'charge_token', 'refund'],
  },
  {
    key: 'payme', label: 'PayMe (ישראכרט)', category: 'clearing', status: 'sim',
    fields: [secret('seller_key', 'Seller Payme ID')],
    capabilities: ['clearing_page', 'bit', 'refund'],
  },
  {
    key: 'icredit', label: 'iCredit (ריווחית)', category: 'clearing', status: 'sim',
    fields: [secret('group_key', 'Group Private Token')],
    capabilities: ['clearing_page', 'refund'],
  },
  {
    key: 'isracard', label: 'ישראכרט', category: 'acquirers', status: 'real', portal: 'https://www.isracard.co.il',
    note: 'סולק של ישראכרט, אמריקן אקספרס ומאסטרקארד (חלקי). אין API פתוח לעמותות: מורידים מאתר בית העסק את דוח הזיכויים (CSV/Excel שנשמר כ-CSV) ומעלים במסך "זיכויי חברות אשראי". המערכת מתאימה כל זיכוי לתרומה. כרטיסי ויזה ומאסטרקארד מגיעים דרך החברה שסולקת עבור המסוף.',
    fields: [f('merchant_number', 'מספר בית עסק'), f('portal_url', 'כתובת אתר בית העסק', { placeholder: 'https://www.isracard.co.il' }), f('deposit_days', 'ימים עד זיכוי (משוער)', { placeholder: '3' })],
    capabilities: ['settlement_import', 'bank_reconcile', 'portal_link'],
  },
  {
    key: 'cal', label: 'כאל (CAL)', category: 'acquirers', status: 'real', portal: 'https://www.cal-online.co.il',
    note: 'סולק של ויזה, מאסטרקארד ודיינרס. קליטת דוח זיכויים מאתר כאל לעסקים והתאמה אוטומטית לתרומות.',
    fields: [f('merchant_number', 'מספר בית עסק'), f('portal_url', 'כתובת אתר בית העסק', { placeholder: 'https://www.cal-online.co.il' }), f('deposit_days', 'ימים עד זיכוי (משוער)', { placeholder: '3' })],
    capabilities: ['settlement_import', 'bank_reconcile', 'portal_link'],
  },
  {
    key: 'max', label: 'מקס (Max)', category: 'acquirers', status: 'real', portal: 'https://www.max.co.il',
    note: 'סולק של ויזה ומאסטרקארד. קליטת דוח זיכויים מאתר מקס לעסקים והתאמה אוטומטית לתרומות.',
    fields: [f('merchant_number', 'מספר בית עסק'), f('portal_url', 'כתובת אתר בית העסק', { placeholder: 'https://www.max.co.il' }), f('deposit_days', 'ימים עד זיכוי (משוער)', { placeholder: '3' })],
    capabilities: ['settlement_import', 'bank_reconcile', 'portal_link'],
  },
  {
    key: 'masav', label: 'מס"ב - קובץ חיובים', category: 'bank', status: 'real',
    note: 'הפקת קובץ חיובי הו"ק בנקאיות מתוך המערכת לפי מוסד/תאריך. הפורמט המדויק מאומת מול הבנק/ספק המס"ב של העמותה לפני שימוש ראשון.',
    fields: [f('institution_code', 'קוד מוסד במס"ב'), f('sending_institution', 'קוד מוסד שולח'), f('bank_account', 'חשבון זיכוי (בנק-סניף-חשבון)')],
    capabilities: ['masav_file', 'returns_import'],
  },
  {
    key: 'bank_import', label: 'ייבוא דפי בנק', category: 'bank', status: 'sim',
    note: 'קליטת קובץ תנועות (CSV/Excel) מהבנק להתאמה אוטומטית. חיבור Open Banking בעתיד.',
    fields: [f('bank_name', 'בנק'), f('account', 'חשבון')],
    capabilities: ['bank_reconcile'],
  },
  {
    key: 'tax_donations', label: 'תרומות ישראל (רשות המסים)', category: 'tax', status: 'sim',
    docs: 'https://www.gov.il/en/service/report-public-institution-receipt-donation',
    note: 'חובה מ-1.1.2026 לכל מוסד עם סעיף 46. המערכת מדווחת דרך ספק המסמכים המחובר (למשל חשבונית ירוקה) ושומרת את מספר הדיווח.',
    fields: [f('entity_number', 'מספר העמותה'), f('approval_46_until', 'תוקף אישור 46')],
    capabilities: ['tax_report_number'],
  },
  {
    key: 'hashavshevet', label: 'חשבשבת / רו"ח', category: 'accounting', status: 'real',
    note: 'ייצוא תנועות ומסמכים לקובץ לרואה החשבון.',
    fields: [f('accountant_email', 'מייל רואה החשבון')],
    capabilities: ['export_hashavshevet'],
  },
  {
    key: 'whatsapp', label: 'WhatsApp Business', category: 'messaging', status: 'sim', docs: 'https://developers.facebook.com/docs/whatsapp',
    fields: [f('phone_number_id', 'Phone Number ID'), secret('access_token', 'Access Token'), f('template_ns', 'Namespace תבניות')],
    capabilities: ['send_whatsapp'],
  },
  {
    key: 'sms', label: 'SMS (019 / Inforu / וכו׳)', category: 'messaging', status: 'sim',
    fields: [f('vendor', 'ספק'), f('sender', 'שם שולח'), secret('api_key', 'API Key')],
    capabilities: ['send_sms', 'donor_otp'],
  },
  {
    key: 'email', label: 'מייל (Resend / SendGrid)', category: 'messaging', status: 'sim',
    fields: [f('vendor', 'ספק'), f('from', 'כתובת שולח'), secret('api_key', 'API Key')],
    capabilities: ['send_email'],
  },
  {
    key: 'push', label: 'התראות Push', category: 'messaging', status: 'sim',
    fields: [f('vapid_public', 'VAPID Public'), secret('vapid_private', 'VAPID Private')],
    capabilities: ['push'],
  },
  {
    key: 'google_login', label: 'כניסת Google', category: 'infra', status: 'sim',
    fields: [f('client_id', 'Client ID'), f('allowed_emails', 'מיילים מורשים (מופרדים בפסיק)')],
    capabilities: ['login'],
  },
  {
    key: 'google_drive', label: 'Google Drive - גיבוי', category: 'infra', status: 'sim',
    fields: [f('folder_id', 'מזהה תיקייה'), secret('service_account_json', 'Service Account JSON')],
    capabilities: ['backup'],
  },
  {
    key: 'maps', label: 'מפות וניווט', category: 'infra', status: 'sim',
    fields: [secret('api_key', 'API Key')],
    capabilities: ['geocode'],
  },
  {
    key: 'ai', label: 'עוזר AI', category: 'ai', status: 'sim',
    note: 'שלב מאוחר: שאלות בשפה חופשית על הנתונים, קריאה בלבד.',
    fields: [f('vendor', 'ספק'), f('model', 'מודל'), secret('api_key', 'API Key')],
    capabilities: ['ask'],
  },
];

export const CAPABILITY_LABELS = {
  pull_transactions: 'משיכת תרומות', pull_keva: 'משיכת הו"ק', keva_freeze: 'הקפאת הו"ק', keva_cancel: 'ביטול הו"ק',
  keva_amount: 'שינוי סכום הו"ק', keva_charge_once: 'חיוב בודד', refund: 'זיכוי', pull_receipts: 'משיכת קבלות',
  webhook: 'Webhook', keva_failed_webhook: 'התראת חיוב שנכשל', issue_receipt46: 'קבלת 46', issue_receipt: 'קבלה',
  issue_invoice: 'חשבונית', cancel_document: 'ביטול מסמך', pull_documents: 'משיכת מסמכים', tax_report_number: 'מספר דיווח לרשות המסים',
  clearing_page: 'דף סליקה', charge_token: 'חיוב בטוקן', keva_create: 'הקמת הו"ק', charge: 'חיוב', bit: 'ביט',
  bank_keva: 'הו"ק בנקאית', masav_file: 'קובץ מס"ב', returns_import: 'קליטת החזרות', bank_reconcile: 'התאמת בנק',
  export_hashavshevet: 'ייצוא לחשבשבת', send_whatsapp: 'וואטסאפ', send_sms: 'SMS', donor_otp: 'קוד כניסה לתורם',
  send_email: 'מייל', push: 'Push', login: 'כניסה', backup: 'גיבוי', geocode: 'כתובות', ask: 'שאלות על הנתונים',
};

export function getProvider(key) {
  return PROVIDERS.find((p) => p.key === key);
}
