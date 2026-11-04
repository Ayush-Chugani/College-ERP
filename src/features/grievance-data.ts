import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListParams } from '@/lib/grievance-validation';

export const GRV_PAGE_SIZE = 20;

export type ListRow = {
  grievance_id: number; grievance_number: string; student_number: string; student_name: string; category_name: string; subject: string; priority: string; status: string; submitted_at: string; total_count: number;
};
export type MyRow = { grievance_id: number; grievance_number: string; category_name: string; subject: string; priority: string; status: string; submitted_at: string; resolved_at: string | null };
export type Detail = {
  grievance_id: number; grievance_number: string; student_number: string; student_name: string; category_name: string; department_name: string | null; subject: string; description: string;
  priority: string; status: string; submitted_at: string; resolved_at: string | null; resolution: string | null; is_owner: boolean; can_act: boolean;
  actions: { action_at: string; action_type: string; action_notes: string | null; new_status: string | null }[];
};
export type Opt = { id: number; label: string };

export async function listGrievances(supabase: SupabaseClient, p: ListParams) {
  const { data, error } = await supabase.rpc('grievance_list', { p_search: p.q ?? null, p_status: p.status ?? null, p_priority: p.priority ?? null, p_limit: GRV_PAGE_SIZE, p_offset: (p.page - 1) * GRV_PAGE_SIZE });
  const rows = (data ?? []) as ListRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function getMyGrievances(supabase: SupabaseClient): Promise<MyRow[]> {
  const { data } = await supabase.rpc('grievance_my');
  return (data ?? []) as MyRow[];
}
export async function getDetail(supabase: SupabaseClient, id: number): Promise<Detail | null> {
  const { data, error } = await supabase.rpc('grievance_detail', { p_grievance_id: id });
  return error || !data ? null : (data as Detail);
}
export async function listCategories(supabase: SupabaseClient, onlyActive: boolean) {
  let q = supabase.from('grievance_category').select('grievance_category_id, category_code, category_name, is_active').order('category_name');
  if (onlyActive) q = q.eq('is_active', true);
  const { data } = await q;
  return (data ?? []) as { grievance_category_id: number; category_code: string; category_name: string; is_active: boolean }[];
}
export async function listDepartments(supabase: SupabaseClient): Promise<Opt[]> {
  const { data } = await supabase.from('department').select('department_id, department_name').order('department_name').limit(500);
  return ((data ?? []) as { department_id: number; department_name: string }[]).map((d) => ({ id: d.department_id, label: d.department_name }));
}
export function parseGrvId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
