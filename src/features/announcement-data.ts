import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListParams } from '@/lib/announcement-validation';

export const ANN_PAGE_SIZE = 20;

export type ManageRow = { announcement_id: number; title: string; type_name: string; department_name: string | null; audience_type: string; approval_status: string; publish_from: string; publish_to: string | null; total_count: number };
export type FeedRow = { announcement_id: number; title: string; description: string; type_name: string; department_name: string | null; publish_from: string };
export type Detail = {
  announcement_id: number; announcement_type_id: number; department_id: number | null; title: string; description: string; publish_from: string; publish_to: string | null;
  approval_status: string; audience_type: string; can_update: boolean; can_approve: boolean; can_delete: boolean;
};
export type Opt = { id: number; label: string };

export async function getFeed(supabase: SupabaseClient): Promise<FeedRow[]> {
  const { data } = await supabase.rpc('announcement_feed', { p_limit: 50 });
  return (data ?? []) as FeedRow[];
}
export async function listManaged(supabase: SupabaseClient, p: ListParams) {
  const { data, error } = await supabase.rpc('announcement_manage_list', { p_search: p.q ?? null, p_status: p.status ?? null, p_limit: ANN_PAGE_SIZE, p_offset: (p.page - 1) * ANN_PAGE_SIZE });
  const rows = (data ?? []) as ManageRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function getAnnouncement(supabase: SupabaseClient, id: number): Promise<Detail | null> {
  const { data, error } = await supabase.rpc('announcement_get', { p_id: id });
  return error || !data ? null : (data as Detail);
}
export async function listTypes(supabase: SupabaseClient): Promise<Opt[]> {
  const { data } = await supabase.from('announcement_type').select('announcement_type_id, type_name').eq('is_active', true).order('type_name');
  return ((data ?? []) as { announcement_type_id: number; type_name: string }[]).map((t) => ({ id: t.announcement_type_id, label: t.type_name }));
}
export async function listDepartments(supabase: SupabaseClient): Promise<Opt[]> {
  const { data } = await supabase.from('department').select('department_id, department_name').order('department_name').limit(500);
  return ((data ?? []) as { department_id: number; department_name: string }[]).map((d) => ({ id: d.department_id, label: d.department_name }));
}
export function parseAnnId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
