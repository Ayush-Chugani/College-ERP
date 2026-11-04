import type { SupabaseClient } from '@supabase/supabase-js';
import type { Option } from '@/features/students-lookups';
import type { EmployeeListParams } from '@/lib/employee-validation';

export const EMPLOYEE_PAGE_SIZE = 20;

export const EMPLOYEE_COLUMNS =
  'employee_id, institution_id, employment_source_id, employee_number, first_name, middle_name, last_name, display_name, date_of_birth, gender_id, ' +
  'blood_group_id, primary_email, primary_phone, nationality_country_id, religion_id, social_category_id, joining_date, employment_type, employment_status';

export type EmployeeRow = { employee_id: number; employee_number: string; display_name: string; employment_status: string; employment_type: string; primary_email: string | null };

export type EmployeeDetail = EmployeeRow & {
  institution_id: number;
  employment_source_id: number;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  gender_id: number | null;
  blood_group_id: number | null;
  primary_phone: string | null;
  nationality_country_id: number | null;
  religion_id: number | null;
  social_category_id: number | null;
  joining_date: string;
};

export type AssignmentRow = {
  employee_assignment_id: number;
  campus_id: number;
  department_id: number | null;
  designation_id: number;
  start_date: string;
  end_date: string | null;
  is_primary: boolean;
  campus_name: string | null;
  department_name: string | null;
  designation_name: string | null;
};

/** Server-side search/sort/pagination. Visibility is decided by RLS. */
export async function listEmployees(supabase: SupabaseClient, p: EmployeeListParams) {
  const from = (p.page - 1) * EMPLOYEE_PAGE_SIZE;
  let q = supabase
    .from('employee')
    .select('employee_id, employee_number, display_name, employment_status, employment_type, primary_email', { count: 'exact' })
    .order(p.sort, { ascending: p.dir === 'asc' })
    .order('employee_id', { ascending: true })
    .range(from, from + EMPLOYEE_PAGE_SIZE - 1);
  if (p.q) q = q.or(`display_name.ilike.%${p.q}%,employee_number.ilike.%${p.q}%`); // p.q is sanitised by employeeListParams
  const { data, count, error } = await q;
  return { rows: (data ?? []) as EmployeeRow[], total: count ?? 0, error: error?.message ?? null };
}

export async function getEmployee(supabase: SupabaseClient, id: number): Promise<EmployeeDetail | null> {
  const { data } = await supabase.from('employee').select(EMPLOYEE_COLUMNS).eq('employee_id', id).maybeSingle();
  return (data as unknown as EmployeeDetail | null) ?? null;
}

const names = async (supabase: SupabaseClient, table: string, idCol: string, nameCol: string, ids: number[]) => {
  if (ids.length === 0) return new Map<number, string>();
  const { data } = await supabase.from(table).select(`${idCol}, ${nameCol}`).in(idCol, ids);
  return new Map(((data ?? []) as unknown as Record<string, string | number>[]).map((r) => [Number(r[idCol]), String(r[nameCol])]));
};

export async function getAssignments(supabase: SupabaseClient, employeeId: number): Promise<AssignmentRow[]> {
  const { data } = await supabase
    .from('employee_assignment')
    .select('employee_assignment_id, campus_id, department_id, designation_id, start_date, end_date, is_primary')
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false });
  const rows = (data ?? []) as Omit<AssignmentRow, 'campus_name' | 'department_name' | 'designation_name'>[];
  const uniq = (xs: (number | null)[]) => [...new Set(xs.filter((x): x is number => x !== null))];
  const [campus, dept, desig] = await Promise.all([
    names(supabase, 'campus', 'campus_id', 'campus_name', uniq(rows.map((r) => r.campus_id))),
    names(supabase, 'department', 'department_id', 'department_name', uniq(rows.map((r) => r.department_id))),
    names(supabase, 'designation', 'designation_id', 'designation_name', uniq(rows.map((r) => r.designation_id))),
  ]);
  return rows.map((r) => ({
    ...r,
    campus_name: campus.get(r.campus_id) ?? null,
    department_name: r.department_id ? (dept.get(r.department_id) ?? null) : null,
    designation_name: desig.get(r.designation_id) ?? null,
  }));
}

export function parseEmployeeId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function options(supabase: SupabaseClient, table: string, idCol: string, labelCol: string): Promise<Option[]> {
  const { data } = await supabase.from(table).select(`${idCol}, ${labelCol}`).order(labelCol).limit(500);
  return ((data ?? []) as unknown as Record<string, string | number>[]).map((r) => ({ id: Number(r[idCol]), label: String(r[labelCol]) }));
}

export type EmployeeLookups = {
  institutions: Option[];
  campuses: (Option & { institutionId: number })[];
  departments: (Option & { campusId: number })[];
  designations: Option[];
  sources: Option[];
  genders: Option[];
  bloodGroups: Option[];
  religions: Option[];
  socialCategories: Option[];
  countries: Option[];
};

/** All lists are read through RLS. */
export async function loadEmployeeLookups(supabase: SupabaseClient): Promise<EmployeeLookups> {
  const [institutions, designations, sources, genders, bloodGroups, religions, socialCategories, countries, campusRes, deptRes] = await Promise.all([
    options(supabase, 'institution', 'institution_id', 'institution_name'),
    options(supabase, 'designation', 'designation_id', 'designation_name'),
    options(supabase, 'employment_source', 'employment_source_id', 'source_name'),
    options(supabase, 'gender', 'gender_id', 'gender_name'),
    options(supabase, 'blood_group', 'blood_group_id', 'blood_group_code'),
    options(supabase, 'religion', 'religion_id', 'religion_name'),
    options(supabase, 'social_category', 'social_category_id', 'category_name'),
    options(supabase, 'country', 'country_id', 'country_name'),
    supabase.from('campus').select('campus_id, campus_name, institution_id').order('campus_name').limit(500),
    supabase.from('department').select('department_id, department_name, campus_id').order('department_name').limit(500),
  ]);
  const campuses = ((campusRes.data ?? []) as { campus_id: number; campus_name: string; institution_id: number }[]).map((r) => ({ id: r.campus_id, label: r.campus_name, institutionId: r.institution_id }));
  const departments = ((deptRes.data ?? []) as { department_id: number; department_name: string; campus_id: number }[]).map((r) => ({ id: r.department_id, label: r.department_name, campusId: r.campus_id }));
  return { institutions, campuses, departments, designations, sources, genders, bloodGroups, religions, socialCategories, countries };
}
