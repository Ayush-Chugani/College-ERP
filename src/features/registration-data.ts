import type { SupabaseClient } from '@supabase/supabase-js';
import type { OfferingListParams } from '@/lib/registration-validation';

export const REG_PAGE_SIZE = 20;
export type Opt = { id: number; label: string };

export type OfferingRow = {
  programme_term_offering_id: number;
  academic_term_id: number;
  programme_id: number;
  specialization_id: number | null;
  curriculum_scheme_id: number;
  semester_id: number;
  status: string;
  term_name?: string | null;
  programme_name?: string | null;
  semester_name?: string | null;
};
export type SectionRow = { class_section_id: number; section_code: string; section_name: string | null; capacity: number | null; is_active: boolean };
export type BatchRow = { class_batch_id: number; class_section_id: number; batch_code: string; batch_name: string | null; capacity: number | null; is_active: boolean };
export type CourseOfferingRow = { course_offering_id: number; course_id: number; offering_code: string; registration_capacity: number | null; status: string; code?: string | null; title?: string | null; registered?: number };
export type RosterRow = {
  term_registration_id: number; enrolment_id: number; student_id: number; student_number: string; display_name: string;
  roll_number: string | null; class_section_id: number | null; class_batch_id: number | null; registration_date: string; registration_status: string;
};
export type TermInfo = RosterRow & { programme_term_offering_id: number };
export type CourseRegRow = { course_registration_id: number; course_offering_id: number; registration_type: string; registration_date: string; registration_status: string; offering_code?: string | null; title?: string | null };

const OFFERING_COLS = 'programme_term_offering_id, academic_term_id, programme_id, specialization_id, curriculum_scheme_id, semester_id, status';

async function nameMap(supabase: SupabaseClient, table: string, idCol: string, nameCol: string, ids: number[]) {
  const m = new Map<number, string>();
  if (ids.length === 0) return m;
  const { data } = await supabase.from(table).select(`${idCol}, ${nameCol}`).in(idCol, ids);
  ((data ?? []) as unknown as Record<string, string | number>[]).forEach((r) => m.set(Number(r[idCol]), String(r[nameCol])));
  return m;
}

export async function listOfferings(supabase: SupabaseClient, p: OfferingListParams) {
  const from = (p.page - 1) * REG_PAGE_SIZE;
  let q = supabase.from('programme_term_offering').select(OFFERING_COLS, { count: 'exact' }).order('programme_term_offering_id', { ascending: false }).range(from, from + REG_PAGE_SIZE - 1);
  if (p.term) q = q.eq('academic_term_id', p.term);
  if (p.programme) q = q.eq('programme_id', p.programme);
  if (p.status) q = q.eq('status', p.status);
  const { data, count, error } = await q;
  const rows = (data ?? []) as unknown as OfferingRow[];
  const u = (xs: number[]) => [...new Set(xs)];
  const [terms, progs, sems] = await Promise.all([
    nameMap(supabase, 'academic_term', 'academic_term_id', 'term_name', u(rows.map((r) => r.academic_term_id))),
    nameMap(supabase, 'programme', 'programme_id', 'programme_name', u(rows.map((r) => r.programme_id))),
    nameMap(supabase, 'semester', 'semester_id', 'semester_name', u(rows.map((r) => r.semester_id))),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, term_name: terms.get(r.academic_term_id) ?? null, programme_name: progs.get(r.programme_id) ?? null, semester_name: sems.get(r.semester_id) ?? null })),
    total: count ?? 0,
    error: error?.message ?? null,
  };
}

export async function getOffering(supabase: SupabaseClient, id: number): Promise<OfferingRow | null> {
  const { data } = await supabase.from('programme_term_offering').select(OFFERING_COLS).eq('programme_term_offering_id', id).maybeSingle();
  if (!data) return null;
  const r = data as unknown as OfferingRow;
  const [t, p, s] = await Promise.all([
    nameMap(supabase, 'academic_term', 'academic_term_id', 'term_name', [r.academic_term_id]),
    nameMap(supabase, 'programme', 'programme_id', 'programme_name', [r.programme_id]),
    nameMap(supabase, 'semester', 'semester_id', 'semester_name', [r.semester_id]),
  ]);
  return { ...r, term_name: t.get(r.academic_term_id) ?? null, programme_name: p.get(r.programme_id) ?? null, semester_name: s.get(r.semester_id) ?? null };
}

export async function listSections(supabase: SupabaseClient, offeringId: number): Promise<{ sections: SectionRow[]; batches: BatchRow[] }> {
  const { data } = await supabase.from('class_section').select('class_section_id, section_code, section_name, capacity, is_active').eq('programme_term_offering_id', offeringId).order('section_code');
  const sections = (data ?? []) as SectionRow[];
  if (sections.length === 0) return { sections, batches: [] };
  const { data: b } = await supabase.from('class_batch').select('class_batch_id, class_section_id, batch_code, batch_name, capacity, is_active').in('class_section_id', sections.map((s) => s.class_section_id)).order('batch_code');
  return { sections, batches: (b ?? []) as BatchRow[] };
}

export async function listCourseOfferings(supabase: SupabaseClient, offeringId: number): Promise<CourseOfferingRow[]> {
  const { data } = await supabase.from('course_offering').select('course_offering_id, course_id, offering_code, registration_capacity, status').eq('programme_term_offering_id', offeringId).order('offering_code');
  const rows = (data ?? []) as CourseOfferingRow[];
  if (rows.length === 0) return rows;
  const { data: cs } = await supabase.from('course_catalog').select('course_id, course_code, course_title').in('course_id', rows.map((r) => r.course_id));
  const m = new Map(((cs ?? []) as { course_id: number; course_code: string; course_title: string }[]).map((c) => [c.course_id, c]));
  return rows.map((r) => ({ ...r, code: m.get(r.course_id)?.course_code ?? null, title: m.get(r.course_id)?.course_title ?? null }));
}

export async function getRoster(supabase: SupabaseClient, offeringId: number): Promise<RosterRow[]> {
  const { data } = await supabase.rpc('registration_roster', { p_offering_id: offeringId });
  return (data ?? []) as RosterRow[];
}

export async function getTermInfo(supabase: SupabaseClient, id: number): Promise<TermInfo | null> {
  const { data, error } = await supabase.rpc('registration_term_info', { p_term_registration_id: id });
  if (error || !data || (data as unknown[]).length === 0) return null;
  return (data as TermInfo[])[0] ?? null;
}

export async function listCourseRegistrations(supabase: SupabaseClient, termRegId: number): Promise<CourseRegRow[]> {
  const { data } = await supabase.from('student_course_registration').select('course_registration_id, course_offering_id, registration_type, registration_date, registration_status').eq('term_registration_id', termRegId).order('course_registration_id');
  const rows = (data ?? []) as CourseRegRow[];
  if (rows.length === 0) return rows;
  const { data: offs } = await supabase.from('course_offering').select('course_offering_id, offering_code, course_id').in('course_offering_id', rows.map((r) => r.course_offering_id));
  const offers = (offs ?? []) as { course_offering_id: number; offering_code: string; course_id: number }[];
  const { data: cs } = await supabase.from('course_catalog').select('course_id, course_title').in('course_id', offers.map((o) => o.course_id));
  const titles = new Map(((cs ?? []) as { course_id: number; course_title: string }[]).map((c) => [c.course_id, c.course_title]));
  const byOffer = new Map(offers.map((o) => [o.course_offering_id, o]));
  return rows.map((r) => ({ ...r, offering_code: byOffer.get(r.course_offering_id)?.offering_code ?? null, title: titles.get(byOffer.get(r.course_offering_id)?.course_id ?? -1) ?? null }));
}

async function options(supabase: SupabaseClient, table: string, idCol: string, labelCol: string): Promise<Opt[]> {
  const { data } = await supabase.from(table).select(`${idCol}, ${labelCol}`).order(labelCol).limit(500);
  return ((data ?? []) as unknown as Record<string, string | number>[]).map((r) => ({ id: Number(r[idCol]), label: String(r[labelCol]) }));
}

export type RegLookups = { terms: Opt[]; programmes: Opt[]; semesters: Opt[]; schemes: (Opt & { programmeId: number })[] };
export async function loadRegLookups(supabase: SupabaseClient): Promise<RegLookups> {
  const [terms, programmes, semesters, sres] = await Promise.all([
    options(supabase, 'academic_term', 'academic_term_id', 'term_name'),
    options(supabase, 'programme', 'programme_id', 'programme_name'),
    options(supabase, 'semester', 'semester_id', 'semester_name'),
    supabase.from('curriculum_scheme').select('curriculum_scheme_id, scheme_name, programme_id').order('scheme_name').limit(500),
  ]);
  const schemes = ((sres.data ?? []) as { curriculum_scheme_id: number; scheme_name: string; programme_id: number }[]).map((s) => ({ id: s.curriculum_scheme_id, label: s.scheme_name, programmeId: s.programme_id }));
  return { terms, programmes, semesters, schemes };
}

export function parseRegId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
