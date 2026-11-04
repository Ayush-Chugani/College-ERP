import { z } from 'zod';

/** Mirror migration 044 (drift-tested). */
export const ACTIVITY_GROUPS = ['PUBLICATION', 'CONFERENCE', 'PROFESSIONAL_DEVELOPMENT', 'INTERNSHIP', 'RESEARCH', 'CONSULTANCY', 'CO_CURRICULAR', 'EXTRA_CURRICULAR', 'AWARD', 'MEMBERSHIP', 'ACADEMIC_PROFESSIONAL_CONTRIBUTION', 'OTHER'] as const;
export const OPTION_TABLES = [
  'award_category', 'cocurricular_category', 'conference_contribution_type', 'conference_event', 'country', 'course_catalog', 'department', 'event_mode', 'external_organization', 'extracurricular_category',
  'funding_agency', 'funding_type', 'industry_sector', 'journal', 'journal_type', 'membership_type', 'organizer', 'participation_level', 'professional_contribution_type', 'programme', 'publication_type',
  'publisher', 'research_status', 'role_type', 'state', 'training_program_type',
] as const;
export const LOOKUP_TABLES = ['journal', 'publisher', 'conference_event', 'organizer', 'external_organization', 'funding_agency'] as const;
export const APPROVAL_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;

const optId = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{1,9}$/.test(v), 'Select a valid option').transform((v) => (v === undefined ? undefined : Number(v)));
const optText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).optional().transform((v) => (v ? v : undefined));
const optDate = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a valid date');

export const staffSchema = z
  .object({
    activity_type_id: z.string().min(1, 'Select a type').regex(/^\d{1,9}$/, 'Select a type').transform(Number),
    activity_title: z.string().trim().min(1, 'The title is required').max(500, 'At most 500 characters'),
    start_date: optDate,
    end_date: optDate,
    academic_year_id: optId,
    participation_level_id: optId,
    primary_role_type_id: optId,
    description: optText(5000),
    outcomes: optText(5000),
  })
  .superRefine((v, ctx) => {
    if (v.start_date && v.end_date && v.end_date < v.start_date) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'The end date cannot be before the start date' });
  });
export type StaffInput = z.input<typeof staffSchema>;
export type StaffValues = z.output<typeof staffSchema>;
export const staffPayload = (v: StaffValues): Record<string, unknown> => Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val ?? null]));

export const contributorSchema = z
  .object({
    kind: z.enum(['EMPLOYEE', 'EXTERNAL']),
    employee_number: optText(50),
    external_name: optText(250),
    external_email: optText(254),
    affiliation: optText(500),
    role_type_id: optId,
    is_corresponding: z.boolean().optional(),
    details: optText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'EMPLOYEE' && !v.employee_number) ctx.addIssue({ code: 'custom', path: ['employee_number'], message: 'Enter the employee number' });
    if (v.kind === 'EXTERNAL' && !v.external_name) ctx.addIssue({ code: 'custom', path: ['external_name'], message: 'Enter the name' });
    if (v.external_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.external_email)) ctx.addIssue({ code: 'custom', path: ['external_email'], message: 'Enter a valid email' });
  });
export type ContributorInput = z.input<typeof contributorSchema>;
export type ContributorValues = z.output<typeof contributorSchema>;

export const listParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(APPROVAL_STATUSES).optional().catch(undefined),
  group: z.enum(ACTIVITY_GROUPS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type ListParams = z.infer<typeof listParams>;

// ---------------------------------------------------------------
// Generic detail forms (driven by staff_detail_schema / staff_lookup_schema)
// ---------------------------------------------------------------
export type DetailColumn = { name: string; type: string; required: boolean; max_length: number | null; ref_table: string | null; choices: string[] | null };
export type FieldKind = 'boolean' | 'date' | 'datetime' | 'integer' | 'decimal' | 'text' | 'longtext' | 'ref' | 'choice' | 'number-id';

export function fieldKind(c: DetailColumn): FieldKind {
  if (c.choices && c.choices.length > 0) return 'choice';
  if (c.ref_table) return (OPTION_TABLES as readonly string[]).includes(c.ref_table) ? 'ref' : 'number-id';
  if (c.type === 'boolean') return 'boolean';
  if (c.type === 'date') return 'date';
  if (c.type.startsWith('timestamp')) return 'datetime';
  if (['smallint', 'integer', 'bigint'].includes(c.type)) return 'integer';
  if (c.type === 'numeric' || c.type === 'double precision' || c.type === 'real') return 'decimal';
  if (c.type === 'text' || (c.max_length !== null && c.max_length > 400)) return 'longtext';
  return 'text';
}

export function humanize(name: string): string {
  const s = name.replace(/_id$/, '').replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type RawDetail = Record<string, string | boolean | undefined>;

/** Turns form strings into the jsonb payload (blank becomes null) and reports problems per column. Booleans are always sent. */
export function buildDetail(columns: DetailColumn[], raw: RawDetail): { values: Record<string, unknown>; errors: Record<string, string> } {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const c of columns) {
    const kind = fieldKind(c);
    const r = raw[c.name];
    if (kind === 'boolean') { values[c.name] = r === true || r === 'true'; continue; }
    const text = typeof r === 'string' ? r.trim() : '';
    if (text === '') {
      values[c.name] = null;
      if (c.required) errors[c.name] = 'Required';
      continue;
    }
    if (kind === 'integer' || kind === 'ref' || kind === 'number-id') {
      if (!/^-?\d{1,18}$/.test(text)) { errors[c.name] = 'Enter a whole number'; continue; }
      values[c.name] = Number(text);
    } else if (kind === 'decimal') {
      if (!/^-?\d+(\.\d+)?$/.test(text)) { errors[c.name] = 'Enter a number'; continue; }
      values[c.name] = Number(text);
    } else if (kind === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00Z`).getTime())) { errors[c.name] = 'Enter a valid date'; continue; }
      values[c.name] = text;
    } else if (kind === 'datetime') {
      const d = new Date(text);
      if (Number.isNaN(d.getTime())) { errors[c.name] = 'Enter a valid date and time'; continue; }
      values[c.name] = d.toISOString();
    } else if (kind === 'choice') {
      if (!c.choices?.includes(text)) { errors[c.name] = 'Select one of the options'; continue; }
      values[c.name] = text;
    } else {
      if (c.max_length !== null && text.length > c.max_length) { errors[c.name] = `At most ${c.max_length} characters`; continue; }
      values[c.name] = text;
    }
  }
  return { values, errors };
}

/** String form values from a stored detail row (for editing). */
export function detailToRaw(columns: DetailColumn[], detail: Record<string, unknown>): RawDetail {
  const out: RawDetail = {};
  for (const c of columns) {
    const v = detail[c.name];
    out[c.name] = fieldKind(c) === 'boolean' ? v === true : v === null || v === undefined ? '' : fieldKind(c) === 'datetime' ? String(v).slice(0, 16) : String(v);
  }
  return out;
}

export const label = (code: string) => {
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
