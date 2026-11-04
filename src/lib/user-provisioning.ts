import { z } from 'zod';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72;

/** A short list of passwords that are refused whatever else they contain. */
const COMMON = new Set(['password', 'password1', 'password123', 'admin123', 'admin@123', 'admin1234', 'qwerty123', 'letmein123', 'welcome123', 'iloveyou123', '1234567890', 'abcd123456']);

/** Returns a message when the password is not acceptable, otherwise null. The browser form and the server action both use it. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use letters and at least one number';
  if (COMMON.has(password.toLowerCase())) return 'That password is too common';
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && password.toLowerCase().includes(local)) return 'The password must not contain the email name';
  return null;
}

const blankToUndefined = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);

export const provisionSchema = z
  .object({
    email: z.string().trim().toLowerCase().min(1, 'Email is required').max(254, 'At most 254 characters').regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid email address'),
    password: z.string().min(1, 'Password is required'),
    confirm: z.string().min(1, 'Repeat the password'),
    student_number: z.string().optional().transform(blankToUndefined),
    employee_number: z.string().optional().transform(blankToUndefined),
  })
  .superRefine((v, ctx) => {
    if (v.password !== v.confirm) ctx.addIssue({ code: 'custom', path: ['confirm'], message: 'The passwords do not match' });
    const problem = passwordProblem(v.password, v.email);
    if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem });
    if (v.student_number && v.employee_number) ctx.addIssue({ code: 'custom', path: ['employee_number'], message: 'Link a student or an employee, not both' });
    if ((v.student_number?.length ?? 0) > 40) ctx.addIssue({ code: 'custom', path: ['student_number'], message: 'At most 40 characters' });
    if ((v.employee_number?.length ?? 0) > 30) ctx.addIssue({ code: 'custom', path: ['employee_number'], message: 'At most 30 characters' });
  });
export type ProvisionInput = z.input<typeof provisionSchema>;
export type ProvisionValues = z.output<typeof provisionSchema>;

export type ProvisionResult = { ok: true; userId: number; email: string } | { ok: false; error: string };

/** Maps a Supabase Auth admin error to a message that is safe to show. */
export function authCreateMessage(message: string | undefined, status: number | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (status === 422 || m.includes('already') || m.includes('registered') || m.includes('exists')) return 'An Auth user with that email already exists.';
  if (m.includes('password')) return 'The authentication service rejected the password. Choose a stronger one.';
  if (m.includes('email')) return 'The authentication service rejected the email address.';
  return 'The Auth user could not be created.';
}
