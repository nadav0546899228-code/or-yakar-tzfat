// תפקידים, היררכיה והרשאות. משתמש יכול להחזיק כמה תפקידים ולעבור ביניהם (תצוגה פעילה).
export const ROLES = {
  developer: { label: 'מתכנת', rank: 100 },
  manager: { label: 'מנהל העמותה', rank: 80 },
  treasurer: { label: 'גזבר / הנהלת חשבונות', rank: 60 },
  institution_manager: { label: 'מנהל מוסד', rank: 50 },
  aid_coordinator: { label: 'רכז קהילתי / מרכז הסיוע', rank: 40 },
  call_agent: { label: 'נציג מוקד טלפוני', rank: 30 },
  recruiter: { label: 'מתרים / שליח שטח', rank: 30 },
  secretary: { label: 'מזכירות', rank: 30 },
  accountant: { label: 'רואה חשבון (צפייה)', rank: 20 },
  donor: { label: 'תורם', rank: 5 },
};

// מי מורשה לנהל משתמשים בכל תפקיד (היררכיה)
export function canManageRole(actorRoles, targetRole) {
  if (actorRoles.includes('developer')) return true;
  if (targetRole === 'developer') return false;
  if (actorRoles.includes('manager')) return targetRole !== 'manager' || false;
  return false;
}

const ALL_STAFF = ['developer', 'manager', 'treasurer', 'institution_manager', 'aid_coordinator', 'call_agent', 'recruiter', 'secretary', 'accountant'];

// הרשאות לפי יכולת -> תפקידים
export const PERMS = {
  'dashboard.finance': ['developer', 'manager', 'treasurer', 'institution_manager', 'accountant'],
  'donors.read': ['developer', 'manager', 'treasurer', 'institution_manager', 'call_agent', 'recruiter', 'secretary', 'accountant'],
  'donors.write': ['developer', 'manager', 'treasurer', 'call_agent', 'recruiter', 'secretary'],
  'donors.merge': ['developer', 'manager', 'treasurer'],
  'tx.read': ['developer', 'manager', 'treasurer', 'institution_manager', 'accountant', 'secretary', 'recruiter'],
  'tx.write': ['developer', 'manager', 'treasurer', 'secretary', 'recruiter'],
  'tx.approve': ['developer', 'manager', 'treasurer'],
  'tx.actions': ['developer', 'manager', 'treasurer'],
  'keva.read': ['developer', 'manager', 'treasurer', 'institution_manager', 'accountant', 'call_agent'],
  'keva.actions': ['developer', 'manager', 'treasurer'],
  'docs.read': ['developer', 'manager', 'treasurer', 'institution_manager', 'accountant', 'secretary'],
  'docs.issue': ['developer', 'manager', 'treasurer', 'secretary'],
  'docs.cancel': ['developer', 'manager', 'treasurer'],
  'reports.read': ['developer', 'manager', 'treasurer', 'institution_manager', 'accountant'],
  'calls.read': ['developer', 'manager', 'call_agent', 'secretary'],
  'calls.manage': ['developer', 'manager'],
  'field.use': ['developer', 'manager', 'recruiter', 'secretary'],
  'boxes.read': ['developer', 'manager', 'treasurer', 'recruiter', 'secretary'],
  'boxes.write': ['developer', 'manager', 'treasurer', 'recruiter', 'secretary'],
  'spiritual.read': ['developer', 'manager', 'secretary', 'call_agent', 'aid_coordinator'],
  'spiritual.write': ['developer', 'manager', 'secretary', 'call_agent'],
  'events.read': ['developer', 'manager', 'treasurer', 'secretary', 'call_agent'],
  'events.write': ['developer', 'manager', 'secretary'],
  'aid.read': ['developer', 'manager', 'aid_coordinator'],
  'aid.write': ['developer', 'manager', 'aid_coordinator'],
  'campaigns.write': ['developer', 'manager'],
  'settings.org': ['developer', 'manager'],
  'automations.write': ['developer', 'manager'],
  'messages.send': ['developer', 'manager', 'treasurer', 'secretary', 'call_agent'],
  'users.manage': ['developer', 'manager'],
  'audit.read': ['developer', 'manager'],
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
