import { z } from 'zod';

export const SESSION_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'FOLLOW_UP_REQUIRED'] as const;
export const LEVELS = ['NORMAL', 'RESTRICTED', 'HIGHLY_RESTRICTED'] as const;
export const ASSIGNMENT_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export const NOTES_MAX = 10000;

const optDate = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date');
const optNotes = z.string().max(NOTES_MAX, `At most ${NOTES_MAX} characters`).optional().transform((v) => (v && v.trim() !== '' ? v : undefined));

export const assignSchema = z.object({
  student_number: z.string().trim().min(1, 'Student number is required').max(40, 'At most 40 characters'),
  employee_number: z.string().trim().min(1, 'Employee number is required').max(30, 'At most 30 characters'),
  start_date: optDate,
});
export type AssignInput = z.input<typeof assignSchema>;
export type AssignValues = z.output<typeof assignSchema>;

export const sessionSchema = z
  .object({
    session_date: z.string().min(1, 'The date and time are required').regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Use a valid date and time'),
    observations: optNotes,
    action_plan: optNotes,
    follow_up_date: optDate,
    session_status: z.enum(SESSION_STATUSES, { message: 'Select a status' }),
    confidentiality_level: z.enum(LEVELS, { message: 'Select a level' }),
  })
  .refine((v) => !v.follow_up_date || v.follow_up_date >= v.session_date.slice(0, 10), { path: ['follow_up_date'], message: 'The follow-up cannot be before the session' })
  .refine((v) => v.session_status !== 'FOLLOW_UP_REQUIRED' || !!v.follow_up_date, { path: ['follow_up_date'], message: 'A follow-up date is required when a follow-up is needed' });
export type SessionInput = z.input<typeof sessionSchema>;
export type SessionValues = z.output<typeof sessionSchema>;

export const endSchema = z.object({ status: z.enum(['COMPLETED', 'CANCELLED']), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date') });

export const assignmentListParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(ASSIGNMENT_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type AssignmentListParams = z.infer<typeof assignmentListParams>;

export const levelLabel = (l: string) => (l === 'HIGHLY_RESTRICTED' ? 'Highly restricted' : l === 'RESTRICTED' ? 'Restricted' : 'Normal');
export const levelHelp: Record<string, string> = {
  NORMAL: 'Visible to the mentor and to staff who may read mentoring records for this student.',
  RESTRICTED: 'Visible to the mentor and to global administrators.',
  HIGHLY_RESTRICTED: 'Visible to the mentor only.',
};
