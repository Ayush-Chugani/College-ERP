import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssignmentListParams } from '@/lib/mentoring-validation';

export const MENTOR_PAGE_SIZE = 20;

export type AssignmentRow = {
  mentor_assignment_id: number; student_id: number; student_number: string; student_name: string; employee_id: number; mentor_name: string; start_date: string; end_date: string | null;
  assignment_status: string; session_count: number; is_mine: boolean; total_count: number;
};
export type AssignmentInfo = Omit<AssignmentRow, 'session_count' | 'total_count'> & { can_assign: boolean };
export type SessionRow = {
  counselling_session_id: number; session_date: string; session_status: string; confidentiality_level: string; follow_up_date: string | null; observations: string | null; action_plan: string | null; redacted: boolean;
};

export async function listAssignments(supabase: SupabaseClient, p: AssignmentListParams) {
  const { data, error } = await supabase.rpc('mentoring_assignments', { p_search: p.q ?? null, p_status: p.status ?? null, p_limit: MENTOR_PAGE_SIZE, p_offset: (p.page - 1) * MENTOR_PAGE_SIZE });
  const rows = ((data ?? []) as AssignmentRow[]).map((r) => ({ ...r, session_count: Number(r.session_count) }));
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function getAssignment(supabase: SupabaseClient, id: number): Promise<AssignmentInfo | null> {
  const { data, error } = await supabase.rpc('mentoring_assignment_info', { p_assignment_id: id });
  if (error || !data || (data as unknown[]).length === 0) return null;
  return (data as AssignmentInfo[])[0] ?? null;
}
export async function getSessions(supabase: SupabaseClient, id: number): Promise<SessionRow[]> {
  const { data } = await supabase.rpc('mentoring_sessions', { p_assignment_id: id });
  return (data ?? []) as SessionRow[];
}
export function parseMentorId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
/** datetime-local value for an ISO timestamp, in the browser's local zone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
