import { z } from 'zod';
import { optionalDate, optionalId, optionalText, sanitizeSearch } from '@/lib/validation';

export const APPLICATION_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ELIGIBLE', 'INELIGIBLE', 'SELECTED', 'WAITLISTED', 'REJECTED', 'ADMITTED', 'CANCELLED'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Allowed status transitions. ASSUMPTION (the source lists only the status values): this mirrors
 * sims_private.admission_transition_ok() in migration 027, and a test keeps the two identical.
 * SELECTED -> ADMITTED is not here: it happens only through the admit action.
 */
export const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['UNDER_REVIEW', 'REJECTED', 'CANCELLED'],
  UNDER_REVIEW: ['ELIGIBLE', 'INELIGIBLE', 'REJECTED', 'CANCELLED'],
  ELIGIBLE: ['SELECTED', 'WAITLISTED', 'REJECTED', 'CANCELLED'],
  INELIGIBLE: ['REJECTED', 'CANCELLED'],
  WAITLISTED: ['SELECTED', 'REJECTED', 'CANCELLED'],
  SELECTED: ['REJECTED', 'CANCELLED'],
  ADMITTED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** Permission action (ADMISSION.ALL.<action>) needed to move an application TO a status. */
export const ACTION_FOR: Partial<Record<ApplicationStatus, 'UPDATE' | 'VERIFY' | 'APPROVE'>> = {
  SUBMITTED: 'UPDATE', UNDER_REVIEW: 'UPDATE', CANCELLED: 'UPDATE',
  ELIGIBLE: 'VERIFY', INELIGIBLE: 'VERIFY',
  SELECTED: 'APPROVE', WAITLISTED: 'APPROVE', REJECTED: 'APPROVE',
};

export const TERMINAL: readonly ApplicationStatus[] = ['ADMITTED', 'REJECTED', 'CANCELLED'];

/** UI hint: the next statuses this user could request (the database re-checks everything). */
export function nextStatuses(current: string, hasPermission: (code: string) => boolean): ApplicationStatus[] {
  const from = (APPLICATION_STATUSES as readonly string[]).includes(current) ? (current as ApplicationStatus) : null;
  if (!from) return [];
  return TRANSITIONS[from].filter((to) => {
    const a = ACTION_FOR[to];
    return a ? hasPermission(`ADMISSION.ALL.${a}`) : false;
  });
}

export function canAdmit(status: string, hasPermission: (code: string) => boolean): boolean {
  return status === 'SELECTED' && hasPermission('ADMISSION.ALL.APPROVE') && hasPermission('STUDENT.ALL.CREATE');
}

const requiredId = (what: string) =>
  z
    .string()
    .min(1, `Select ${what}`)
    .transform(Number)
    .refine((v) => Number.isInteger(v) && v > 0, `Select ${what}`);
const requiredDate = (what: string) => z.string().min(1, `${what} is required`).regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');

const email = z
  .string()
  .trim()
  .max(254)
  .optional()
  .transform((v) => (v ? v.toLowerCase() : undefined))
  .refine((v) => v === undefined || z.string().email().safeParse(v).success, 'Enter a valid email');
const phone = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || /^[0-9+()\-\s]{6,25}$/.test(v), 'Enter a valid phone number (6–25 digits or + ( ) -)');
const dob = optionalDate.refine((v) => v === undefined || (v < new Date().toISOString().slice(0, 10) && v >= '1900-01-01'), 'Date of birth must be in the past');

export const applicantFields = {
  first_name: z.string().trim().min(1, 'First name is required').max(100, 'At most 100 characters'),
  middle_name: optionalText(100),
  last_name: optionalText(100),
  date_of_birth: dob,
  gender_id: optionalId,
  primary_email: email,
  primary_phone: phone,
  nationality_country_id: optionalId,
  social_category_id: optionalId,
};

export const applySchema = z.object({
  ...applicantFields,
  application_number: z.string().trim().min(1, 'Application number is required').max(30, 'At most 30 characters'),
  programme_id: requiredId('a programme'),
  academic_year_id: requiredId('an academic year'),
  admission_category_id: optionalId,
  application_date: requiredDate('Application date'),
  remarks: optionalText(2000),
});
export type ApplyInput = z.input<typeof applySchema>;
export type ApplyValues = z.output<typeof applySchema>;

export const applicantEditSchema = z.object(applicantFields);
export type ApplicantEditInput = z.input<typeof applicantEditSchema>;
export type ApplicantEditValues = z.output<typeof applicantEditSchema>;

export const applicationEditSchema = z.object({ admission_category_id: optionalId, remarks: optionalText(2000) });
export type ApplicationEditInput = z.input<typeof applicationEditSchema>;
export type ApplicationEditValues = z.output<typeof applicationEditSchema>;

export const admitSchema = z.object({
  student_number: z.string().trim().min(1, 'Student number is required').max(30, 'At most 30 characters'),
  curriculum_scheme_id: requiredId('a curriculum scheme'),
  admission_academic_year_id: requiredId('an academic year'),
  admission_semester_id: requiredId('a semester'),
  admission_date: optionalDate,
});
export type AdmitInput = z.input<typeof admitSchema>;
export type AdmitValues = z.output<typeof admitSchema>;

export const admissionCategorySchema = z.object({
  category_code: z.string().trim().min(1, 'Code is required').max(30, 'At most 30 characters'),
  category_name: z.string().trim().min(1, 'Name is required').max(100, 'At most 100 characters'),
  description: optionalText(500),
  is_active: z.boolean(),
});
export type AdmissionCategoryInput = z.input<typeof admissionCategorySchema>;
export type AdmissionCategoryValues = z.output<typeof admissionCategorySchema>;

export const applicationListParams = z.object({
  q: z.string().optional().transform(sanitizeSearch),
  status: z.enum(APPLICATION_STATUSES).optional().catch(undefined),
  programme: optionalId.catch(undefined),
  year: optionalId.catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type ApplicationListParams = z.infer<typeof applicationListParams>;

export const nullable = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);
