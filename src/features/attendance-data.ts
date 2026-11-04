import type { SupabaseClient } from '@supabase/supabase-js';
import type { SectionListParams } from '@/lib/attendance-validation';

export const ATT_PAGE_SIZE = 20;
export type Opt = { id: number; label: string };

export type TeachingSectionRow = {
  course_offering_section_id: number;
  course_offering_id: number;
  programme_term_offering_id: number;
  class_section_id: number;
  class_batch_id: number | null;
  session_type: string;
  course_label?: string | null;
  section_code?: string | null;
  batch_code?: string | null;
  term_name?: string | null;
  programme_name?: string | null;
  programme_id?: number | null;
};
export type AssignmentRow = { faculty_assignment_id: number; employee_id: number; assignment_role: string; start_date: string; end_date: string | null; assignment_status: string; workload_hours: number | null; employee_label?: string | null };
export type SessionRow = {
  class_session_id: number; course_offering_section_id: number; faculty_assignment_id: number | null; session_date: string; start_time: string; end_time: string;
  session_type: string; planned_topic: string | null; topic_covered: string | null; session_status: string;
};
export type SheetRow = { roster_id: number; student_id: number; student_number: string; display_name: string; attendance_status_id: number | null; remarks: string | null; marked_at: string | null };
export type StatusRow = { attendance_status_id: number; status_code: string; status_name: string; counts_as_present: boolean; is_active: boolean };
export type CorrectionRow = { attendance_correction_id: number; class_session_id: number; course_offering_section_student_id: number; old_status_id: number; requested_status_id: number; reason: string; request_status: string; requested_at: string; student_label?: string };
export type SummaryRow = { roster_id: number; student_id: number; student_number: string; display_name: string; conducted_sessions: number; present_sessions: number; percentage: string | null };

async function names(supabase: SupabaseClient, table: string, idCol: string, nameCol: string, ids: number[]) {
  const m = new Map<number, string>();
  if (ids.length === 0) return m;
  const { data } = await supabase.from(table).select(`${idCol}, ${nameCol}`).in(idCol, ids);
  ((data ?? []) as unknown as Record<string, string | number>[]).forEach((r) => m.set(Number(r[idCol]), String(r[nameCol])));
  return m;
}
const uniq = (xs: number[]) => [...new Set(xs)];

async function decorate(supabase: SupabaseClient, rows: TeachingSectionRow[]): Promise<TeachingSectionRow[]> {
  if (rows.length === 0) return rows;
  const { data: cos } = await supabase.from('course_offering').select('course_offering_id, offering_code, course_id').in('course_offering_id', uniq(rows.map((r) => r.course_offering_id)));
  const offers = (cos ?? []) as { course_offering_id: number; offering_code: string; course_id: number }[];
  const { data: ptos } = await supabase.from('programme_term_offering').select('programme_term_offering_id, academic_term_id, programme_id').in('programme_term_offering_id', uniq(rows.map((r) => r.programme_term_offering_id)));
  const pto = (ptos ?? []) as { programme_term_offering_id: number; academic_term_id: number; programme_id: number }[];
  const [courses, sections, batches, terms, progs] = await Promise.all([
    names(supabase, 'course_catalog', 'course_id', 'course_code', uniq(offers.map((o) => o.course_id))),
    names(supabase, 'class_section', 'class_section_id', 'section_code', uniq(rows.map((r) => r.class_section_id))),
    names(supabase, 'class_batch', 'class_batch_id', 'batch_code', uniq(rows.flatMap((r) => (r.class_batch_id ? [r.class_batch_id] : [])))),
    names(supabase, 'academic_term', 'academic_term_id', 'term_name', uniq(pto.map((p) => p.academic_term_id))),
    names(supabase, 'programme', 'programme_id', 'programme_name', uniq(pto.map((p) => p.programme_id))),
  ]);
  const offerById = new Map(offers.map((o) => [o.course_offering_id, o]));
  const ptoById = new Map(pto.map((p) => [p.programme_term_offering_id, p]));
  return rows.map((r) => {
    const o = offerById.get(r.course_offering_id);
    const p = ptoById.get(r.programme_term_offering_id);
    return {
      ...r,
      course_label: o ? `${courses.get(o.course_id) ?? o.offering_code}` : null,
      section_code: sections.get(r.class_section_id) ?? null,
      batch_code: r.class_batch_id ? (batches.get(r.class_batch_id) ?? null) : null,
      term_name: p ? (terms.get(p.academic_term_id) ?? null) : null,
      programme_name: p ? (progs.get(p.programme_id) ?? null) : null,
      programme_id: p?.programme_id ?? null,
    };
  });
}

const COS_COLS = 'course_offering_section_id, course_offering_id, programme_term_offering_id, class_section_id, class_batch_id, session_type';

export async function listTeachingSections(supabase: SupabaseClient, p: SectionListParams) {
  const from = (p.page - 1) * ATT_PAGE_SIZE;
  let programmeOffers: number[] | null = null;
  if (p.programme || p.term) {
    let q = supabase.from('programme_term_offering').select('programme_term_offering_id');
    if (p.programme) q = q.eq('programme_id', p.programme);
    if (p.term) q = q.eq('academic_term_id', p.term);
    const { data } = await q.limit(1000);
    programmeOffers = ((data ?? []) as { programme_term_offering_id: number }[]).map((r) => r.programme_term_offering_id);
    if (programmeOffers.length === 0) return { rows: [] as TeachingSectionRow[], total: 0, error: null };
  }
  let q = supabase.from('course_offering_section').select(COS_COLS, { count: 'exact' }).order('course_offering_section_id', { ascending: false }).range(from, from + ATT_PAGE_SIZE - 1);
  if (programmeOffers) q = q.in('programme_term_offering_id', programmeOffers);
  const { data, count, error } = await q;
  return { rows: await decorate(supabase, (data ?? []) as TeachingSectionRow[]), total: count ?? 0, error: error?.message ?? null };
}

export async function getTeachingSection(supabase: SupabaseClient, id: number): Promise<TeachingSectionRow | null> {
  const { data } = await supabase.from('course_offering_section').select(COS_COLS).eq('course_offering_section_id', id).maybeSingle();
  if (!data) return null;
  return (await decorate(supabase, [data as unknown as TeachingSectionRow]))[0] ?? null;
}

export async function listTeachingSectionsForOffering(supabase: SupabaseClient, offeringId: number): Promise<TeachingSectionRow[]> {
  const { data } = await supabase.from('course_offering_section').select(COS_COLS).eq('programme_term_offering_id', offeringId).order('course_offering_section_id');
  return decorate(supabase, (data ?? []) as TeachingSectionRow[]);
}

export async function listAssignments(supabase: SupabaseClient, cosId: number): Promise<AssignmentRow[]> {
  const { data } = await supabase.from('faculty_course_assignment').select('faculty_assignment_id, employee_id, assignment_role, start_date, end_date, assignment_status, workload_hours').eq('course_offering_section_id', cosId).order('faculty_assignment_id');
  const rows = (data ?? []) as AssignmentRow[];
  const emp = await names(supabase, 'employee', 'employee_id', 'display_name', uniq(rows.map((r) => r.employee_id)));
  return rows.map((r) => ({ ...r, employee_label: emp.get(r.employee_id) ?? null }));
}

export async function listEmployeeOptions(supabase: SupabaseClient): Promise<Opt[]> {
  const { data } = await supabase.from('employee').select('employee_id, employee_number, display_name').eq('employment_status', 'ACTIVE').order('display_name').limit(500);
  return ((data ?? []) as { employee_id: number; employee_number: string; display_name: string }[]).map((e) => ({ id: e.employee_id, label: `${e.employee_number} — ${e.display_name}` }));
}

export async function listSessions(supabase: SupabaseClient, cosId: number): Promise<SessionRow[]> {
  const { data } = await supabase.from('class_session').select('class_session_id, course_offering_section_id, faculty_assignment_id, session_date, start_time, end_time, session_type, planned_topic, topic_covered, session_status').eq('course_offering_section_id', cosId).order('session_date', { ascending: false }).order('start_time', { ascending: false }).limit(300);
  return (data ?? []) as SessionRow[];
}
export async function getSession(supabase: SupabaseClient, id: number): Promise<SessionRow | null> {
  const { data } = await supabase.from('class_session').select('class_session_id, course_offering_section_id, faculty_assignment_id, session_date, start_time, end_time, session_type, planned_topic, topic_covered, session_status').eq('class_session_id', id).maybeSingle();
  return (data as SessionRow | null) ?? null;
}

export async function getSheet(supabase: SupabaseClient, sessionId: number): Promise<SheetRow[]> {
  const { data } = await supabase.rpc('attendance_sheet', { p_session_id: sessionId });
  return (data ?? []) as SheetRow[];
}
export async function getSummary(supabase: SupabaseClient, cosId: number): Promise<SummaryRow[]> {
  const { data } = await supabase.rpc('attendance_summary', { p_cos_id: cosId });
  return (data ?? []) as SummaryRow[];
}
export async function listStatuses(supabase: SupabaseClient): Promise<StatusRow[]> {
  const { data } = await supabase.from('attendance_status').select('attendance_status_id, status_code, status_name, counts_as_present, is_active').order('status_name');
  return (data ?? []) as StatusRow[];
}
export async function listCorrections(supabase: SupabaseClient, sessionId: number): Promise<CorrectionRow[]> {
  const { data } = await supabase.from('attendance_correction_request').select('attendance_correction_id, class_session_id, course_offering_section_student_id, old_status_id, requested_status_id, reason, request_status, requested_at').eq('class_session_id', sessionId).order('attendance_correction_id', { ascending: false });
  return (data ?? []) as CorrectionRow[];
}

export function parseAttId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
