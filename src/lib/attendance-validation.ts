import { z } from 'zod';
import { optionalId } from '@/lib/validation';

export const SESSION_TYPES = ['LECTURE', 'TUTORIAL', 'PRACTICAL', 'PROJECT', 'SEMINAR', 'OTHER'] as const;
export const SESSION_STATUSES = ['PLANNED', 'CONDUCTED', 'CANCELLED', 'RESCHEDULED'] as const;
export const ASSIGNMENT_ROLES = ['PRIMARY_INSTRUCTOR', 'CO_INSTRUCTOR', 'LAB_INSTRUCTOR', 'TUTOR', 'COORDINATOR', 'OTHER'] as const;
export const ASSIGNMENT_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

const requiredId = (what: string) =>
  z
    .string()
    .min(1, `Select ${what}`)
    .transform(Number)
    .refine((v) => Number.isInteger(v) && v > 0, `Select ${what}`);
const requiredDate = (what: string) => z.string().min(1, `${what} is required`).regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const time = (what: string) => z.string().min(1, `${what} is required`).regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use a valid time (HH:MM)');
const optDate = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date');
const optText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).optional().transform((v) => (v ? v : undefined));

export const teachingSectionSchema = z.object({
  course_offering_id: requiredId('a course offering'),
  class_section_id: requiredId('a class section'),
  class_batch_id: optionalId,
  session_type: z.enum(SESSION_TYPES, { message: 'Select a session type' }),
});
export type TeachingSectionInput = z.input<typeof teachingSectionSchema>;
export type TeachingSectionValues = z.output<typeof teachingSectionSchema>;

export const assignmentSchema = z
  .object({
    employee_id: requiredId('an employee'),
    assignment_role: z.enum(ASSIGNMENT_ROLES, { message: 'Select a role' }),
    start_date: requiredDate('Start date'),
    end_date: optDate,
    workload_hours: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
      .refine((v) => v === undefined || /^\d{1,3}(\.\d)?$/.test(v) || /^\d{1,3}(\.\d{1,2})?$/.test(v), 'A number up to 999.99')
      .transform((v) => (v === undefined ? undefined : Number(v))),
  })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, { path: ['end_date'], message: 'End date cannot be before the start date' });
export type AssignmentInput = z.input<typeof assignmentSchema>;
export type AssignmentValues = z.output<typeof assignmentSchema>;

export const sessionSchema = z
  .object({
    session_date: requiredDate('Date'),
    start_time: time('Start time'),
    end_time: time('End time'),
    session_type: z.enum(SESSION_TYPES, { message: 'Select a session type' }),
    faculty_assignment_id: optionalId,
    planned_topic: optText(2000),
  })
  .refine((v) => !v.start_time || !v.end_time || v.end_time > v.start_time, { path: ['end_time'], message: 'End time must be after the start time' });
export type SessionInput = z.input<typeof sessionSchema>;
export type SessionValues = z.output<typeof sessionSchema>;

export const statusSchema = z.object({
  status_code: z.string().trim().min(1, 'Code is required').max(20, 'At most 20 characters'),
  status_name: z.string().trim().min(1, 'Name is required').max(50, 'At most 50 characters'),
  counts_as_present: z.boolean(),
  is_active: z.boolean(),
});
export type StatusInput = z.input<typeof statusSchema>;
export type StatusValues = z.output<typeof statusSchema>;

export const correctionSchema = z.object({
  requested_status_id: requiredId('a status'),
  reason: z.string().trim().min(1, 'A reason is required').max(1000, 'At most 1000 characters'),
});
export type CorrectionInput = z.input<typeof correctionSchema>;
export type CorrectionValues = z.output<typeof correctionSchema>;

export type Mark = { roster_id: number; status_id: number; remarks?: string };

/** Build the attendance_mark payload from the sheet state: only students that were given a status are sent. */
export function buildMarks(rows: { roster_id: number; status_id: string; remarks: string }[]): Mark[] {
  return rows
    .filter((r) => r.status_id !== '' && Number(r.status_id) > 0)
    .map((r) => ({ roster_id: r.roster_id, status_id: Number(r.status_id), ...(r.remarks.trim() ? { remarks: r.remarks.trim().slice(0, 500) } : {}) }));
}

export const sectionListParams = z.object({
  programme: optionalId.catch(undefined),
  term: optionalId.catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type SectionListParams = z.infer<typeof sectionListParams>;
