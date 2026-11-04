import type { SimsContext } from '@/lib/context';

export type NavItem = {
  href: string;
  label: string;
  /** access_module code; undefined = always shown to any signed-in, provisioned user */
  module?: string;
  /** shown only to a signed-in student (linked student record) */
  studentOnly?: boolean;
  /** shown only to a signed-in employee (linked employee record) */
  employeeOnly?: boolean;
  /** also shown to a linked student even without the module (the feature authorises students by identity) */
  alsoStudent?: boolean;
};

/** Only pages that actually exist belong here. Visibility is a convenience; RLS is the enforcement. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/announcements', label: 'Announcements' },
  { href: '/students', label: 'Students', module: 'STUDENT' },
  { href: '/admissions', label: 'Admissions', module: 'ADMISSION' },
  { href: '/registration', label: 'Registration', module: 'REGISTRATION' },
  { href: '/attendance', label: 'Attendance', module: 'ATTENDANCE' },
  { href: '/timetable', label: 'Timetable', module: 'TIMETABLE' },
  { href: '/assessment', label: 'Assessment', module: 'ASSESSMENT' },
  { href: '/results/grades', label: 'Grading', module: 'RESULT' },
  { href: '/my-results', label: 'My results', studentOnly: true },
  { href: '/my-documents', label: 'My documents', studentOnly: true },
  { href: '/certificates', label: 'Certificates', module: 'DOCUMENT', alsoStudent: true },
  { href: '/requests', label: 'Hall ticket and graduation', module: 'DOCUMENT', alsoStudent: true },
  { href: '/activities', label: 'Activities', module: 'STUDENT', alsoStudent: true },
  { href: '/staff-profile', label: 'Staff profile', module: 'STAFF_PROFILE' },
  { href: '/my-hr', label: 'My HR records', employeeOnly: true },
  { href: '/grievances', label: 'Grievances', module: 'GRIEVANCE', alsoStudent: true },
  { href: '/mentoring', label: 'Mentoring', module: 'MENTORING' },
  { href: '/feedback', label: 'Feedback', module: 'FEEDBACK' },
  { href: '/finance', label: 'Fees', module: 'FEES' },
  { href: '/employees', label: 'Employees', module: 'EMPLOYEE' },
  { href: '/structure', label: 'Institution structure', module: 'INSTITUTION' },
  { href: '/calendar', label: 'Academic calendar', module: 'ACADEMIC_CALENDAR' },
  { href: '/curriculum', label: 'Curriculum', module: 'CURRICULUM' },
  { href: '/courses', label: 'Courses', module: 'CURRICULUM' },
  { href: '/admin/users', label: 'Users and roles', module: 'IAM' },
  { href: '/admin/reference', label: 'Reference data', module: 'IAM' },
  { href: '/audit', label: 'Audit log', module: 'AUDIT' },
  { href: '/settings', label: 'Settings' },
];

export function visibleNav(ctx: SimsContext): NavItem[] {
  const mods = new Set(ctx.readable_modules);
  return NAV_ITEMS.filter((i) => (i.studentOnly ? ctx.student_id !== null : i.employeeOnly ? ctx.employee_id !== null : !i.module || mods.has(i.module) || (i.alsoStudent === true && ctx.student_id !== null)));
}

export function primaryRoleLabel(ctx: SimsContext): string {
  return ctx.roles[0]?.role_name ?? 'No active role';
}
