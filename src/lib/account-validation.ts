import { z } from 'zod';

/** Mirrors my_profile_update (migration 045). */
export const PHONE_PATTERN = /^[0-9+() -]{6,25}$/;
export const profileSchema = z.object({
  primary_email: z.string().trim().max(254, 'At most 254 characters').optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address'),
  primary_phone: z.string().trim().max(25, 'At most 25 characters').optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || PHONE_PATTERN.test(v), 'Enter a valid phone number (digits, spaces, + ( ) - only)'),
});
export type ProfileInput = z.input<typeof profileSchema>;
export type ProfileValues = z.output<typeof profileSchema>;
/** Empty values are sent as "" so the database clears them. */
export const profilePayload = (v: ProfileValues): Record<string, string> => ({ primary_email: v.primary_email ?? '', primary_phone: v.primary_phone ?? '' });

/** TOTP codes are six digits; spaces typed by the user are ignored. */
export const mfaCodeSchema = z.object({ code: z.string().transform((v) => v.replace(/\s+/g, '')).pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code')) });
export type MfaCodeInput = z.input<typeof mfaCodeSchema>;
export type MfaCodeValues = z.output<typeof mfaCodeSchema>;

/** Notification links come from the database; only same-site paths are followed. */
export function safeInternalHref(href: string | null | undefined): string {
  if (!href || !href.startsWith('/') || href.startsWith('//') || href.includes('\\') || /[\u0000-\u001f]/.test(href)) return '/dashboard';
  return href;
}

export const NOTIFICATION_KINDS: Record<string, string> = {
  ANNOUNCEMENT: 'Announcement', DOCUMENT: 'Document', ACTIVITY: 'Activity', STAFF_RECORD: 'Staff record', GRIEVANCE: 'Grievance', TASK: 'To do',
};

export const searchParams = z.object({ q: z.string().trim().max(80).optional().catch(undefined) });

export const SEARCH_ROUTES: Record<string, (id: number) => string> = {
  student: (id) => `/students/${id}`,
  employee: (id) => `/employees/${id}`,
  course: (id) => `/courses/${id}`,
  programme: () => '/structure',
  department: () => '/structure',
};
export const SEARCH_LABELS: Record<string, string> = { student: 'Students', employee: 'Employees', course: 'Courses', programme: 'Programmes', department: 'Departments' };

export const loginAuditParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  result: z.enum(['ok', 'failed']).optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type LoginAuditParams = z.infer<typeof loginAuditParams>;
