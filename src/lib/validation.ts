import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const forgotSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email'),
});
export type ForgotValues = z.infer<typeof forgotSchema>;

export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(10, 'Use at least 10 characters')
      .regex(/[a-z]/, 'Include a lowercase letter')
      .regex(/[A-Z]/, 'Include an uppercase letter')
      .regex(/[0-9]/, 'Include a number'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
export type NewPasswordValues = z.infer<typeof newPasswordSchema>;

/** Remove characters that carry meaning inside a PostgREST `or=` filter or ilike pattern. */
export function sanitizeSearch(q: string | undefined | null): string {
  return (q ?? '').replace(/[^\p{L}\p{N} .@_-]/gu, '').replace(/_/g, ' ').trim().slice(0, 80);
}

export const studentListParams = z.object({
  q: z.string().optional().transform(sanitizeSearch),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
  sort: z.enum(['student_number', 'display_name', 'student_status']).catch('display_name'),
  dir: z.enum(['asc', 'desc']).catch('asc'),
});
export type StudentListParams = z.infer<typeof studentListParams>;

// ---------------------------------------------------------------------------
// Student forms (limits mirror the student table: number 30, names 100, display 250, email 254, phone 25)
// ---------------------------------------------------------------------------
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== '' ? Number(v) : undefined))
  .refine((v) => v === undefined || (Number.isInteger(v) && v > 0), 'Invalid selection');

export const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date');

export const studentFields = {
  student_number: z.string().trim().min(1, 'Student number is required').max(30, 'At most 30 characters'),
  first_name: z.string().trim().min(1, 'First name is required').max(100, 'At most 100 characters'),
  middle_name: optionalText(100),
  last_name: optionalText(100),
  date_of_birth: optionalDate.refine((v) => v === undefined || (v < new Date().toISOString().slice(0, 10) && v >= '1900-01-01'), 'Date of birth must be in the past'),
  gender_id: optionalId,
  blood_group_id: optionalId,
  religion_id: optionalId,
  social_category_id: optionalId,
  nationality_country_id: optionalId,
  primary_email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined))
    .refine((v) => v === undefined || z.string().email().safeParse(v).success, 'Enter a valid email'),
  primary_phone: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || /^[0-9+()\-\s]{6,25}$/.test(v), 'Enter a valid phone number (6–25 digits or + ( ) -)'),
  notes: optionalText(2000),
};

export const studentCreateSchema = z.object({
  ...studentFields,
  programme_id: optionalId,
  curriculum_scheme_id: optionalId,
  admission_academic_year_id: optionalId,
  admission_semester_id: optionalId,
  admission_date: optionalDate,
});
export type StudentCreateInput = z.input<typeof studentCreateSchema>;
export type StudentCreateValues = z.output<typeof studentCreateSchema>;

export const studentEditSchema = z.object({
  ...studentFields,
  display_name: z.string().trim().min(1, 'Display name is required').max(250, 'At most 250 characters'),
});
export type StudentEditInput = z.input<typeof studentEditSchema>;
export type StudentEditValues = z.output<typeof studentEditSchema>;

/** When any enrolment field is filled, all of programme, scheme, year and semester are required. */
export function enrolmentProblems(v: StudentCreateValues): Partial<Record<'programme_id' | 'curriculum_scheme_id' | 'admission_academic_year_id' | 'admission_semester_id', string>> {
  const any = [v.programme_id, v.curriculum_scheme_id, v.admission_academic_year_id, v.admission_semester_id, v.admission_date].some((x) => x !== undefined);
  if (!any) return {};
  const out: Record<string, string> = {};
  if (!v.programme_id) out.programme_id = 'Select a programme';
  if (!v.curriculum_scheme_id) out.curriculum_scheme_id = 'Select a curriculum scheme';
  if (!v.admission_academic_year_id) out.admission_academic_year_id = 'Select an academic year';
  if (!v.admission_semester_id) out.admission_semester_id = 'Select a semester';
  return out;
}

export const STUDENT_STATUSES = ['APPLICANT', 'ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'COMPLETED', 'ALUMNUS', 'DECEASED'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
