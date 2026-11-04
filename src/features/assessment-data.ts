import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssessmentListParams } from '@/lib/assessment-validation';

export const ASM_PAGE_SIZE = 20;

export type OfferingListRow = {
  course_offering_id: number; programme_term_offering_id: number; offering_code: string; course_code: string; course_title: string;
  term_name: string; programme_name: string; semester_name: string; total_count: number;
};
export type OfferingInfo = {
  course_offering_id: number; programme_term_offering_id: number; programme_id: number; offering_code: string; course_code: string; course_title: string; credits: number;
  term_name: string; programme_name: string; semester_name: string; internal_max_marks: number | null; external_max_marks: number | null; passing_marks: number | null;
};
export type ComponentRow = { assessment_component_id: number; component_code: string; component_name: string; component_type: string; maximum_marks: number; weightage_percent: number | null; is_mandatory: boolean };
export type EventRow = {
  assessment_event_id: number; assessment_component_id: number; event_number: number | null; event_title: string; assessment_date: string; start_time: string | null; end_time: string | null;
  maximum_marks: number; reduced_maximum_marks: number | null; details: string | null; status: string;
};
export type MarkSheetRow = { course_registration_id: number; student_id: number; student_number: string; display_name: string; attendance_status: string | null; marks_obtained: number | null; reduced_marks: number | null; remarks: string | null };
export type CourseSheetRow = {
  course_registration_id: number; student_id: number; student_number: string; display_name: string; internal_marks: number | null; external_marks: number | null; total_marks: number | null;
  grade_letter: string | null; grade_point: number | null; result_status: string | null; attempt_number: number | null; published: boolean;
};
export type TermSheetRow = {
  term_registration_id: number; student_id: number; student_number: string; display_name: string; credits_registered: number | null; credits_earned: number | null;
  sgpa: number | null; cgpa: number | null; result_status: string | null; published_at: string | null;
};
export type ScaleRow = { grade_scale_id: number; scale_name: string; effective_from: string; effective_to: string | null; is_active: boolean };
export type RuleRow = { grade_rule_id: number; grade_scale_id: number; grade_letter: string; grade_point: number; minimum_percentage: number; maximum_percentage: number; result_status: string };
export type MyTerm = {
  term_registration_id: number; term_name: string; semester_name: string; programme_name: string; credits_registered: number; credits_earned: number; sgpa: number | null; cgpa: number | null;
  result_status: string; published_at: string; courses: { course_code: string; course_title: string; credits: number; internal_marks: number | null; external_marks: number | null; total_marks: number | null; grade_letter: string | null; grade_point: number | null; credits_earned: number; result_status: string }[];
};

export async function listAssessmentOfferings(supabase: SupabaseClient, p: AssessmentListParams) {
  const { data, error } = await supabase.rpc('assessment_offerings', { p_term: p.term ?? null, p_programme: p.programme ?? null, p_limit: ASM_PAGE_SIZE, p_offset: (p.page - 1) * ASM_PAGE_SIZE });
  const rows = (data ?? []) as OfferingListRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function getOfferingInfo(supabase: SupabaseClient, id: number): Promise<OfferingInfo | null> {
  const { data, error } = await supabase.rpc('assessment_offering_info', { p_course_offering_id: id });
  if (error || !data || (data as unknown[]).length === 0) return null;
  return (data as OfferingInfo[])[0] ?? null;
}
export async function listComponents(supabase: SupabaseClient, offeringId: number): Promise<ComponentRow[]> {
  const { data } = await supabase.from('assessment_component').select('assessment_component_id, component_code, component_name, component_type, maximum_marks, weightage_percent, is_mandatory').eq('course_offering_id', offeringId).order('component_code');
  return (data ?? []) as ComponentRow[];
}
export async function listEvents(supabase: SupabaseClient, offeringId: number): Promise<EventRow[]> {
  const { data } = await supabase.from('assessment_event').select('assessment_event_id, assessment_component_id, event_number, event_title, assessment_date, start_time, end_time, maximum_marks, reduced_maximum_marks, details, status').eq('course_offering_id', offeringId).order('assessment_date').order('assessment_event_id');
  return (data ?? []) as EventRow[];
}
export async function getEvent(supabase: SupabaseClient, id: number): Promise<(EventRow & { course_offering_id: number }) | null> {
  const { data } = await supabase.from('assessment_event').select('assessment_event_id, assessment_component_id, course_offering_id, event_number, event_title, assessment_date, start_time, end_time, maximum_marks, reduced_maximum_marks, details, status').eq('assessment_event_id', id).maybeSingle();
  return (data as (EventRow & { course_offering_id: number }) | null) ?? null;
}
export async function getMarkSheet(supabase: SupabaseClient, eventId: number): Promise<MarkSheetRow[]> {
  const { data } = await supabase.rpc('assessment_sheet', { p_event_id: eventId });
  return (data ?? []) as MarkSheetRow[];
}
export async function getCourseSheet(supabase: SupabaseClient, offeringId: number): Promise<CourseSheetRow[]> {
  const { data } = await supabase.rpc('result_course_sheet', { p_course_offering_id: offeringId });
  return (data ?? []) as CourseSheetRow[];
}
export async function getTermSheet(supabase: SupabaseClient, ptoId: number): Promise<TermSheetRow[]> {
  const { data } = await supabase.rpc('result_term_sheet', { p_offering_id: ptoId });
  return (data ?? []) as TermSheetRow[];
}
export async function listScales(supabase: SupabaseClient): Promise<{ scales: ScaleRow[]; rules: RuleRow[] }> {
  const [s, r] = await Promise.all([
    supabase.from('grade_scale').select('grade_scale_id, scale_name, effective_from, effective_to, is_active').order('effective_from', { ascending: false }),
    supabase.from('grade_rule').select('grade_rule_id, grade_scale_id, grade_letter, grade_point, minimum_percentage, maximum_percentage, result_status').order('minimum_percentage', { ascending: false }),
  ]);
  return { scales: (s.data ?? []) as ScaleRow[], rules: (r.data ?? []) as RuleRow[] };
}
export async function getMyResults(supabase: SupabaseClient): Promise<MyTerm[]> {
  const { data } = await supabase.rpc('my_results');
  return (data ?? []) as MyTerm[];
}
export async function getPtoOfOffering(supabase: SupabaseClient, offeringId: number): Promise<number | null> {
  const info = await getOfferingInfo(supabase, offeringId);
  return info ? info.programme_term_offering_id : null;
}

export function parseAsmId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
