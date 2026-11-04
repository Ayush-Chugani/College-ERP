import type { SupabaseClient } from '@supabase/supabase-js';

export type MyAttendance = { course: string; section_id: number; conducted: number; present: number; percentage: number | null };
export type MyClass = { course: string; start: string; end: string; type: string; status: string; room: string | null };
export type MySession = { session_id: number; course: string; section: string; date: string; start: string; end: string; type: string; status: string };
export type PersonalDashboard = { attendance?: MyAttendance[]; today?: MyClass[]; upcoming?: MySession[]; unmarked?: number; sections?: number };

/** Null when the call failed, so a broken card shows "unavailable" instead of an empty one. */
export async function loadPersonalDashboard(supabase: SupabaseClient): Promise<PersonalDashboard | null> {
  const { data, error } = await supabase.rpc('my_dashboard');
  return error || !data ? null : (data as PersonalDashboard);
}

/** Below this share of conducted classes a course is flagged (a common rule; the institution's own threshold is not in the source). */
export const ATTENDANCE_WARNING_PERCENT = 75;
export const isLow = (pct: number | null): boolean => pct !== null && pct < ATTENDANCE_WARNING_PERCENT;
export const hhmm = (t: string): string => t.slice(0, 5);
