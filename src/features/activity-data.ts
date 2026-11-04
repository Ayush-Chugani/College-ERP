import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListParams } from '@/lib/activity-validation';

export const ACT_PAGE_SIZE = 20;

export type ActivityRow = {
  student_activity_id: number; student_id: number; student_number: string; student_name: string; type_name: string; activity_title: string; achievement_type: string; start_date: string | null;
  verification_status: string; approval_status: string; evidence_count: number; total_count: number;
};
export type Evidence = { evidence_id: number; title: string; evidence_type: string | null; version: number; file_name: string; size: number; issued: string | null; authority: string | null; certificate_number: string | null };
export type TeamMember = { member_id: number; name: string; is_student: boolean; role: string | null; is_lead: boolean };
export type ActivityDetail = {
  student_activity_id: number; student_id: number; student_number: string; student_name: string; student_activity_type_id: number; type_name: string; requires_team_details: boolean;
  academic_year_id: number | null; participation_level_id: number | null; event_mode_id: number | null; organizer_name: string | null; activity_title: string; event_name: string | null; team_name: string | null;
  participation_role: string | null; start_date: string | null; end_date: string | null; venue_name: string | null; city: string | null; achievement_type: string; position_rank: number | null; award_name: string | null;
  activity_url: string | null; description: string | null; outcomes: string | null; verification_status: string; verification_remarks: string | null; approval_status: string; approval_remarks: string | null;
  rejection_reason: string | null; is_owner: boolean; can_edit: boolean; can_delete: boolean; can_verify: boolean; can_approve: boolean; team: TeamMember[]; evidence: Evidence[];
};
export type Opt = { id: number; label: string };
export type ReportRow = { type_name: string; approval_status: string; activities: number; winners: number };

export async function listActivities(supabase: SupabaseClient, p: ListParams) {
  const { data, error } = await supabase.rpc('student_activity_list', { p_student_id: null, p_search: p.q ?? null, p_approval: p.status ?? null, p_limit: ACT_PAGE_SIZE, p_offset: (p.page - 1) * ACT_PAGE_SIZE });
  const rows = (data ?? []) as ActivityRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function getActivity(supabase: SupabaseClient, id: number): Promise<ActivityDetail | null> {
  const { data, error } = await supabase.rpc('student_activity_get', { p_activity_id: id });
  return error || !data ? null : (data as ActivityDetail);
}
export async function getReport(supabase: SupabaseClient): Promise<ReportRow[]> {
  const { data } = await supabase.rpc('student_activity_report', { p_year: null });
  return ((data ?? []) as ReportRow[]).map((r) => ({ ...r, activities: Number(r.activities), winners: Number(r.winners) }));
}
async function opts(supabase: SupabaseClient, table: string, id: string, name: string, onlyActive: boolean): Promise<Opt[]> {
  let q = supabase.from(table).select(`${id}, ${name}`).order(name).limit(500);
  if (onlyActive) q = q.eq('is_active', true);
  const { data } = await q;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ id: Number(r[id]), label: String(r[name]) }));
}
export const listActivityTypes = (s: SupabaseClient) => opts(s, 'student_activity_type', 'student_activity_type_id', 'type_name', true);
export const listEvidenceTypes = (s: SupabaseClient) => opts(s, 'evidence_type', 'evidence_type_id', 'evidence_type_name', true);
export async function listYears(s: SupabaseClient): Promise<Opt[]> {
  const { data } = await s.from('academic_year').select('academic_year_id, year_code').order('year_code', { ascending: false }).limit(50);
  return ((data ?? []) as { academic_year_id: number; year_code: string }[]).map((r) => ({ id: r.academic_year_id, label: r.year_code }));
}
export async function listLevels(s: SupabaseClient): Promise<Opt[]> {
  const { data } = await s.from('participation_level').select('participation_level_id, level_name').order('display_order');
  return ((data ?? []) as { participation_level_id: number; level_name: string }[]).map((r) => ({ id: r.participation_level_id, label: r.level_name }));
}
export async function listModes(s: SupabaseClient): Promise<Opt[]> {
  const { data } = await s.from('event_mode').select('event_mode_id, mode_name').order('mode_name');
  return ((data ?? []) as { event_mode_id: number; mode_name: string }[]).map((r) => ({ id: r.event_mode_id, label: r.mode_name }));
}
export function parseActId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
