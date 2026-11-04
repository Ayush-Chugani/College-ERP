import type { SupabaseClient } from '@supabase/supabase-js';
import type { CourseListParams } from '@/lib/course-validation';

export const COURSE_PAGE_SIZE = 20;

export type CourseRow = {
  course_id: number;
  owning_department_id: number;
  course_category_id: number;
  course_code: string;
  course_title: string;
  short_title: string | null;
  course_type: string;
  lecture_hours: number;
  tutorial_hours: number;
  practical_hours: number;
  self_study_hours: number;
  credits: number;
  effective_from: string | null;
  effective_to: string | null;
  is_active: boolean;
};
export type CategoryRow = { course_category_id: number; category_code: string; category_name: string; is_graded: boolean; contributes_to_gpa: boolean; is_active: boolean };
export type PrerequisiteRow = { course_id: number; prerequisite_course_id: number; minimum_grade: string | null; code: string | null; title: string | null };
export type SchemeCourseRow = {
  curriculum_course_id: number;
  semester_id: number;
  course_id: number;
  course_category_id: number;
  is_mandatory: boolean;
  elective_group_code: string | null;
  display_order: number | null;
  internal_max_marks: number;
  external_max_marks: number;
  passing_marks: number | null;
  exam_duration_minutes: number | null;
  code: string | null;
  title: string | null;
};
export type Opt = { id: number; label: string };

const COURSE_COLS =
  'course_id, owning_department_id, course_category_id, course_code, course_title, short_title, course_type, lecture_hours, tutorial_hours, practical_hours, self_study_hours, credits, effective_from, effective_to, is_active';

export async function listCourses(supabase: SupabaseClient, p: CourseListParams) {
  const from = (p.page - 1) * COURSE_PAGE_SIZE;
  let q = supabase.from('course_catalog').select(COURSE_COLS, { count: 'exact' }).order('course_code').range(from, from + COURSE_PAGE_SIZE - 1);
  if (p.department) q = q.eq('owning_department_id', p.department);
  if (p.type) q = q.eq('course_type', p.type);
  if (p.active) q = q.eq('is_active', p.active === 'yes');
  if (p.q) q = q.or(`course_title.ilike.%${p.q}%,course_code.ilike.%${p.q}%`); // p.q is sanitised by courseListParams
  const { data, count, error } = await q;
  return { rows: (data ?? []) as unknown as CourseRow[], total: count ?? 0, error: error?.message ?? null };
}

export async function getCourse(supabase: SupabaseClient, id: number): Promise<CourseRow | null> {
  const { data } = await supabase.from('course_catalog').select(COURSE_COLS).eq('course_id', id).maybeSingle();
  return (data as unknown as CourseRow | null) ?? null;
}

export async function listCategories(supabase: SupabaseClient): Promise<CategoryRow[]> {
  const { data } = await supabase.from('course_category').select('course_category_id, category_code, category_name, is_graded, contributes_to_gpa, is_active').order('category_name');
  return (data ?? []) as CategoryRow[];
}

/** Course picker data: capped, ordered by code. Visibility is decided by RLS. */
export async function listCourseOptions(supabase: SupabaseClient): Promise<(Opt & { categoryId: number })[]> {
  const { data } = await supabase.from('course_catalog').select('course_id, course_code, course_title, course_category_id').eq('is_active', true).order('course_code').limit(1000);
  return ((data ?? []) as { course_id: number; course_code: string; course_title: string; course_category_id: number }[]).map((c) => ({
    id: c.course_id,
    label: `${c.course_code} — ${c.course_title}`,
    categoryId: c.course_category_id,
  }));
}

export async function listDepartmentOptions(supabase: SupabaseClient): Promise<Opt[]> {
  const { data } = await supabase.from('department').select('department_id, department_name').order('department_name').limit(500);
  return ((data ?? []) as { department_id: number; department_name: string }[]).map((d) => ({ id: d.department_id, label: d.department_name }));
}

export async function listSemesterOptions(supabase: SupabaseClient): Promise<Opt[]> {
  const { data } = await supabase.from('semester').select('semester_id, semester_name').order('semester_number');
  return ((data ?? []) as { semester_id: number; semester_name: string }[]).map((s) => ({ id: s.semester_id, label: s.semester_name }));
}

async function courseNames(supabase: SupabaseClient, ids: number[]) {
  const m = new Map<number, { code: string; title: string }>();
  if (ids.length === 0) return m;
  const { data } = await supabase.from('course_catalog').select('course_id, course_code, course_title').in('course_id', ids);
  ((data ?? []) as { course_id: number; course_code: string; course_title: string }[]).forEach((c) => m.set(c.course_id, { code: c.course_code, title: c.course_title }));
  return m;
}

export async function listPrerequisites(supabase: SupabaseClient, courseId: number): Promise<PrerequisiteRow[]> {
  const { data } = await supabase.from('course_prerequisite').select('course_id, prerequisite_course_id, minimum_grade').eq('course_id', courseId);
  const rows = (data ?? []) as Omit<PrerequisiteRow, 'code' | 'title'>[];
  const names = await courseNames(supabase, rows.map((r) => r.prerequisite_course_id));
  return rows.map((r) => ({ ...r, code: names.get(r.prerequisite_course_id)?.code ?? null, title: names.get(r.prerequisite_course_id)?.title ?? null }));
}

/** Courses that list this course as a prerequisite. */
export async function listRequiredBy(supabase: SupabaseClient, courseId: number): Promise<{ id: number; code: string; title: string }[]> {
  const { data } = await supabase.from('course_prerequisite').select('course_id').eq('prerequisite_course_id', courseId);
  const ids = ((data ?? []) as { course_id: number }[]).map((r) => r.course_id);
  const names = await courseNames(supabase, ids);
  return ids.map((id) => ({ id, code: names.get(id)?.code ?? `#${id}`, title: names.get(id)?.title ?? '' }));
}

/** Schemes that include this course. */
export async function listSchemeUsage(supabase: SupabaseClient, courseId: number): Promise<{ scheme_id: number; scheme_code: string; scheme_name: string }[]> {
  const { data } = await supabase.from('curriculum_course').select('curriculum_scheme_id').eq('course_id', courseId);
  const ids = [...new Set(((data ?? []) as { curriculum_scheme_id: number }[]).map((r) => r.curriculum_scheme_id))];
  if (ids.length === 0) return [];
  const { data: s } = await supabase.from('curriculum_scheme').select('curriculum_scheme_id, scheme_code, scheme_name').in('curriculum_scheme_id', ids);
  return ((s ?? []) as { curriculum_scheme_id: number; scheme_code: string; scheme_name: string }[]).map((x) => ({ scheme_id: x.curriculum_scheme_id, scheme_code: x.scheme_code, scheme_name: x.scheme_name }));
}

export async function listSchemeCourses(supabase: SupabaseClient, schemeId: number): Promise<SchemeCourseRow[]> {
  const { data } = await supabase
    .from('curriculum_course')
    .select('curriculum_course_id, semester_id, course_id, course_category_id, is_mandatory, elective_group_code, display_order, internal_max_marks, external_max_marks, passing_marks, exam_duration_minutes')
    .eq('curriculum_scheme_id', schemeId)
    .order('semester_id')
    .order('display_order', { nullsFirst: false });
  const rows = (data ?? []) as Omit<SchemeCourseRow, 'code' | 'title'>[];
  const names = await courseNames(supabase, rows.map((r) => r.course_id));
  return rows.map((r) => ({ ...r, code: names.get(r.course_id)?.code ?? null, title: names.get(r.course_id)?.title ?? null }));
}

export function parseCourseId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
