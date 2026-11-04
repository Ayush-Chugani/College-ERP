import type { SupabaseClient } from '@supabase/supabase-js';
import type { SchemeListParams } from '@/lib/academic-validation';

export const SCHEME_PAGE_SIZE = 20;

export type YearRow = { academic_year_id: number; year_code: string; start_date: string; end_date: string; status: string };
export type TermRow = {
  academic_term_id: number;
  academic_year_id: number;
  term_code: string;
  term_name: string;
  term_type: string;
  start_date: string;
  end_date: string;
  registration_start_date: string | null;
  registration_end_date: string | null;
  status: string;
};
export type SemesterRow = { semester_id: number; semester_number: number; semester_name: string };
export type SchemeRow = {
  curriculum_scheme_id: number;
  programme_id: number;
  scheme_code: string;
  scheme_name: string;
  regulation_year: number;
  total_credits: number | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  programme_name?: string | null;
};

const YEAR_COLS = 'academic_year_id, year_code, start_date, end_date, status';
const TERM_COLS = 'academic_term_id, academic_year_id, term_code, term_name, term_type, start_date, end_date, registration_start_date, registration_end_date, status';
const SCHEME_COLS = 'curriculum_scheme_id, programme_id, scheme_code, scheme_name, regulation_year, total_credits, effective_from, effective_to, status';

export async function listYears(supabase: SupabaseClient): Promise<YearRow[]> {
  const { data } = await supabase.from('academic_year').select(YEAR_COLS).order('start_date', { ascending: false }).limit(200);
  return (data ?? []) as YearRow[];
}
export async function getYear(supabase: SupabaseClient, id: number): Promise<YearRow | null> {
  const { data } = await supabase.from('academic_year').select(YEAR_COLS).eq('academic_year_id', id).maybeSingle();
  return (data as YearRow | null) ?? null;
}
export async function listTerms(supabase: SupabaseClient, yearId: number): Promise<TermRow[]> {
  const { data } = await supabase.from('academic_term').select(TERM_COLS).eq('academic_year_id', yearId).order('start_date');
  return (data ?? []) as TermRow[];
}
export async function getTerm(supabase: SupabaseClient, id: number): Promise<TermRow | null> {
  const { data } = await supabase.from('academic_term').select(TERM_COLS).eq('academic_term_id', id).maybeSingle();
  return (data as TermRow | null) ?? null;
}
export async function listSemesters(supabase: SupabaseClient): Promise<SemesterRow[]> {
  const { data } = await supabase.from('semester').select('semester_id, semester_number, semester_name').order('semester_number');
  return (data ?? []) as SemesterRow[];
}

export async function listProgrammes(supabase: SupabaseClient): Promise<{ id: number; label: string }[]> {
  const { data } = await supabase.from('programme').select('programme_id, programme_name').order('programme_name').limit(500);
  return ((data ?? []) as { programme_id: number; programme_name: string }[]).map((p) => ({ id: p.programme_id, label: p.programme_name }));
}

export async function listSchemes(supabase: SupabaseClient, p: SchemeListParams) {
  const from = (p.page - 1) * SCHEME_PAGE_SIZE;
  let q = supabase
    .from('curriculum_scheme')
    .select(SCHEME_COLS, { count: 'exact' })
    .order('scheme_code')
    .range(from, from + SCHEME_PAGE_SIZE - 1);
  if (p.programme) q = q.eq('programme_id', p.programme);
  if (p.status) q = q.eq('status', p.status);
  if (p.q) q = q.or(`scheme_name.ilike.%${p.q}%,scheme_code.ilike.%${p.q}%`); // p.q is sanitised by schemeListParams
  const { data, count, error } = await q;
  const rows = (data ?? []) as SchemeRow[];
  const ids = [...new Set(rows.map((r) => r.programme_id))];
  const names = new Map<number, string>();
  if (ids.length) {
    const { data: progs } = await supabase.from('programme').select('programme_id, programme_name').in('programme_id', ids);
    ((progs ?? []) as { programme_id: number; programme_name: string }[]).forEach((x) => names.set(x.programme_id, x.programme_name));
  }
  return { rows: rows.map((r) => ({ ...r, programme_name: names.get(r.programme_id) ?? null })), total: count ?? 0, error: error?.message ?? null };
}
export async function getScheme(supabase: SupabaseClient, id: number): Promise<SchemeRow | null> {
  const { data } = await supabase.from('curriculum_scheme').select(SCHEME_COLS).eq('curriculum_scheme_id', id).maybeSingle();
  return (data as SchemeRow | null) ?? null;
}

export function parseId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
