import { z } from 'zod';
import { optionalDate, optionalId, optionalText, sanitizeSearch } from '@/lib/validation';

export const EMPLOYMENT_TYPES = ['REGULAR', 'CONTRACT', 'VISITING', 'ADJUNCT', 'TEMPORARY', 'OTHER'] as const;
export const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'RETIRED', 'TERMINATED'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const employeeListParams = z.object({
  q: z.string().optional().transform(sanitizeSearch),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
  sort: z.enum(['employee_number', 'display_name', 'employment_status']).catch('display_name'),
  dir: z.enum(['asc', 'desc']).catch('asc'),
});
export type EmployeeListParams = z.infer<typeof employeeListParams>;

const requiredId = (what: string) =>
  z
    .string()
    .min(1, `Select ${what}`)
    .transform(Number)
    .refine((v) => Number.isInteger(v) && v > 0, `Select ${what}`);

const requiredDate = (what: string) => z.string().min(1, `${what} is required`).regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');

const personal = {
  employee_number: z.string().trim().min(1, 'Employee number is required').max(30, 'At most 30 characters'),
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
  employment_source_id: requiredId('an employment source'),
  employment_type: z.enum(EMPLOYMENT_TYPES, { message: 'Select an employment type' }),
  joining_date: requiredDate('Joining date'),
};

export const employeeCreateSchema = z.object({
  ...personal,
  institution_id: requiredId('an institution'),
  campus_id: optionalId,
  department_id: optionalId,
  designation_id: optionalId,
  start_date: optionalDate,
});
export type EmployeeCreateInput = z.input<typeof employeeCreateSchema>;
export type EmployeeCreateValues = z.output<typeof employeeCreateSchema>;

/** An assignment needs campus and designation; department and start date are optional. All blank = no assignment. */
export function assignmentProblems(v: EmployeeCreateValues): Partial<Record<'campus_id' | 'designation_id', string>> {
  const any = [v.campus_id, v.department_id, v.designation_id, v.start_date].some((x) => x !== undefined);
  if (!any) return {};
  const out: Partial<Record<'campus_id' | 'designation_id', string>> = {};
  if (!v.campus_id) out.campus_id = 'Select a campus';
  if (!v.designation_id) out.designation_id = 'Select a designation';
  return out;
}

export const employeeEditSchema = z.object({
  ...personal,
  display_name: z.string().trim().min(1, 'Display name is required').max(250, 'At most 250 characters'),
});
export type EmployeeEditInput = z.input<typeof employeeEditSchema>;
export type EmployeeEditValues = z.output<typeof employeeEditSchema>;

export const assignSchema = z.object({
  campus_id: requiredId('a campus'),
  department_id: optionalId,
  designation_id: requiredId('a designation'),
  start_date: requiredDate('Start date'),
  is_primary: z.boolean(),
  end_current: z.boolean(),
});
export type AssignInput = z.input<typeof assignSchema>;
export type AssignValues = z.output<typeof assignSchema>;
