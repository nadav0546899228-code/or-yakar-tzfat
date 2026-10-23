// תוויות וצבעים לסטטוסים ולמקורות
export const SOURCE_LABELS = {
  manual: 'ידני / משרד', nedarim: 'נדרים פלוס', kehilot: 'קהילות', jgive: 'JGive', charidy: 'Charidy', greeninvoice: 'חשבונית ירוקה',
  icount: 'iCount', ezcount: 'EZcount', rivhit: 'ריווחית', invoice4u: 'Invoice4U', sumit: 'סאמיט', cardcom: 'קארדקום', tranzila: 'טרנזילה',
  grow: 'Grow', payplus: 'PayPlus', hyp: 'Hyp', pelecard: 'Pelecard', payme: 'PayMe', icredit: 'iCredit', masav: 'מס"ב', bank_import: 'בנק',
};

export const TX_STATUS = { paid: ['שולם', 'ok'], pending: ['ממתין', 'warn'], failed: ['נכשל', 'bad'], refunded: ['זוכה', 'purple'], cancelled: ['בוטל', ''], bounced: ['חזר', 'bad'] };
export const SO_STATUS = { active: ['פעילה', 'ok'], frozen: ['מוקפאת', 'info'], failed: ['נכשלה', 'bad'], cancelled: ['בוטלה', ''], ended: ['הסתיימה', 'warn'] };
export const TAX_STATUS = { reported: ['דווח', 'ok'], pending: ['ממתין לדיווח', 'warn'], failed: ['נכשל', 'bad'], not_required: ['לא נדרש', ''] };
export const DOC_TYPES = { receipt46: 'קבלה 46', receipt: 'קבלה', invoice_receipt: 'חשבונית מס-קבלה', invoice: 'חשבונית', credit: 'זיכוי' };
export const KIND_LABELS = { one_time: 'חד-פעמי', keva: 'הו"ק', cash: 'מזומן', check: 'צ׳ק', transfer: 'העברה', box: 'קופה', pledge: 'התחייבות' };
export const METHOD_LABELS = { credit: 'אשראי', bit: 'ביט', bank_keva: 'הו"ק בנקאית', cash: 'מזומן', check: 'צ׳ק', transfer: 'העברה', paypal: 'PayPal', other: 'אחר' };
export const CALL_REASON = { follow_up: 'מעקב', upgrade: 'מבצע הגדלה', renewal: 'חידוש הו"ק', failed_charge: 'חיוב שנכשל', thank_you: 'שיחת תודה', new_lead: 'ליד חדש', yahrzeit: 'יארצייט', pledge: 'גביית התחייבות' };
export const DATE_KIND = { yahrzeit: 'יארצייט', birthday: 'יום הולדת', anniversary: 'יום נישואין', bar_mitzvah: 'בר/בת מצווה', other: 'אחר' };

export function statusTag(map, key) {
  const [label, kind] = map[key] || [key, ''];
  return { label, kind };
}
