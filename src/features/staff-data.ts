import type { SupabaseClient } from '@supabase/supabase-js';
import type { Evidence, Opt } from '@/features/activity-data';
import type { DetailColumn, ListParams } from '@/lib/staff-validation';

export const STAFF_PAGE_SIZE = 20;

export type StaffRow = {
  staff_activity_id: number; employee_id: number; employee_number: string; staff_name: string; type_name: string; activity_group: string; activity_title: string; start_date: string | null;
  verification_status: string; approval_status: string; evidence_count: number; total_count: number;
};
export type Contributor = { contributor_id: number; name: string; is_employee: boolean; role: string | null; affiliation: string | null; is_corresponding: boolean };
export type StaffDetail = {
  staff_activity_id: number; employee_id: number; employee_number: string; staff_name: string; activity_type_id: number; type_name: string; activity_group: string; academic_year_id: number | null;
  participation_level_id: number | null; primary_role_type_id: number | null; activity_title: string; start_date: string | null; end_date: string | null; description: string | null; outcomes: string | null;
  verification_status: string; verification_remarks: string | null; approval_status: string; approval_remarks: string | null; rejection_reason: string | null; detail_table: string | null;
  detail: Record<string, unknown>; is_owner: boolean; can_edit: boolean; can_delete: boolean; can_verify: boolean; can_approve: boolean; contributors: Contributor[]; evidence: Evidence[];
};
export type DetailSchema = { table: string | null; columns: DetailColumn[] };
export type ReportRow = { activity_group: string; approval_status: string; records: number; employees: number };
export type ActivityTypeOpt = Opt & { group: string };

export async function listStaffActivities(supabase: SupabaseClient, p: ListParams) {
  const { data, error } = await supabase.rpc('staff_activity_list', { p_employee_id: null, p_search: p.q ?? null, p_approval: p.status ?? null, p_group: p.group ?? null, p_limit: STAFF_PAGE_SIZE, p_offset: (p.page - 1) * STAFF_PAGE_SIZE });
  const rows = (data ?? []) as StaffRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function getStaffActivity(supabase: SupabaseClient, id: number): Promise<StaffDetail | null> {
  const { data, error } = await supabase.rpc('staff_activity_get', { p_activity_id: id });
  return error || !data ? null : (data as StaffDetail);
}
export async function getStaffReport(supabase: SupabaseClient): Promise<ReportRow[]> {
  const { data } = await supabase.rpc('staff_activity_report', { p_year: null });
  return ((data ?? []) as ReportRow[]).map((r) => ({ ...r, records: Number(r.records), employees: Number(r.employees) }));
}
export async function listStaffTypes(supabase: SupabaseClient): Promise<ActivityTypeOpt[]> {
  const { data } = await supabase.from('activity_type').select('activity_type_id, activity_type_name, activity_group').eq('is_active', true).order('activity_type_name');
  return ((data ?? []) as { activity_type_id: number; activity_type_name: string; activity_group: string }[]).map((t) => ({ id: t.activity_type_id, label: t.activity_type_name, group: t.activity_group }));
}
export async function listRoleTypes(supabase: SupabaseClient): Promise<Opt[]> {
  const { data } = await supabase.from('role_type').select('role_type_id, role_name').order('role_name');
  return ((data ?? []) as { role_type_id: number; role_name: string }[]).map((r) => ({ id: r.role_type_id, label: r.role_name }));
}
export async function listEvidenceTypesStaff(supabase: SupabaseClient): Promise<Opt[]> {
  const { data } = await supabase.from('evidence_type').select('evidence_type_id, evidence_type_name').eq('is_active', true).order('evidence_type_name');
  return ((data ?? []) as { evidence_type_id: number; evidence_type_name: string }[]).map((r) => ({ id: r.evidence_type_id, label: r.evidence_type_name }));
}
export function parseStaffId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
