import type { SupabaseClient } from '@supabase/supabase-js';
import { endOfDay, type AuditParams, type UserListParams } from '@/lib/iam-validation';

export const IAM_PAGE_SIZE = 20;
export const AUDIT_PAGE_SIZE = 25;

export type UserRow = { user_id: number; username: string; email: string | null; account_status: string; last_login_at: string | null; roles: string; linked_to: string; total_count: number };
export type Assignment = { assignment_id: number; role_name: string; role_code: string; scope_type: string; scope: string; status: string; valid_from: string; valid_to: string | null; reason: string | null };
export type UserDetail = { user_id: number; username: string; email: string | null; account_status: string; last_login_at: string | null; locked_until: string | null; is_self: boolean; can_update: boolean; assignments: Assignment[] };
export type RoleOpt = { role_id: number; role_code: string; role_name: string; role_level: string };
export type ScopeOpts = { INSTITUTION: { id: number; label: string }[]; CAMPUS: { id: number; label: string }[]; DEPARTMENT: { id: number; label: string }[]; PROGRAMME: { id: number; label: string }[] };
export type AuditRow = { activity_audit_id: number; activity_at: string; username: string | null; module_code: string; action_code: string; entity_name: string | null; entity_id: string | null; total_count: number };
export type AuditDetail = { activity_audit_id: number; activity_at: string; username: string | null; module_code: string; action_code: string; entity_name: string | null; entity_id: string | null; before_values: unknown; after_values: unknown; details: unknown };

export async function listUsers(supabase: SupabaseClient, p: UserListParams) {
  const { data, error } = await supabase.rpc('iam_user_list', { p_search: p.q ?? null, p_status: p.status ?? null, p_limit: IAM_PAGE_SIZE, p_offset: (p.page - 1) * IAM_PAGE_SIZE });
  const rows = (data ?? []) as UserRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function getUser(supabase: SupabaseClient, id: number): Promise<UserDetail | null> {
  const { data, error } = await supabase.rpc('iam_user_detail', { p_user_id: id });
  return error || !data ? null : (data as UserDetail);
}
export async function listRoles(supabase: SupabaseClient): Promise<RoleOpt[]> {
  const { data } = await supabase.rpc('iam_roles');
  return (data ?? []) as RoleOpt[];
}
export async function listScopes(supabase: SupabaseClient): Promise<ScopeOpts> {
  const [i, c, d, p] = await Promise.all([
    supabase.from('institution').select('institution_id, institution_name').order('institution_name').limit(500),
    supabase.from('campus').select('campus_id, campus_name').order('campus_name').limit(500),
    supabase.from('department').select('department_id, department_name').order('department_name').limit(500),
    supabase.from('programme').select('programme_id, programme_name').order('programme_name').limit(500),
  ]);
  const m = <T extends Record<string, unknown>>(rows: T[] | null, id: keyof T, name: keyof T) => (rows ?? []).map((r) => ({ id: Number(r[id]), label: String(r[name]) }));
  return { INSTITUTION: m(i.data, 'institution_id', 'institution_name'), CAMPUS: m(c.data, 'campus_id', 'campus_name'), DEPARTMENT: m(d.data, 'department_id', 'department_name'), PROGRAMME: m(p.data, 'programme_id', 'programme_name') };
}
export async function listAudit(supabase: SupabaseClient, p: AuditParams) {
  const { data, error } = await supabase.rpc('audit_list', {
    p_module: p.module || null, p_action: p.action || null, p_search: p.q ?? null, p_from: p.from ? `${p.from}T00:00:00Z` : null, p_to: p.to ? endOfDay(p.to) : null,
    p_limit: AUDIT_PAGE_SIZE, p_offset: (p.page - 1) * AUDIT_PAGE_SIZE,
  });
  const rows = (data ?? []) as AuditRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function auditModules(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.rpc('audit_modules');
  return ((data ?? []) as { module_code: string }[]).map((r) => r.module_code);
}
export async function getAudit(supabase: SupabaseClient, id: number): Promise<AuditDetail | null> {
  const { data, error } = await supabase.rpc('audit_get', { p_id: id });
  return error || !data ? null : (data as AuditDetail);
}
export function parseId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
