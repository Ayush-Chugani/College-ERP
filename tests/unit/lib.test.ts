import { describe, expect, it } from 'vitest';
import { parseContext } from '@/lib/context';
import { isPublicPath } from '@/lib/supabase/middleware';
import { visibleNav, NAV_ITEMS } from '@/lib/nav';
import { safeNextPath } from '@/lib/utils';
import { forgotSchema, loginSchema, newPasswordSchema, sanitizeSearch, studentListParams } from '@/lib/validation';

const ctx = (modules: string[]) =>
  parseContext({ user_id: 1, username: 'u', email: null, student_id: null, employee_id: null, roles: [], readable_modules: modules })!;

describe('validation', () => {
  it('login requires a valid email and a password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
    expect(forgotSchema.safeParse({ email: '' }).success).toBe(false);
  });
  it('new password enforces strength and confirmation', () => {
    expect(newPasswordSchema.safeParse({ password: 'Abcdefghi1', confirm: 'Abcdefghi1' }).success).toBe(true);
    expect(newPasswordSchema.safeParse({ password: 'short1A', confirm: 'short1A' }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: 'alllowercase1', confirm: 'alllowercase1' }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: 'Abcdefghi1', confirm: 'Different1A' }).success).toBe(false);
  });
  it('search sanitiser strips filter-significant characters', () => {
    expect(sanitizeSearch('a,b)(c%d*e"f\\g')).toBe('abcdefg');
    expect(sanitizeSearch("x'; drop table student;--")).toBe('x drop table student--');
    expect(sanitizeSearch(undefined)).toBe('');
    expect(sanitizeSearch('a'.repeat(200))).toHaveLength(80);
  });
  it('student list params fall back to safe defaults', () => {
    const p = studentListParams.parse({ page: '-3', sort: 'password_hash', dir: 'sideways', q: 'Ann,Lee' });
    expect(p).toEqual({ page: 1, sort: 'display_name', dir: 'asc', q: 'AnnLee' });
    expect(studentListParams.parse({ page: '3', sort: 'student_number', dir: 'desc' }).page).toBe(3);
  });
});

describe('redirect safety and routing', () => {
  it('only same-site relative redirects are allowed', () => {
    expect(safeNextPath('/students?page=2')).toBe('/students?page=2');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '', null, undefined]) {
      expect(safeNextPath(bad as string | null | undefined)).toBe('/dashboard');
    }
  });
  it('public paths are exactly login/reset/auth', () => {
    for (const p of ['/login', '/forgot-password', '/reset-password', '/auth/callback']) expect(isPublicPath(p)).toBe(true);
    for (const p of ['/', '/dashboard', '/students', '/loginx', '/settings']) expect(isPublicPath(p)).toBe(false);
  });
});

describe('navigation visibility', () => {
  it('hides module pages the user cannot read, keeps universal pages', () => {
    expect(visibleNav(ctx([])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/settings']);
    expect(visibleNav(ctx(['STUDENT'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/students', '/activities', '/settings']);
    expect(visibleNav(ctx(['EMPLOYEE'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/employees', '/settings']);
    expect(visibleNav(ctx(['ACADEMIC_CALENDAR', 'CURRICULUM'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/calendar', '/curriculum', '/courses', '/settings']);
    expect(visibleNav(ctx(['ATTENDANCE'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/attendance', '/settings']);
    expect(visibleNav(ctx(['REGISTRATION'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/registration', '/settings']);
    expect(visibleNav(ctx(['ADMISSION'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/admissions', '/settings']);
    expect(visibleNav(ctx(['INSTITUTION'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/structure', '/settings']);
    expect(visibleNav(ctx(['ASSESSMENT'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/assessment', '/settings']);
    expect(visibleNav(ctx(['TIMETABLE'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/timetable', '/settings']);
    expect(visibleNav(ctx(['GRIEVANCE'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/grievances', '/settings']);
    expect(visibleNav({ ...ctx([]), student_id: 5 }).map((i) => i.href)).toContain('/grievances');
    expect(visibleNav(ctx(['MENTORING'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/mentoring', '/settings']);
    expect(visibleNav(ctx(['FEEDBACK'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/feedback', '/settings']);
    expect(visibleNav(ctx(['FEES'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/finance', '/settings']);
    expect(visibleNav(ctx(['RESULT'])).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/results/grades', '/settings']);
    // "My results" is for linked students only, whatever modules they can read
    expect(visibleNav({ ...ctx([]), student_id: 5 }).map((i) => i.href)).toEqual(['/dashboard', '/announcements', '/my-results', '/my-documents', '/activities', '/grievances', '/settings']);
    expect(visibleNav({ ...ctx(['STUDENT', 'ADMISSION', 'REGISTRATION', 'ATTENDANCE', 'TIMETABLE', 'ASSESSMENT', 'RESULT', 'GRIEVANCE', 'MENTORING', 'FEEDBACK', 'FEES', 'EMPLOYEE', 'INSTITUTION', 'ACADEMIC_CALENDAR', 'CURRICULUM', 'IAM', 'AUDIT']), student_id: 5 }).map((i) => i.href)).toEqual(NAV_ITEMS.map((i) => i.href));
  });
  it('parseContext rejects malformed payloads', () => {
    expect(parseContext(null)).toBeNull();
    expect(parseContext({ user_id: 'x' })).toBeNull();
  });
});
