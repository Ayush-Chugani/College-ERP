import type { SupabaseClient } from '@supabase/supabase-js';
import type { TimetableListParams } from '@/lib/timetable-validation';

export const TT_PAGE_SIZE = 20;

export type OfferingRow = { programme_term_offering_id: number; term_name: string; programme_name: string; semester_name: string; section_count: number; entry_count: number; total_count: number };
export type OfferingInfo = { programme_term_offering_id: number; term_name: string; programme_name: string; semester_name: string };
export type SectionOpt = { course_offering_section_id: number; course_label: string; section_code: string; batch_code: string | null; session_type: string };
export type AssignmentOpt = { faculty_assignment_id: number; employee_name: string; assignment_role: string; assignment_status: string };
export type EntryRow = {
  timetable_session_id: number; course_offering_section_id: number; course_label: string; section_code: string; batch_code: string | null; session_type: string; instructor_name: string | null;
  day_of_week: number; time_slot_id: number; slot_code: string; start_time: string; end_time: string; room_id: number | null; room_label: string | null; effective_from: string; effective_to: string | null;
};
export type SlotRow = { time_slot_id: number; campus_id: number; campus_name: string; slot_code: string; start_time: string; end_time: string; is_break: boolean; is_active: boolean };
export type RoomRow = { room_id: number; campus_id: number; campus_name: string; room_label: string; room_type: string; capacity: number | null; is_active: boolean };

export const sectionLabel = (s: SectionOpt) => `${s.course_label} · ${s.section_code}${s.batch_code ? `/${s.batch_code}` : ''} · ${s.session_type}`;

export async function listTimetableOfferings(supabase: SupabaseClient, p: TimetableListParams) {
  const { data, error } = await supabase.rpc('timetable_offerings', { p_term: p.term ?? null, p_programme: p.programme ?? null, p_limit: TT_PAGE_SIZE, p_offset: (p.page - 1) * TT_PAGE_SIZE });
  const rows = (data ?? []) as OfferingRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function getTimetableOffering(supabase: SupabaseClient, id: number): Promise<OfferingInfo | null> {
  const { data, error } = await supabase.rpc('timetable_offering_info', { p_pto: id });
  if (error || !data || (data as unknown[]).length === 0) return null;
  return (data as OfferingInfo[])[0] ?? null;
}
export async function loadTimetable(supabase: SupabaseClient, ptoId: number) {
  const [entries, sections, slots, rooms] = await Promise.all([
    supabase.rpc('timetable_entries', { p_pto: ptoId }),
    supabase.rpc('timetable_sections', { p_pto: ptoId }),
    supabase.rpc('timetable_slots'),
    supabase.rpc('timetable_rooms'),
  ]);
  return {
    entries: (entries.data ?? []) as EntryRow[],
    sections: (sections.data ?? []) as SectionOpt[],
    slots: ((slots.data ?? []) as SlotRow[]).filter((s) => s.is_active && !s.is_break),
    rooms: ((rooms.data ?? []) as RoomRow[]).filter((r) => r.is_active),
  };
}
export function parseTtId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
