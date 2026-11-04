import type { SupabaseClient } from '@supabase/supabase-js';
import type { FormQuestion } from '@/lib/feedback-validation';

export type Opt = { id: number; label: string };
export type TaskRow = {
  feedback_cycle_id: number; cycle_name: string; questionnaire_type: string; is_anonymous: boolean; end_at: string;
  course_offering_id: number | null; course_label: string | null; faculty_assignment_id: number | null; instructor_name: string | null; submitted: boolean;
};
export type CycleRow = { feedback_cycle_id: number; questionnaire_id: number; academic_term_id: number; cycle_name: string; start_at: string; end_at: string; result_visibility: string; status: string };
export type QuestionnaireRow = { questionnaire_id: number; questionnaire_code: string; questionnaire_name: string; questionnaire_type: string; is_anonymous: boolean; status: string };
export type QuestionRow = { feedback_question_id: number; feedback_category_id: number; question_text: string; response_type: string; is_active: boolean };
export type ItemRow = { questionnaire_item_id: number; questionnaire_id: number; feedback_question_id: number; display_order: number; is_required: boolean };
export type CycleOffering = { course_offering_id: number; course_label: string; programme_name: string; responses: number };
export type ResultQuestion = { questionnaire_item_id: number; question_text: string; response_type: string; answered: number; average: number | null; distribution: { label: string; count: number }[]; texts: string[] };
export type Results = { cycle_name: string; visibility: string; questionnaire_type: string; anonymous: boolean; response_count: number; suppressed: boolean; minimum: number; questions: ResultQuestion[] };

export async function getMyTasks(supabase: SupabaseClient): Promise<TaskRow[]> {
  const { data } = await supabase.rpc('feedback_my_tasks');
  return (data ?? []) as TaskRow[];
}
export async function getCycle(supabase: SupabaseClient, id: number): Promise<CycleRow | null> {
  const { data } = await supabase.from('feedback_cycle').select('feedback_cycle_id, questionnaire_id, academic_term_id, cycle_name, start_at, end_at, result_visibility, status').eq('feedback_cycle_id', id).maybeSingle();
  return (data as CycleRow | null) ?? null;
}
export async function listCycles(supabase: SupabaseClient): Promise<CycleRow[]> {
  const { data } = await supabase.from('feedback_cycle').select('feedback_cycle_id, questionnaire_id, academic_term_id, cycle_name, start_at, end_at, result_visibility, status').order('feedback_cycle_id', { ascending: false }).limit(200);
  return (data ?? []) as CycleRow[];
}
export async function getForm(supabase: SupabaseClient, cycleId: number): Promise<FormQuestion[]> {
  const { data } = await supabase.rpc('feedback_form', { p_cycle_id: cycleId });
  return ((data ?? []) as { questionnaire_item_id: number; is_required: boolean; question_text: string; response_type: string; choices: { id: number; text: string }[] }[]).map((r) => ({
    questionnaire_item_id: r.questionnaire_item_id, response_type: r.response_type, is_required: r.is_required, question_text: r.question_text, choices: r.choices,
  }));
}
export async function getCycleOfferings(supabase: SupabaseClient, cycleId: number): Promise<CycleOffering[]> {
  const { data } = await supabase.rpc('feedback_cycle_offerings', { p_cycle_id: cycleId });
  return ((data ?? []) as CycleOffering[]).map((r) => ({ ...r, responses: Number(r.responses) }));
}
export async function getResults(supabase: SupabaseClient, cycleId: number, offeringId: number | null): Promise<Results | null> {
  const { data, error } = await supabase.rpc('feedback_results', { p_cycle_id: cycleId, p_course_offering_id: offeringId });
  return error || !data ? null : (data as Results);
}

export async function loadSetup(supabase: SupabaseClient) {
  const [cats, qs, choices, qn, items, cycles, terms] = await Promise.all([
    supabase.from('feedback_question_category').select('feedback_category_id, category_code, category_name').order('category_name'),
    supabase.from('feedback_question').select('feedback_question_id, feedback_category_id, question_text, response_type, is_active').order('feedback_question_id', { ascending: false }).limit(500),
    supabase.from('feedback_choice').select('feedback_choice_id, feedback_question_id, choice_text').order('display_order'),
    supabase.from('feedback_questionnaire').select('questionnaire_id, questionnaire_code, questionnaire_name, questionnaire_type, is_anonymous, status').order('questionnaire_id', { ascending: false }),
    supabase.from('feedback_questionnaire_item').select('questionnaire_item_id, questionnaire_id, feedback_question_id, display_order, is_required').order('display_order'),
    supabase.from('feedback_cycle').select('feedback_cycle_id, questionnaire_id, academic_term_id, cycle_name, start_at, end_at, result_visibility, status').order('feedback_cycle_id', { ascending: false }),
    supabase.from('academic_term').select('academic_term_id, term_name, academic_year_id').order('academic_term_id', { ascending: false }).limit(100),
  ]);
  return {
    categories: ((cats.data ?? []) as { feedback_category_id: number; category_code: string; category_name: string }[]),
    questions: (qs.data ?? []) as QuestionRow[],
    choices: (choices.data ?? []) as { feedback_choice_id: number; feedback_question_id: number; choice_text: string }[],
    questionnaires: (qn.data ?? []) as QuestionnaireRow[],
    items: (items.data ?? []) as ItemRow[],
    cycles: (cycles.data ?? []) as CycleRow[],
    terms: ((terms.data ?? []) as { academic_term_id: number; term_name: string }[]).map((t) => ({ id: t.academic_term_id, label: t.term_name })),
  };
}

export function parseFbId(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
