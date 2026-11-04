import { z } from 'zod';
import { optionalId } from '@/lib/validation';

export const COMPONENT_TYPES = ['INTERNAL_TEST', 'QUIZ', 'ASSIGNMENT', 'LAB', 'PROJECT', 'PRESENTATION', 'TERM_WORK', 'OTHER'] as const;
export const EVENT_STATUSES = ['PLANNED', 'CONDUCTED', 'CANCELLED', 'PUBLISHED'] as const;
export const MARK_STATUSES = ['PRESENT', 'ABSENT', 'EXEMPTED', 'MALPRACTICE'] as const;
export const RESULT_STATUSES = ['PASS', 'FAIL', 'ABSENT', 'WITHHELD', 'EXEMPTED'] as const;
export const EXPLICIT_RESULT_STATUSES = ['ABSENT', 'WITHHELD', 'EXEMPTED', 'INCOMPLETE'] as const;

const requiredDate = (what: string) => z.string().min(1, `${what} is required`).regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const optDate = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date');
const optTime = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v), 'Use a valid time (HH:MM)');
const optText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).optional().transform((v) => (v ? v : undefined));

/** Decimal text matching numeric(precision, scale). required => a value must be given; otherwise blank is undefined. */
const decimal = (label: string, maxInt: number, scale: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
    .refine((v) => v === undefined || new RegExp(String.raw`^\d{1,${maxInt}}(\.\d{1,${scale}})?$`).test(v), `${label}: a number up to ${'9'.repeat(maxInt)} with at most ${scale} decimal place${scale > 1 ? 's' : ''}`)
    .transform((v) => (v === undefined ? undefined : Number(v)));
const requiredDecimal = (label: string, maxInt: number, scale: number) =>
  decimal(label, maxInt, scale).refine((v): v is number => v !== undefined, `${label} is required`).transform((v) => v as number);

export const componentSchema = z.object({
  component_code: z.string().trim().min(1, 'Code is required').max(30, 'At most 30 characters'),
  component_name: z.string().trim().min(1, 'Name is required').max(100, 'At most 100 characters'),
  component_type: z.enum(COMPONENT_TYPES, { message: 'Select a type' }),
  maximum_marks: requiredDecimal('Maximum marks', 5, 2),
  weightage_percent: decimal('Weightage', 3, 2).refine((v) => v === undefined || v <= 100, 'Weightage cannot exceed 100'),
  is_mandatory: z.boolean(),
});
export type ComponentInput = z.input<typeof componentSchema>;
export type ComponentValues = z.output<typeof componentSchema>;

export const eventSchema = z
  .object({
    event_title: z.string().trim().min(1, 'Title is required').max(150, 'At most 150 characters'),
    assessment_date: requiredDate('Date'),
    start_time: optTime,
    end_time: optTime,
    maximum_marks: requiredDecimal('Maximum marks', 5, 2),
    reduced_maximum_marks: decimal('Reduced maximum', 5, 2),
    event_number: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
      .refine((v) => v === undefined || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535), 'A whole number from 1 to 65535')
      .transform((v) => (v === undefined ? undefined : Number(v))),
    details: optText(2000),
  })
  .refine((v) => !v.start_time || !v.end_time || v.end_time > v.start_time, { path: ['end_time'], message: 'End time must be after the start time' })
  .refine((v) => v.reduced_maximum_marks === undefined || v.reduced_maximum_marks <= v.maximum_marks, { path: ['reduced_maximum_marks'], message: 'The reduced maximum cannot exceed the maximum' });
export type EventInput = z.input<typeof eventSchema>;
export type EventValues = z.output<typeof eventSchema>;

export const gradeScaleSchema = z
  .object({ scale_name: z.string().trim().min(1, 'Name is required').max(100, 'At most 100 characters'), effective_from: requiredDate('Effective from'), effective_to: optDate, is_active: z.boolean() })
  .refine((v) => !v.effective_to || v.effective_to >= v.effective_from, { path: ['effective_to'], message: 'Effective-to cannot be before effective-from' });
export type GradeScaleInput = z.input<typeof gradeScaleSchema>;
export type GradeScaleValues = z.output<typeof gradeScaleSchema>;

export const gradeRuleSchema = z
  .object({
    grade_letter: z.string().trim().min(1, 'Letter is required').max(5, 'At most 5 characters'),
    grade_point: requiredDecimal('Grade point', 2, 2),
    minimum_percentage: requiredDecimal('Minimum %', 3, 2).refine((v) => v <= 100, 'At most 100'),
    maximum_percentage: requiredDecimal('Maximum %', 3, 2).refine((v) => v <= 100, 'At most 100'),
    result_status: z.enum(RESULT_STATUSES, { message: 'Select a status' }),
  })
  .refine((v) => v.maximum_percentage >= v.minimum_percentage, { path: ['maximum_percentage'], message: 'Maximum cannot be below the minimum' });
export type GradeRuleInput = z.input<typeof gradeRuleSchema>;
export type GradeRuleValues = z.output<typeof gradeRuleSchema>;

// ---------------------------------------------------------------------------
// Marks entry rows (client-side checks mirror the database so errors show before saving; the database is the authority)
export type MarkRow = { course_registration_id: number; status: string; marks: string; reduced: string; remarks: string; touched: boolean };

const MARK_RE = /^\d{1,5}(\.\d{1,2})?$/;

export function validateMarkRow(r: MarkRow, max: number, reducedMax: number | null): string | null {
  if (r.status !== 'PRESENT') return r.marks.trim() !== '' || r.reduced.trim() !== '' ? `A ${r.status.toLowerCase()} entry cannot carry marks` : null;
  if (r.marks.trim() !== '') {
    if (!MARK_RE.test(r.marks.trim())) return 'Marks: a non-negative number with at most 2 decimals';
    if (Number(r.marks) > max) return `Marks exceed the maximum (${max})`;
  }
  if (r.reduced.trim() !== '') {
    if (!MARK_RE.test(r.reduced.trim())) return 'Reduced marks: a non-negative number with at most 2 decimals';
    if (reducedMax === null) return 'This event has no reduced maximum';
    if (Number(r.reduced) > reducedMax) return `Reduced marks exceed the maximum (${reducedMax})`;
  }
  return null;
}

/** Entries to send: only rows the user touched (so unchanged rows are not rewritten). */
export function buildMarkEntries(rows: MarkRow[]) {
  return rows
    .filter((r) => r.touched)
    .map((r) => ({
      course_registration_id: r.course_registration_id,
      attendance_status: r.status,
      marks_obtained: r.status === 'PRESENT' && r.marks.trim() !== '' ? Number(r.marks) : null,
      reduced_marks: r.status === 'PRESENT' && r.reduced.trim() !== '' ? Number(r.reduced) : null,
      ...(r.remarks.trim() ? { remarks: r.remarks.trim().slice(0, 500) } : {}),
    }));
}

export type ResultRow = { course_registration_id: number; internal: string; external: string; status: string; touched: boolean };

export function validateResultRow(r: ResultRow, internalMax: number | null, externalMax: number | null): string | null {
  if (r.status) return null; // explicit status: no marks needed
  if (r.internal.trim() === '' || r.external.trim() === '') return 'Enter both internal and external marks, or choose a status';
  if (!MARK_RE.test(r.internal.trim()) || !MARK_RE.test(r.external.trim())) return 'Marks: non-negative numbers with at most 2 decimals';
  if (internalMax !== null && Number(r.internal) > internalMax) return `Internal marks exceed the maximum (${internalMax})`;
  if (externalMax !== null && Number(r.external) > externalMax) return `External marks exceed the maximum (${externalMax})`;
  return null;
}

export const offeringListParams = z.object({
  term: optionalId.catch(undefined),
  programme: optionalId.catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type AssessmentListParams = z.infer<typeof offeringListParams>;

export const nullable = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);
