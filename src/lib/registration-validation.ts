import { z } from 'zod';
import { optionalId, sanitizeSearch } from '@/lib/validation';

export const OFFERING_STATUSES = ['PLANNED', 'REGISTRATION_OPEN', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export const COURSE_OFFERING_STATUSES = ['PLANNED', 'OPEN', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export const TERM_REG_STATUSES = ['DRAFT', 'REGISTERED', 'APPROVED', 'CANCELLED', 'COMPLETED'] as const;
export const COURSE_REG_STATUSES = ['REGISTERED', 'APPROVED', 'DROPPED', 'WITHDRAWN', 'COMPLETED'] as const;
export const REGISTRATION_TYPES = ['REGULAR', 'ELECTIVE', 'BACKLOG', 'REPEAT', 'IMPROVEMENT', 'AUDIT', 'CREDIT_TRANSFER'] as const;

/**
 * Status buttons offered in the UI. These are conveniences, NOT database rules: the database enforces capacity, ownership and the
 * APPROVE permission (migrations 020 and 028) but does not restrict which status follows which for registrations.
 */
export const TERM_REG_NEXT: Record<string, readonly string[]> = {
  DRAFT: ['REGISTERED', 'CANCELLED'],
  REGISTERED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['COMPLETED', 'CANCELLED'],
  CANCELLED: ['REGISTERED'],
  COMPLETED: [],
};
export const COURSE_REG_NEXT: Record<string, readonly string[]> = {
  REGISTERED: ['APPROVED', 'DROPPED', 'WITHDRAWN'],
  APPROVED: ['COMPLETED', 'DROPPED', 'WITHDRAWN'],
  DROPPED: ['REGISTERED'],
  WITHDRAWN: ['REGISTERED'],
  COMPLETED: [],
};

const requiredId = (what: string) =>
  z
    .string()
    .min(1, `Select ${what}`)
    .transform(Number)
    .refine((v) => Number.isInteger(v) && v > 0, `Select ${what}`);
const requiredDate = (what: string) => z.string().min(1, `${what} is required`).regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const capacity = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
  .refine((v) => v === undefined || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535), 'Enter a whole number from 1 to 65535')
  .transform((v) => (v === undefined ? undefined : Number(v)));
const optText = (max: number) =>
  z.string().trim().max(max, `At most ${max} characters`).optional().transform((v) => (v ? v : undefined));

export const offeringSchema = z.object({
  academic_term_id: requiredId('an academic term'),
  programme_id: requiredId('a programme'),
  curriculum_scheme_id: requiredId('a curriculum scheme'),
  semester_id: requiredId('a semester'),
  status: z.enum(OFFERING_STATUSES),
});
export type OfferingInput = z.input<typeof offeringSchema>;
export type OfferingValues = z.output<typeof offeringSchema>;

export const sectionSchema = z.object({
  section_code: z.string().trim().min(1, 'Section code is required').max(20, 'At most 20 characters'),
  section_name: optText(100),
  capacity,
});
export type SectionInput = z.input<typeof sectionSchema>;
export type SectionValues = z.output<typeof sectionSchema>;

export const batchSchema = z.object({
  batch_code: z.string().trim().min(1, 'Batch code is required').max(20, 'At most 20 characters'),
  batch_name: optText(100),
  capacity,
});
export type BatchInput = z.input<typeof batchSchema>;
export type BatchValues = z.output<typeof batchSchema>;

export const registerStudentSchema = z.object({
  enrolment_id: requiredId('a student'),
  class_section_id: optionalId,
  class_batch_id: optionalId,
  roll_number: optText(30),
  registration_date: requiredDate('Registration date'),
}).refine((v) => v.class_batch_id === undefined || v.class_section_id !== undefined, { path: ['class_batch_id'], message: 'Choose the section the batch belongs to' });
export type RegisterStudentInput = z.input<typeof registerStudentSchema>;
export type RegisterStudentValues = z.output<typeof registerStudentSchema>;

export const courseRegSchema = z.object({
  course_offering_id: requiredId('a course offering'),
  registration_type: z.enum(REGISTRATION_TYPES),
  registration_date: requiredDate('Registration date'),
});
export type CourseRegInput = z.input<typeof courseRegSchema>;
export type CourseRegValues = z.output<typeof courseRegSchema>;

export const offeringListParams = z.object({
  q: z.string().optional().transform(sanitizeSearch),
  term: optionalId.catch(undefined),
  programme: optionalId.catch(undefined),
  status: z.enum(OFFERING_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type OfferingListParams = z.infer<typeof offeringListParams>;
