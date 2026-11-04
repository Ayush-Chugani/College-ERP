import type { SupabaseClient } from '@supabase/supabase-js';

export const STUDENT_COLUMNS =
  'student_id, student_number, university_seat_number, first_name, middle_name, last_name, display_name, date_of_birth, gender_id, blood_group_id, ' +
  'primary_email, primary_phone, nationality_country_id, religion_id, social_category_id, admission_date, student_status, notes, created_at, updated_at';

export type StudentDetail = {
  student_id: number;
  student_number: string;
  university_seat_number: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  display_name: string;
  date_of_birth: string | null;
  gender_id: number | null;
  blood_group_id: number | null;
  primary_email: string | null;
  primary_phone: string | null;
  nationality_country_id: number | null;
  religion_id: number | null;
  social_category_id: number | null;
  admission_date: string | null;
  student_status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type EnrolmentRow = {
  enrolment_id: number;
  programme_id: number;
  admission_date: string;
  enrolment_status: string;
  programme_name: string | null;
};

/** Returns null when the row does not exist OR is hidden by RLS (indistinguishable by design). */
export async function getStudent(supabase: SupabaseClient, id: number): Promise<StudentDetail | null> {
  const { data } = await supabase.from('student').select(STUDENT_COLUMNS).eq('student_id', id).maybeSingle();
  return (data as unknown as StudentDetail | null) ?? null;
}

export async function getEnrolments(supabase: SupabaseClient, studentId: number): Promise<EnrolmentRow[]> {
  const { data } = await supabase
    .from('student_programme_enrolment')
    .select('enrolment_id, programme_id, admission_date, enrolment_status')
    .eq('student_id', studentId)
    .order('admission_date', { ascending: false });
  const rows = (data ?? []) as Omit<EnrolmentRow, 'programme_name'>[];
  if (rows.length === 0) return [];
  const { data: progs } = await supabase.from('programme').select('programme_id, programme_name').in('programme_id', rows.map((r) => r.programme_id));
  const names = new Map(((progs ?? []) as { programme_id: number; programme_name: string }[]).map((p) => [p.programme_id, p.programme_name]));
  return rows.map((r) => ({ ...r, programme_name: names.get(r.programme_id) ?? null }));
}

export function parseStudentId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
