// תפקידים, היררכיה והרשאות. משתמש יכול להחזיק כמה תפקידים ולעבור ביניהם (תצוגה פעילה).
// המפתח 'manager' נשמר מטעמי תאימות - התצוגה שלו היא "מנכ"ל".
export const ROLES = {
  developer: { label: 'מתכנת', rank: 100 },
  manager: { label: 'מנכ"ל', rank: 80 },
  vp: { label: 'סמנכ"ל', rank: 70 },
  treasurer: { label: 'גזבר / הנהלת חשבונות', rank: 60 },
  institution_manager: { label: 'מנהל מוסד', rank: 50 },
  aid_coordinator: { label: 'רכז קהילתי / מרכז הסיוע', rank: 40 },
  call_agent: { label: 'נציג מוקד טלפוני', rank: 30 },
  recruiter: { label: 'מתרים / שליח שטח', rank: 30 },
  secretary: { label: 'מזכירה', rank: 30 },
  advisor: { label: 'יועץ (צפייה בלבד)', rank: 25 },
  accountant: { label: 'רואה חשבון (צפייה)', rank: 20 },
  donor: { label: 'תורם', rank: 5 },
};

// מי מורשה לנהל משתמשים בכל תפקיד (היררכיה): מתכנת הכל; מנכ"ל כל תפקיד מתחתיו (לא מתכנת ולא מנכ"ל)
export function canManageRole(actorRoles, targetRole) {
  if (actorRoles.includes('developer')) return true;
  if (targetRole === 'developer' || targetRole === 'manager') return false;
  if (actorRoles.includes('manager')) return true;
  return false;
}

const ALL_STAFF = ['developer', 'manager', 'vp', 'treasurer', 'institution_manager', 'aid_coordinator', 'call_agent', 'recruiter', 'secretary', 'advisor', 'accountant'];
const TOP = ['developer', 'manager', 'vp'];
const VIEW = ['advisor']; // יועץ: קריאה בלבד

// הרשאות לפי יכולת -> תפקידים
export const PERMS = {
  'dashboard.finance': [...TOP, ...VIEW, 'treasurer', 'institution_manager', 'accountant'],
  'donors.read': [...TOP, ...VIEW, 'treasurer', 'institution_manager', 'call_agent', 'recruiter', 'secretary', 'accountant'],
  'donors.write': [...TOP, 'treasurer', 'call_agent', 'recruiter', 'secretary'],
  'donors.merge': [...TOP, 'treasurer'],
  'tx.read': [...TOP, ...VIEW, 'treasurer', 'institution_manager', 'accountant', 'secretary', 'recruiter'],
  'tx.write': [...TOP, 'treasurer', 'secretary', 'recruiter'],
  'tx.approve': [...TOP, 'treasurer'],
  'tx.actions': [...TOP, 'treasurer'],
  'keva.read': [...TOP, ...VIEW, 'treasurer', 'institution_manager', 'accountant', 'call_agent'],
  'keva.actions': [...TOP, 'treasurer'],
  'docs.read': [...TOP, ...VIEW, 'treasurer', 'institution_manager', 'accountant', 'secretary'],
  'docs.issue': [...TOP, 'treasurer', 'secretary'],
  'docs.cancel': [...TOP, 'treasurer'],
  'reports.read': [...TOP, ...VIEW, 'treasurer', 'institution_manager', 'accountant'],
  'settlements.read': [...TOP, ...VIEW, 'treasurer', 'accountant'],
  'settlements.write': [...TOP, 'treasurer'],
  'calls.read': [...TOP, 'call_agent', 'secretary'],
  'calls.manage': [...TOP],
  'field.use': [...TOP, 'recruiter', 'secretary'],
  'boxes.read': [...TOP, ...VIEW, 'treasurer', 'recruiter', 'secretary'],
  'boxes.write': [...TOP, 'treasurer', 'recruiter', 'secretary'],
  'spiritual.read': [...TOP, ...VIEW, 'secretary', 'call_agent', 'aid_coordinator'],
  'spiritual.write': [...TOP, 'secretary', 'call_agent'],
  'events.read': [...TOP, ...VIEW, 'treasurer', 'secretary', 'call_agent'],
  'events.write': [...TOP, 'secretary'],
  'aid.read': [...TOP, ...VIEW, 'aid_coordinator'],
  'aid.write': [...TOP, 'aid_coordinator'],
  'campaigns.write': [...TOP],
  'settings.org': ['developer', 'manager'],
  'automations.write': [...TOP],
  'messages.send': [...TOP, 'treasurer', 'secretary', 'call_agent'],
  'users.manage': ['developer', 'manager'],
  'audit.read': [...TOP],
  'dev.only': ['developer'],
  'staff': ALL_STAFF,
};

export function can(user, perm) {
  if (!user) return false;
  const role = user.active_role;
  if (!role) return false;
  if (role === 'developer') return true;
  const allowed = PERMS[perm];
  return Array.isArray(allowed) && allowed.includes(role);
}
