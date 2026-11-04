import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListParams } from '@/lib/communication-validation';

export const COMM_PAGE_SIZE = 20;

export type FeedItem = { announcement_id: number; title: string; description: string; type_name: string; department_name: string | null; publish_from: string; publish_to: string | null };
export type ManageRow = {
  announcement_id: number; title: string; type_name: string; department_name: string | null; audience_type: string; approval_status: string; publish_from: string; publish_to: string | null; is_mine: boolean; total_count: number;
};
export type Detail = {
  announcement_id: number; title: string; description: string; type_id: number; type_name: string; department_id: number | null; department_name: string | null; audience_type: string;
  approval_status: string; publish_from: string; publish_to: string | null; is_mine: boolean; managed: boolean; can_edit: boolean; can_submit: boolean; can_decide: boolean; can_archive: boolean;
};
export type Opt = { id: number; label: string };

export async function getFeed(supabase: SupabaseClient, limit = 30): Promise<FeedItem[]> {
  const { data } = await supabase.rpc('announcements_feed', { p_limit: limit });
  return (data ?? []) as FeedItem[];
}
export async function listManaged(supabase: SupabaseClient, p: ListParams) {
  const { data, error } = await supabase.rpc('announcements_manage', { p_status: p.status ?? null, p_search: p.q ?? null, p_limit: COMM_PAGE_SIZE, p_offset: (p.page - 1) * COMM_PAGE_SIZE });
  const rows = (data ?? []) as ManageRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function getDetail(supabase: SupabaseClient, id: number): Promise<Detail | null> {
  const { data, error } = await supabase.rpc('announcement_detail', { p_id: id });
  return error || !data ? null : (data as Detail);
}
export async function loadEditorLookups(supabase: SupabaseClient) {
  const [types, targets, global] = await Promise.all([
    supabase.from('announcement_type').select('announcement_type_id, type_name').eq('is_active', true).order('type_name'),
    supabase.rpc('announcement_targets'),
    supabase.rpc('announcement_can_post_global'),
  ]);
  return {
    types: ((types.data ?? []) as { announcement_type_id: number; type_name: string }[]).map((t) => ({ id: t.announcement_type_id, label: t.type_name })),
    departments: ((targets.data ?? []) as { department_id: number; department_name: string }[]).map((d) => ({ id: d.department_id, label: d.department_name })),
    canPostGlobal: global.data === true,
  };
}
export async function listTypes(supabase: SupabaseClient) {
  const { data } = await supabase.from('announcement_type').select('announcement_type_id, type_code, type_name, is_active').order('type_name');
  return (data ?? []) as { announcement_type_id: number; type_code: string; type_name: string; is_active: boolean }[];
}
export function parseAnnId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
