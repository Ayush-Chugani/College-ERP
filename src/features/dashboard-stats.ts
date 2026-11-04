import type { SupabaseClient } from '@supabase/supabase-js';

export type StatDef = { module: string; table: string; pk: string; label: string; href?: string };

/** Counts come from real tables through RLS, so each user sees counts of rows they may read. */
export const STAT_DEFS: StatDef[] = [
  { module: 'STUDENT', table: 'student', pk: 'student_id', label: 'Students', href: '/students' },
  { module: 'ADMISSION', table: 'admission_application', pk: 'application_id', label: 'Admission applications', href: '/admissions' },
  { module: 'REGISTRATION', table: 'programme_term_offering', pk: 'programme_term_offering_id', label: 'Term offerings', href: '/registration' },
  { module: 'ATTENDANCE', table: 'class_session', pk: 'class_session_id', label: 'Class sessions', href: '/attendance' },
  { module: 'EMPLOYEE', table: 'employee', pk: 'employee_id', label: 'Employees', href: '/employees' },
  { module: 'INSTITUTION', table: 'department', pk: 'department_id', label: 'Departments', href: '/structure' },
  { module: 'INSTITUTION', table: 'programme', pk: 'programme_id', label: 'Programmes', href: '/structure' },
  { module: 'CURRICULUM', table: 'curriculum_scheme', pk: 'curriculum_scheme_id', label: 'Curriculum schemes', href: '/curriculum' },
  { module: 'ACADEMIC_CALENDAR', table: 'academic_year', pk: 'academic_year_id', label: 'Academic years', href: '/calendar' },
  { module: 'CURRICULUM', table: 'course_catalog', pk: 'course_id', label: 'Courses', href: '/courses' },
];

export type StatResult = StatDef & { count: number | null };

export async function loadStats(supabase: SupabaseClient, readableModules: string[]): Promise<StatResult[]> {
  const mods = new Set(readableModules);
  const defs = STAT_DEFS.filter((d) => mods.has(d.module));
  return Promise.all(
    defs.map(async (d) => {
      const { count, error } = await supabase.from(d.table).select(d.pk, { count: 'exact', head: true });
      return { ...d, count: error ? null : (count ?? 0) };
    }),
  );
}
