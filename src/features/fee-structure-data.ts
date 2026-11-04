import type { SupabaseClient } from '@supabase/supabase-js';
import type { Opt, StructureDetail, StructureLookups } from '@/features/fee-structures';

export type StructureRow = { fee_structure_id: number; structure_code: string; structure_name: string; institution_name: string; programme_name: string | null; year_code: string; version_number: number; approval_status: string; effective_from: string; effective_to: string | null; item_count: number; total_amount: number; total_count: number };
export const STRUCTURE_PAGE = 20;

export async function loadLookups(supabase: SupabaseClient): Promise<StructureLookups> {
  const [i, p, d, cp, y, c, t, s, l] = await Promise.all([
    supabase.from('institution').select('institution_id, institution_name').order('institution_name').limit(500),
    supabase.from('programme').select('programme_id, programme_name, department_id').order('programme_name').limit(1000),
    supabase.from('department').select('department_id, campus_id').limit(2000),
    supabase.from('campus').select('campus_id, institution_id').limit(500),
    supabase.rpc('fin_academic_years'),
    supabase.from('admission_category').select('admission_category_id, category_name').order('category_name'),
    supabase.from('fee_type').select('fee_type_id, fee_code, fee_name').eq('is_active', true).order('fee_name'),
    supabase.from('semester').select('semester_id, semester_name').order('semester_number'),
    supabase.from('late_fee_rule').select('late_fee_rule_id, rule_name').eq('is_active', true).order('rule_name'),
  ]);
  const rows = <T,>(r: { data: unknown }) => (r.data ?? []) as T[];
  const campusInst = new Map(rows<{ campus_id: number; institution_id: number }>(cp).map((x) => [x.campus_id, x.institution_id]));
  const deptInst = new Map(rows<{ department_id: number; campus_id: number }>(d).map((x) => [x.department_id, campusInst.get(x.campus_id)]));
  return {
    institutions: rows<{ institution_id: number; institution_name: string }>(i).map((x): Opt => ({ id: x.institution_id, label: x.institution_name })),
    programmes: rows<{ programme_id: number; programme_name: string; department_id: number }>(p).map((x): Opt => ({ id: x.programme_id, label: x.programme_name, parent: deptInst.get(x.department_id) })),
    years: rows<{ academic_year_id: number; year_code: string }>(y).map((x): Opt => ({ id: x.academic_year_id, label: x.year_code })),
    categories: rows<{ admission_category_id: number; category_name: string }>(c).map((x): Opt => ({ id: x.admission_category_id, label: x.category_name })),
    feeTypes: rows<{ fee_type_id: number; fee_code: string; fee_name: string }>(t).map((x): Opt => ({ id: x.fee_type_id, label: `${x.fee_code} — ${x.fee_name}` })),
    semesters: rows<{ semester_id: number; semester_name: string }>(s).map((x): Opt => ({ id: x.semester_id, label: x.semester_name })),
    lateRules: rows<{ late_fee_rule_id: number; rule_name: string }>(l).map((x): Opt => ({ id: x.late_fee_rule_id, label: x.rule_name })),
  };
}
export async function listStructures(supabase: SupabaseClient, q: string | null, status: string | null, page: number) {
  const { data, error } = await supabase.rpc('fin_structure_list', { p_search: q, p_status: status, p_limit: STRUCTURE_PAGE, p_offset: (page - 1) * STRUCTURE_PAGE });
  const rows = (data ?? []) as StructureRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function getStructure(supabase: SupabaseClient, id: number): Promise<StructureDetail | null> {
  const { data, error } = await supabase.rpc('fin_structure_get', { p_id: id });
  return error || !data ? null : (data as StructureDetail);
}
