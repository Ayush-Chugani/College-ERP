import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApplicationListParams } from '@/lib/admission-validation';

export const ADMISSION_PAGE_SIZE = 20;
export type Opt = { id: number; label: string };

export type ApplicationRow = {
  application_id: number;
  application_number: string;
  admission_applicant_id: number;
  admitted_student_id: number | null;
  programme_id: number;
  academic_year_id: number;
  admission_category_id: number | null;
  application_date: string;
  application_status: string;
  eligibility_status: string;
  remarks: string | null;
  applicant_name?: string | null;
  programme_name?: string | null;
};
export type ApplicantRow = {
  admission_applicant_id: number;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  display_name: string;
  date_of_birth: string | null;
  gender_id: number | null;
  primary_email: string | null;
  primary_phone: string | null;
  nationality_country_id: number | null;
  social_category_id: number | null;
};

const APP_COLS = 'application_id, application_number, admission_applicant_id, admitted_student_id, programme_id, academic_year_id, admission_category_id, application_date, application_status, eligibility_status, remarks';
const APPLICANT_COLS = 'admission_applicant_id, first_name, middle_name, last_name, display_name, date_of_birth, gender_id, primary_email, primary_phone, nationality_country_id, social_category_id';

async function nameMap(supabase: SupabaseClient, table: string, idCol: string, nameCol: string, ids: number[]) {
  const m = new Map<number, string>();
  if (ids.length === 0) return m;
  const { data } = await supabase.from(table).select(`${idCol}, ${nameCol}`).in(idCol, ids);
  ((data ?? []) as unknown as Record<string, string | number>[]).forEach((r) => m.set(Number(r[idCol]), String(r[nameCol])));
  return m;
}

/** Search matches the application number or the applicant's name. Visibility is decided by RLS. */
export async function listApplications(supabase: SupabaseClient, p: ApplicationListParams) {
  const from = (p.page - 1) * ADMISSION_PAGE_SIZE;
  let q = supabase.from('admission_application').select(APP_COLS, { count: 'exact' }).order('application_date', { ascending: false }).order('application_id', { ascending: false }).range(from, from + ADMISSION_PAGE_SIZE - 1);
  if (p.status) q = q.eq('application_status', p.status);
  if (p.programme) q = q.eq('programme_id', p.programme);
  if (p.year) q = q.eq('academic_year_id', p.year);
  if (p.q) {
    // p.q is sanitised by applicationListParams, so it carries no filter syntax
    const { data: matches } = await supabase.from('admission_applicant').select('admission_applicant_id').ilike('display_name', `%${p.q}%`).limit(200);
    const ids = ((matches ?? []) as { admission_applicant_id: number }[]).map((m) => m.admission_applicant_id);
    q = q.or(ids.length ? `application_number.ilike.%${p.q}%,admission_applicant_id.in.(${ids.join(',')})` : `application_number.ilike.%${p.q}%`);
  }
  const { data, count, error } = await q;
  const rows = (data ?? []) as unknown as ApplicationRow[];
  const uniq = (xs: number[]) => [...new Set(xs)];
  const [applicants, programmes] = await Promise.all([
    nameMap(supabase, 'admission_applicant', 'admission_applicant_id', 'display_name', uniq(rows.map((r) => r.admission_applicant_id))),
    nameMap(supabase, 'programme', 'programme_id', 'programme_name', uniq(rows.map((r) => r.programme_id))),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, applicant_name: applicants.get(r.admission_applicant_id) ?? null, programme_name: programmes.get(r.programme_id) ?? null })),
    total: count ?? 0,
    error: error?.message ?? null,
  };
}

export async function getApplication(supabase: SupabaseClient, id: number): Promise<ApplicationRow | null> {
  const { data } = await supabase.from('admission_application').select(APP_COLS).eq('application_id', id).maybeSingle();
  return (data as unknown as ApplicationRow | null) ?? null;
}
export async function getApplicant(supabase: SupabaseClient, id: number): Promise<ApplicantRow | null> {
  const { data } = await supabase.from('admission_applicant').select(APPLICANT_COLS).eq('admission_applicant_id', id).maybeSingle();
  return (data as unknown as ApplicantRow | null) ?? null;
}
export async function getStudentLabel(supabase: SupabaseClient, id: number): Promise<{ number: string; name: string } | null> {
  const { data } = await supabase.from('student').select('student_number, display_name').eq('student_id', id).maybeSingle();
  return data ? { number: (data as { student_number: string }).student_number, name: (data as { display_name: string }).display_name } : null;
}

async function options(supabase: SupabaseClient, table: string, idCol: string, labelCol: string, filter?: { col: string; val: boolean }): Promise<Opt[]> {
  let q = supabase.from(table).select(`${idCol}, ${labelCol}`).order(labelCol).limit(500);
  if (filter) q = q.eq(filter.col, filter.val);
  const { data } = await q;
  return ((data ?? []) as unknown as Record<string, string | number>[]).map((r) => ({ id: Number(r[idCol]), label: String(r[labelCol]) }));
}

export type AdmissionLookups = {
  programmes: Opt[];
  years: Opt[];
  categories: Opt[];
  semesters: Opt[];
  genders: Opt[];
  countries: Opt[];
  socialCategories: Opt[];
  schemes: (Opt & { programmeId: number })[];
};

export async function loadAdmissionLookups(supabase: SupabaseClient): Promise<AdmissionLookups> {
  const [programmes, years, categories, semesters, genders, countries, socialCategories, schemeRes] = await Promise.all([
    options(supabase, 'programme', 'programme_id', 'programme_name'),
    options(supabase, 'academic_year', 'academic_year_id', 'year_code'),
    options(supabase, 'admission_category', 'admission_category_id', 'category_name', { col: 'is_active', val: true }),
    options(supabase, 'semester', 'semester_id', 'semester_name'),
    options(supabase, 'gender', 'gender_id', 'gender_name'),
    options(supabase, 'country', 'country_id', 'country_name'),
    options(supabase, 'social_category', 'social_category_id', 'category_name'),
    supabase.from('curriculum_scheme').select('curriculum_scheme_id, scheme_name, programme_id').order('scheme_name').limit(500),
  ]);
  const schemes = ((schemeRes.data ?? []) as { curriculum_scheme_id: number; scheme_name: string; programme_id: number }[]).map((s) => ({ id: s.curriculum_scheme_id, label: s.scheme_name, programmeId: s.programme_id }));
  return { programmes, years, categories, semesters, genders, countries, socialCategories, schemes };
}

export async function listAdmissionCategories(supabase: SupabaseClient) {
  const { data } = await supabase.from('admission_category').select('admission_category_id, category_code, category_name, description, is_active').order('category_name');
  return (data ?? []) as { admission_category_id: number; category_code: string; category_name: string; description: string | null; is_active: boolean }[];
}

export function parseApplicationId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
