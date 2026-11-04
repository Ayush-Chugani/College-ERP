import { z } from 'zod';
import { optionalDate, optionalId, sanitizeSearch } from '@/lib/validation';

export const YEAR_STATUSES = ['PLANNED', 'ACTIVE', 'CLOSED'] as const;
export const TERM_STATUSES = ['PLANNED', 'REGISTRATION_OPEN', 'ACTIVE', 'CLOSED'] as const;
export const TERM_TYPES = ['ODD', 'EVEN', 'SUMMER', 'ANNUAL', 'OTHER'] as const;
export const SCHEME_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;

const requiredDate = (what: string) => z.string().min(1, `${what} is required`).regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const requiredId = (what: string) =>
  z
    .string()
    .min(1, `Select ${what}`)
    .transform(Number)
    .refine((v) => Number.isInteger(v) && v > 0, `Select ${what}`);

// -- academic year (year_code varchar(9)); end must be after start (chk_academic_year_dates)
export const yearSchema = z
  .object({
    year_code: z.string().trim().min(1, 'Year code is required').max(9, 'At most 9 characters (e.g. 2025-26)'),
    start_date: requiredDate('Start date'),
    end_date: requiredDate('End date'),
    status: z.enum(YEAR_STATUSES),
  })
  .refine((v) => !v.start_date || !v.end_date || v.end_date > v.start_date, { path: ['end_date'], message: 'End date must be after the start date' });
export type YearInput = z.input<typeof yearSchema>;
export type YearValues = z.output<typeof yearSchema>;

// -- academic term (code 20, name 100); end >= start; registration window optional and ordered
export const termSchema = z
  .object({
    term_code: z.string().trim().min(1, 'Term code is required').max(20, 'At most 20 characters'),
    term_name: z.string().trim().min(1, 'Term name is required').max(100, 'At most 100 characters'),
    term_type: z.enum(TERM_TYPES, { message: 'Select a term type' }),
    start_date: requiredDate('Start date'),
    end_date: requiredDate('End date'),
    registration_start_date: optionalDate,
    registration_end_date: optionalDate,
    status: z.enum(TERM_STATUSES),
  })
  .superRefine((v, ctx) => {
    if (v.start_date && v.end_date && v.end_date < v.start_date) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'End date cannot be before the start date' });
    if (v.registration_start_date && v.registration_end_date && v.registration_end_date < v.registration_start_date)
      ctx.addIssue({ code: 'custom', path: ['registration_end_date'], message: 'Registration end cannot be before registration start' });
  });
export type TermInput = z.input<typeof termSchema>;
export type TermValues = z.output<typeof termSchema>;

// -- semester (name 50, number > 0 and fits u8)
export const semesterSchema = z.object({
  semester_number: z
    .string()
    .min(1, 'Semester number is required')
    .transform(Number)
    .refine((v) => Number.isInteger(v) && v >= 1 && v <= 255, 'Enter a whole number from 1 to 255'),
  semester_name: z.string().trim().min(1, 'Semester name is required').max(50, 'At most 50 characters'),
});
export type SemesterInput = z.input<typeof semesterSchema>;
export type SemesterValues = z.output<typeof semesterSchema>;

// -- curriculum scheme (code 30, name 150, regulation_year YEAR 1901..2155, credits optional)
export const schemeSchema = z
  .object({
    programme_id: requiredId('a programme'),
    scheme_code: z.string().trim().min(1, 'Scheme code is required').max(30, 'At most 30 characters'),
    scheme_name: z.string().trim().min(1, 'Scheme name is required').max(150, 'At most 150 characters'),
    regulation_year: z
      .string()
      .min(1, 'Regulation year is required')
      .transform(Number)
      .refine((v) => Number.isInteger(v) && v >= 1901 && v <= 2155, 'Enter a year between 1901 and 2155'),
    total_credits: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() !== '' ? Number(v) : undefined))
      .refine((v) => v === undefined || (Number.isFinite(v) && v >= 0 && v <= 9999), 'Enter credits between 0 and 9999'),
    effective_from: requiredDate('Effective-from date'),
    effective_to: optionalDate,
    status: z.enum(SCHEME_STATUSES),
  })
  .refine((v) => !v.effective_to || !v.effective_from || v.effective_to >= v.effective_from, { path: ['effective_to'], message: 'Effective-to cannot be before effective-from' });
export type SchemeInput = z.input<typeof schemeSchema>;
export type SchemeValues = z.output<typeof schemeSchema>;

export const schemeListParams = z.object({
  q: z.string().optional().transform(sanitizeSearch),
  programme: optionalId.catch(undefined),
  status: z.enum(SCHEME_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type SchemeListParams = z.infer<typeof schemeListParams>;

/** Empty optional values are sent as null so cleared fields are actually cleared. */
export const nul = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);
