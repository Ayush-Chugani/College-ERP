import { z } from 'zod';
import { optionalDate, optionalId, sanitizeSearch } from '@/lib/validation';

export const COURSE_TYPES = ['THEORY', 'LAB', 'THEORY_LAB', 'PROJECT', 'SEMINAR', 'INTERNSHIP', 'OTHER'] as const;

const requiredId = (what: string) =>
  z
    .string()
    .min(1, `Select ${what}`)
    .transform(Number)
    .refine((v) => Number.isInteger(v) && v > 0, `Select ${what}`);

/** Decimal text field matching numeric(precision, scale): blank is 0 (decimal) or undefined (decimalOpt). */
const decimalCore = (label: string, maxInt: number, scale: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
    .refine(
      (v) => v === undefined || new RegExp(String.raw`^\d{1,${maxInt}}(\.\d{1,${scale}})?$`).test(v),
      `${label}: a number from 0 to ${'9'.repeat(maxInt)} with at most ${scale} decimal place${scale > 1 ? 's' : ''}`,
    );
const decimal = (label: string, maxInt: number, scale: number) => decimalCore(label, maxInt, scale).transform((v): number => (v === undefined ? 0 : Number(v)));
const decimalOpt = (label: string, maxInt: number, scale: number) => decimalCore(label, maxInt, scale).transform((v): number | undefined => (v === undefined ? undefined : Number(v)));

const courseBase = z.object({
    owning_department_id: requiredId('a department'),
    course_category_id: requiredId('a category'),
    course_code: z.string().trim().min(1, 'Course code is required').max(30, 'At most 30 characters'),
    course_title: z.string().trim().min(1, 'Course title is required').max(200, 'At most 200 characters'),
    short_title: z.string().trim().max(80, 'At most 80 characters').optional().transform((v) => (v ? v : undefined)),
    course_type: z.enum(COURSE_TYPES, { message: 'Select a course type' }),
    lecture_hours: decimal('Lecture hours', 3, 1),
    tutorial_hours: decimal('Tutorial hours', 3, 1),
    practical_hours: decimal('Practical hours', 3, 1),
    self_study_hours: decimal('Self-study hours', 3, 1),
    credits: decimal('Credits', 3, 1),
    effective_from: optionalDate,
    effective_to: optionalDate,
    is_active: z.boolean(),
});
const datesOrdered = (v: { effective_from?: string; effective_to?: string }) => !v.effective_from || !v.effective_to || v.effective_to >= v.effective_from;
const datesIssue = { path: ['effective_to'], message: 'Effective-to cannot be before effective-from' };
export const courseSchema = courseBase.refine(datesOrdered, datesIssue);
export type CourseInput = z.input<typeof courseSchema>;
export type CourseValues = z.output<typeof courseSchema>;

/** Department is fixed once a course exists (moving it would change who may manage it). */
export const courseEditSchema = courseBase.omit({ owning_department_id: true }).refine(datesOrdered, datesIssue);
export type CourseEditInput = z.input<typeof courseEditSchema>;
export type CourseEditValues = z.output<typeof courseEditSchema>;

export const categorySchema = z.object({
  category_code: z.string().trim().min(1, 'Code is required').max(30, 'At most 30 characters'),
  category_name: z.string().trim().min(1, 'Name is required').max(100, 'At most 100 characters'),
  is_graded: z.boolean(),
  contributes_to_gpa: z.boolean(),
  is_active: z.boolean(),
});
export type CategoryInput = z.input<typeof categorySchema>;
export type CategoryValues = z.output<typeof categorySchema>;

export const prerequisiteSchema = z.object({
  prerequisite_course_id: requiredId('a course'),
  minimum_grade: z.string().trim().max(5, 'At most 5 characters').optional().transform((v) => (v ? v : undefined)),
});
export type PrerequisiteInput = z.input<typeof prerequisiteSchema>;
export type PrerequisiteValues = z.output<typeof prerequisiteSchema>;

const wholeOptional = (label: string, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
    .refine((v) => v === undefined || (/^\d+$/.test(v) && Number(v) >= 0 && Number(v) <= max), `${label}: a whole number from 0 to ${max}`)
    .transform((v) => (v === undefined ? undefined : Number(v)));

/** A course placed in a curriculum scheme. Marks are numeric(6,2). Passing marks may not exceed internal + external. */
const schemeCourseBase = z.object({
  semester_id: requiredId('a semester'),
  course_id: requiredId('a course'),
  course_category_id: optionalId,
  is_mandatory: z.boolean(),
  elective_group_code: z.string().trim().max(30, 'At most 30 characters').optional().transform((v) => (v ? v : undefined)),
  display_order: wholeOptional('Display order', 65535),
  internal_max_marks: decimal('Internal marks', 4, 2),
  external_max_marks: decimal('External marks', 4, 2),
  passing_marks: decimalOpt('Passing marks', 4, 2),
  exam_duration_minutes: wholeOptional('Exam duration', 65535),
});
const marksOk = (v: { passing_marks?: number; internal_max_marks: number; external_max_marks: number }, ctx: z.RefinementCtx) => {
  if (v.passing_marks !== undefined && v.passing_marks > v.internal_max_marks + v.external_max_marks)
    ctx.addIssue({ code: 'custom', path: ['passing_marks'], message: 'Passing marks cannot exceed internal + external marks' });
};
export const schemeCourseSchema = schemeCourseBase.superRefine(marksOk);
export const schemeCourseEditSchema = schemeCourseBase.omit({ semester_id: true, course_id: true, course_category_id: true }).superRefine(marksOk);
export type SchemeCourseEditInput = z.input<typeof schemeCourseEditSchema>;
export type SchemeCourseEditValues = z.output<typeof schemeCourseEditSchema>;
export type SchemeCourseInput = z.input<typeof schemeCourseSchema>;
export type SchemeCourseValues = z.output<typeof schemeCourseSchema>;

export const courseListParams = z.object({
  q: z.string().optional().transform(sanitizeSearch),
  department: optionalId.catch(undefined),
  type: z.enum(COURSE_TYPES).optional().catch(undefined),
  active: z.enum(['yes', 'no']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type CourseListParams = z.infer<typeof courseListParams>;
