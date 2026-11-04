import { z } from 'zod';

/** One model drives validation, forms, payloads and permission hints for the five hierarchy entities. */
export const KINDS = ['universities', 'institutions', 'campuses', 'departments', 'programmes'] as const;
export type Kind = (typeof KINDS)[number];

export type FieldDef =
  | { name: string; label: string; type: 'text'; max: number; required?: boolean; hint?: string }
  | { name: string; label: string; type: 'email' | 'url' | 'phone'; max: number }
  | { name: string; label: string; type: 'enum'; values: readonly string[]; required: true }
  | { name: string; label: string; type: 'int'; min: number; max: number; required?: boolean }
  | { name: string; label: string; type: 'bool' };

export type KindConfig = {
  kind: Kind;
  table: 'university' | 'institution' | 'campus' | 'department' | 'programme';
  pk: string;
  singular: string;
  plural: string;
  labelColumn: string;
  codeColumn: string;
  /** parent entity this row belongs to (immutable once created) */
  parent?: { kind: Kind; column: string; label: string };
  child?: { kind: Kind; label: string };
  fields: FieldDef[];
  /** permission codes used to show/hide actions; the database enforces access */
  perms: { create: string; update: string; delete?: string };
  /** institutions are written through RPCs because they have no client write policy */
  viaRpc?: boolean;
};

const CONTACT: FieldDef[] = [
  { name: 'website_url', label: 'Website', type: 'url', max: 255 },
  { name: 'email', label: 'Email', type: 'email', max: 254 },
  { name: 'phone', label: 'Phone', type: 'phone', max: 25 },
];
const ADDRESS: FieldDef[] = [
  { name: 'address_line_1', label: 'Address line 1', type: 'text', max: 200 },
  { name: 'address_line_2', label: 'Address line 2', type: 'text', max: 200 },
  { name: 'city', label: 'City', type: 'text', max: 100 },
  { name: 'postal_code', label: 'Postal code', type: 'text', max: 12 },
];

export const UNIVERSITY_TYPES = ['CENTRAL', 'STATE', 'PRIVATE', 'DEEMED', 'OTHER'] as const;
export const PROGRAMME_LEVELS = ['UG', 'PG', 'DIPLOMA', 'CERTIFICATE', 'DOCTORAL', 'OTHER'] as const;

export const CONFIG: Record<Kind, KindConfig> = {
  universities: {
    kind: 'universities', table: 'university', pk: 'university_id', singular: 'university', plural: 'Universities', labelColumn: 'university_name', codeColumn: 'university_code',
    child: { kind: 'institutions', label: 'institution' },
    perms: { create: 'INSTITUTION.ALL.CONFIGURE', update: 'INSTITUTION.ALL.CONFIGURE', delete: 'INSTITUTION.ALL.CONFIGURE' },
    fields: [
      { name: 'university_code', label: 'Code', type: 'text', max: 30, required: true },
      { name: 'university_name', label: 'Name', type: 'text', max: 200, required: true },
      { name: 'legal_name', label: 'Legal name', type: 'text', max: 250 },
      { name: 'university_type', label: 'Type', type: 'enum', values: UNIVERSITY_TYPES, required: true },
      ...CONTACT,
      ...ADDRESS,
      { name: 'is_active', label: 'Active', type: 'bool' },
    ],
  },
  institutions: {
    kind: 'institutions', table: 'institution', pk: 'institution_id', singular: 'institution', plural: 'Institutions', labelColumn: 'institution_name', codeColumn: 'institution_code',
    parent: { kind: 'universities', column: 'university_id', label: 'University' }, child: { kind: 'campuses', label: 'campus' }, viaRpc: true,
    perms: { create: 'INSTITUTION.ALL.CREATE', update: 'INSTITUTION.ALL.UPDATE' },
    fields: [
      { name: 'institution_code', label: 'Code', type: 'text', max: 20, required: true },
      { name: 'institution_name', label: 'Name', type: 'text', max: 200, required: true },
      { name: 'legal_name', label: 'Legal name', type: 'text', max: 250 },
      ...CONTACT,
      { name: 'is_active', label: 'Active', type: 'bool' },
    ],
  },
  campuses: {
    kind: 'campuses', table: 'campus', pk: 'campus_id', singular: 'campus', plural: 'Campuses', labelColumn: 'campus_name', codeColumn: 'campus_code',
    parent: { kind: 'institutions', column: 'institution_id', label: 'Institution' }, child: { kind: 'departments', label: 'department' },
    perms: { create: 'INSTITUTION.ALL.CREATE', update: 'INSTITUTION.ALL.UPDATE', delete: 'INSTITUTION.ALL.DELETE' },
    fields: [
      { name: 'campus_code', label: 'Code', type: 'text', max: 20, required: true },
      { name: 'campus_name', label: 'Name', type: 'text', max: 150, required: true },
      ...ADDRESS,
      { name: 'phone', label: 'Phone', type: 'phone', max: 25 },
      { name: 'email', label: 'Email', type: 'email', max: 254 },
      { name: 'is_active', label: 'Active', type: 'bool' },
    ],
  },
  departments: {
    kind: 'departments', table: 'department', pk: 'department_id', singular: 'department', plural: 'Departments', labelColumn: 'department_name', codeColumn: 'department_code',
    parent: { kind: 'campuses', column: 'campus_id', label: 'Campus' }, child: { kind: 'programmes', label: 'programme' },
    perms: { create: 'INSTITUTION.ALL.CREATE', update: 'INSTITUTION.ALL.UPDATE', delete: 'INSTITUTION.ALL.DELETE' },
    fields: [
      { name: 'department_code', label: 'Code', type: 'text', max: 20, required: true },
      { name: 'department_name', label: 'Name', type: 'text', max: 150, required: true },
      { name: 'department_type', label: 'Type', type: 'text', max: 30 },
      { name: 'is_active', label: 'Active', type: 'bool' },
    ],
  },
  programmes: {
    kind: 'programmes', table: 'programme', pk: 'programme_id', singular: 'programme', plural: 'Programmes', labelColumn: 'programme_name', codeColumn: 'programme_code',
    parent: { kind: 'departments', column: 'department_id', label: 'Department' },
    perms: { create: 'INSTITUTION.ALL.CREATE', update: 'INSTITUTION.ALL.UPDATE', delete: 'INSTITUTION.ALL.DELETE' },
    fields: [
      { name: 'programme_code', label: 'Code', type: 'text', max: 30, required: true },
      { name: 'programme_name', label: 'Name', type: 'text', max: 150, required: true },
      { name: 'award_name', label: 'Award', type: 'text', max: 150 },
      { name: 'programme_level', label: 'Level', type: 'enum', values: PROGRAMME_LEVELS, required: true },
      { name: 'duration_semesters', label: 'Duration (semesters)', type: 'int', min: 1, max: 255, required: true },
      { name: 'maximum_duration_semesters', label: 'Maximum duration (semesters)', type: 'int', min: 1, max: 255 },
      { name: 'is_active', label: 'Active', type: 'bool' },
    ],
  },
};

export function parseKind(slug: string): Kind | null {
  return (KINDS as readonly string[]).includes(slug) ? (slug as Kind) : null;
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function fieldSchema(f: FieldDef): z.ZodTypeAny {
  switch (f.type) {
    case 'text':
      return f.required
        ? z.string().trim().min(1, `${f.label} is required`).max(f.max, `At most ${f.max} characters`)
        : z.string().trim().max(f.max, `At most ${f.max} characters`).optional();
    case 'email':
      return z.string().trim().max(f.max).optional().refine((v) => blank(v) || z.string().email().safeParse(v).success, 'Enter a valid email');
    case 'url':
      return z.string().trim().max(f.max).optional().refine((v) => blank(v) || /^https?:\/\/[^\s]+$/i.test(v as string), 'Must start with http:// or https://');
    case 'phone':
      return z.string().trim().optional().refine((v) => blank(v) || /^[0-9+()\-\s]{6,25}$/.test(v as string), 'Enter a valid phone number (6–25 digits or + ( ) -)');
    case 'enum':
      return z.enum(f.values as [string, ...string[]], { message: `Select ${f.label.toLowerCase()}` });
    case 'int':
      return z
        .string()
        .optional()
        .refine((v) => !f.required || !blank(v), `${f.label} is required`)
        .refine((v) => blank(v) || (/^\d+$/.test((v as string).trim()) && Number(v) >= f.min && Number(v) <= f.max), `Enter a whole number from ${f.min} to ${f.max}`);
    case 'bool':
      return z.boolean();
  }
}

/** Zod schema for a kind's form. The parent column is only part of the schema when creating. */
export function buildSchema(kind: Kind, mode: 'create' | 'edit') {
  const cfg = CONFIG[kind];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of cfg.fields) shape[f.name] = fieldSchema(f);
  if (cfg.parent && mode === 'create') {
    shape[cfg.parent.column] = z.string().min(1, `Select ${cfg.parent.label.toLowerCase()}`).refine((v) => /^\d+$/.test(v) && Number(v) > 0, `Select ${cfg.parent.label.toLowerCase()}`);
  }
  return z.object(shape).superRefine((v, ctx) => {
    if (kind === 'programmes') {
      const d = Number(v.duration_semesters);
      const m = blank(v.maximum_duration_semesters) ? undefined : Number(v.maximum_duration_semesters);
      if (m !== undefined && Number.isFinite(d) && m < d) ctx.addIssue({ code: 'custom', path: ['maximum_duration_semesters'], message: 'Maximum cannot be less than the normal duration' });
    }
  });
}

/** Turn validated form values into a DB/RPC payload: blanks become null, numbers become numbers. */
export function toPayload(kind: Kind, values: Record<string, unknown>, mode: 'create' | 'edit'): Record<string, unknown> {
  const cfg = CONFIG[kind];
  const out: Record<string, unknown> = {};
  for (const f of cfg.fields) {
    const v = values[f.name];
    if (f.type === 'bool') out[f.name] = Boolean(v);
    else if (f.type === 'int') out[f.name] = blank(v) ? null : Number(v);
    else if (f.type === 'enum') out[f.name] = v;
    else out[f.name] = blank(v) ? null : String(v).trim();
  }
  if (cfg.parent && mode === 'create') out[cfg.parent.column] = Number(values[cfg.parent.column]);
  return out;
}

export function defaultValues(kind: Kind): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of CONFIG[kind].fields) out[f.name] = f.type === 'bool' ? true : f.type === 'enum' ? (f.name === 'university_type' ? 'OTHER' : '') : '';
  return out;
}

export const SLUG_FOR = (kind: Kind) => kind;
export const hrefFor = (kind: Kind, id?: number) => `/structure/${kind}${id ? `/${id}` : ''}`;
