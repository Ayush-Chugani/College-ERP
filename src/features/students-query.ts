import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudentListParams } from '@/lib/validation';

export const PAGE_SIZE = 20;

export type StudentRow = {
  student_id: number;
  student_number: string;
  display_name: string;
  primary_email: string | null;
  student_status: string;
};

/** Server-side search/sort/pagination. Row visibility is decided by RLS, not by this function. */
export async function listStudents(supabase: SupabaseClient, p: StudentListParams) {
  const from = (p.page - 1) * PAGE_SIZE;
  let q = supabase
    .from('student')
    .select('student_id, student_number, display_name, primary_email, student_status', { count: 'exact' })
    .order(p.sort, { ascending: p.dir === 'asc' })
    .order('student_id', { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (p.q) {
    // p.q was sanitised by studentListParams: no commas, parentheses, quotes or wildcards reach the filter.
    q = q.or(`display_name.ilike.%${p.q}%,student_number.ilike.%${p.q}%`);
  }
  const { data, count, error } = await q;
  return { rows: (data ?? []) as StudentRow[], total: count ?? 0, error: error?.message ?? null };
}
