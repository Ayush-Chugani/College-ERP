import type { SupabaseClient } from '@supabase/supabase-js';

export type Option = { id: number; label: string };

async function options(supabase: SupabaseClient, table: string, idCol: string, labelCol: string): Promise<Option[]> {
  const { data } = await supabase.from(table).select(`${idCol}, ${labelCol}`).order(labelCol).limit(500);
  return ((data ?? []) as unknown as Record<string, string | number>[]).map((r) => ({ id: Number(r[idCol]), label: String(r[labelCol]) }));
}

export type StudentLookups = {
  genders: Option[];
  bloodGroups: Option[];
  religions: Option[];
  socialCategories: Option[];
  countries: Option[];
  programmes: Option[];
  schemes: (Option & { programmeId: number })[];
  academicYears: Option[];
  semesters: Option[];
};

/** All lists are read through RLS: a user only sees programmes/schemes within their scope's reach. */
export async function loadStudentLookups(supabase: SupabaseClient): Promise<StudentLookups> {
  const [genders, bloodGroups, religions, socialCategories, countries, programmes, academicYears, semesters, schemesRes] = await Promise.all([
    options(supabase, 'gender', 'gender_id', 'gender_name'),
    options(supabase, 'blood_group', 'blood_group_id', 'blood_group_code'),
    options(supabase, 'religion', 'religion_id', 'religion_name'),
    options(supabase, 'social_category', 'social_category_id', 'category_name'),
    options(supabase, 'country', 'country_id', 'country_name'),
    options(supabase, 'programme', 'programme_id', 'programme_name'),
    options(supabase, 'academic_year', 'academic_year_id', 'year_code'),
    options(supabase, 'semester', 'semester_id', 'semester_name'),
    supabase.from('curriculum_scheme').select('curriculum_scheme_id, scheme_name, programme_id').order('scheme_name').limit(500),
  ]);
  const schemes = ((schemesRes.data ?? []) as { curriculum_scheme_id: number; scheme_name: string; programme_id: number }[]).map((r) => ({
    id: r.curriculum_scheme_id,
    label: r.scheme_name,
    programmeId: r.programme_id,
  }));
  return { genders, bloodGroups, religions, socialCategories, countries, programmes, schemes, academicYears, semesters };
}
