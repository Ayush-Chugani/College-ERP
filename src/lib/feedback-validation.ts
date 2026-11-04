import { z } from 'zod';

export const QUESTIONNAIRE_TYPES = ['COURSE', 'FACULTY', 'PROGRAMME', 'INSTITUTION', 'EXIT', 'OTHER'] as const;
export const RESPONSE_TYPES = ['RATING', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TEXT'] as const;
export const VISIBILITIES = ['HIDDEN', 'ADMIN_ONLY', 'FACULTY', 'PUBLIC'] as const;
export const QUESTIONNAIRE_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
/** Mirrors the database transitions (cycle guard in migration 037); drift-tested. */
export const CYCLE_TRANSITIONS: Record<string, readonly string[]> = { SCHEDULED: ['OPEN', 'CANCELLED'], OPEN: ['CLOSED', 'CANCELLED'], CLOSED: [], CANCELLED: [] };
export const RATING_MAX = 5;
export const TEXT_MAX = 2000;

const id = (what: string) => z.string().min(1, `Select ${what}`).regex(/^\d{1,15}$/, `Select ${what}`).transform(Number);
const code = (max: number) => z.string().trim().min(1, 'Code is required').max(max, `At most ${max} characters`);

export const categorySchema = z.object({ category_code: code(30), category_name: z.string().trim().min(1, 'Name is required').max(100, 'At most 100 characters') });
export type CategoryInput = z.input<typeof categorySchema>;
export type CategoryValues = z.output<typeof categorySchema>;

/** One choice per line, optionally "text | score" (score is a number with at most 2 decimals). */
export function parseChoices(raw: string): { ok: true; choices: { choice_text: string; score: number | null; display_order: number }[] } | { ok: false; error: string } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set<string>();
  const choices: { choice_text: string; score: number | null; display_order: number }[] = [];
  for (const [i, line] of lines.entries()) {
    const bar = line.lastIndexOf('|');
    const text = (bar >= 0 ? line.slice(0, bar) : line).trim();
    const scoreRaw = bar >= 0 ? line.slice(bar + 1).trim() : '';
    if (!text) return { ok: false, error: `Line ${i + 1} has no text` };
    if (text.length > 250) return { ok: false, error: `Line ${i + 1} is longer than 250 characters` };
    if (scoreRaw !== '' && !/^-?\d{1,4}(\.\d{1,2})?$/.test(scoreRaw)) return { ok: false, error: `Line ${i + 1}: the score must be a number` };
    if (seen.has(text.toLowerCase())) return { ok: false, error: `"${text}" is listed twice` };
    seen.add(text.toLowerCase());
    choices.push({ choice_text: text, score: scoreRaw === '' ? null : Number(scoreRaw), display_order: i + 1 });
  }
  if (choices.length > 50) return { ok: false, error: 'At most 50 choices' };
  return { ok: true, choices };
}

export const questionSchema = z
  .object({
    feedback_category_id: id('a category'),
    question_text: z.string().trim().min(1, 'The question is required').max(1000, 'At most 1000 characters'),
    response_type: z.enum(RESPONSE_TYPES, { message: 'Select a type' }),
    choices: z.string().optional().default(''),
  })
  .superRefine((v, ctx) => {
    const needs = v.response_type === 'SINGLE_CHOICE' || v.response_type === 'MULTIPLE_CHOICE';
    const parsed = parseChoices(v.choices);
    if (!parsed.ok) return void ctx.addIssue({ code: 'custom', path: ['choices'], message: parsed.error });
    if (needs && parsed.choices.length < 2) ctx.addIssue({ code: 'custom', path: ['choices'], message: 'A choice question needs at least two choices (one per line)' });
    if (!needs && parsed.choices.length > 0) ctx.addIssue({ code: 'custom', path: ['choices'], message: 'Only choice questions have choices' });
  });
export type QuestionInput = z.input<typeof questionSchema>;
export type QuestionValues = z.output<typeof questionSchema>;

export const questionnaireSchema = z.object({
  questionnaire_code: code(30),
  questionnaire_name: z.string().trim().min(1, 'Name is required').max(150, 'At most 150 characters'),
  questionnaire_type: z.enum(QUESTIONNAIRE_TYPES, { message: 'Select a type' }),
  is_anonymous: z.boolean(),
});
export type QuestionnaireInput = z.input<typeof questionnaireSchema>;
export type QuestionnaireValues = z.output<typeof questionnaireSchema>;

export const itemSchema = z.object({
  feedback_question_id: id('a question'),
  display_order: z.string().regex(/^\d{1,4}$/, 'A whole number').transform(Number).refine((n) => n >= 1, 'At least 1'),
  is_required: z.boolean(),
});
export type ItemInput = z.input<typeof itemSchema>;
export type ItemValues = z.output<typeof itemSchema>;

export const cycleSchema = z
  .object({
    questionnaire_id: id('a questionnaire'),
    academic_term_id: id('a term'),
    cycle_name: z.string().trim().min(1, 'Name is required').max(150, 'At most 150 characters'),
    start_at: z.string().min(1, 'Start is required').regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Use a valid date and time'),
    end_at: z.string().min(1, 'End is required').regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Use a valid date and time'),
    result_visibility: z.enum(VISIBILITIES, { message: 'Select a visibility' }),
  })
  .refine((v) => v.end_at > v.start_at, { path: ['end_at'], message: 'The end must be after the start' });
export type CycleInput = z.input<typeof cycleSchema>;
export type CycleValues = z.output<typeof cycleSchema>;

// ---------------------------------------------------------------------------
// Answering
export type FormQuestion = { questionnaire_item_id: number; response_type: string; is_required: boolean; question_text: string; choices: { id: number; text: string }[] };
export type AnswerState = Record<number, { score?: number; choiceId?: number; choiceIds?: number[]; text?: string }>;

/** Returns an error message per questionnaire_item_id; an empty object means the answers are complete. */
export function validateAnswers(questions: FormQuestion[], state: AnswerState): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const q of questions) {
    const a = state[q.questionnaire_item_id];
    const answered =
      q.response_type === 'RATING' ? a?.score !== undefined
      : q.response_type === 'SINGLE_CHOICE' ? a?.choiceId !== undefined
      : q.response_type === 'MULTIPLE_CHOICE' ? (a?.choiceIds?.length ?? 0) > 0
      : (a?.text?.trim() ?? '') !== '';
    if (!answered) {
      if (q.is_required) errors[q.questionnaire_item_id] = 'This question is required';
      continue;
    }
    if (q.response_type === 'RATING' && (!Number.isInteger(a?.score) || (a?.score ?? 0) < 1 || (a?.score ?? 0) > RATING_MAX)) errors[q.questionnaire_item_id] = `Choose 1 to ${RATING_MAX}`;
    if (q.response_type === 'TEXT' && (a?.text?.trim().length ?? 0) > TEXT_MAX) errors[q.questionnaire_item_id] = `At most ${TEXT_MAX} characters`;
  }
  return errors;
}

/** The JSON the RPC expects; unanswered optional questions are left out. */
export function buildAnswers(questions: FormQuestion[], state: AnswerState) {
  const out: Record<string, unknown>[] = [];
  for (const q of questions) {
    const a = state[q.questionnaire_item_id];
    if (!a) continue;
    if (q.response_type === 'RATING' && a.score !== undefined) out.push({ questionnaire_item_id: q.questionnaire_item_id, score: a.score });
    else if (q.response_type === 'SINGLE_CHOICE' && a.choiceId !== undefined) out.push({ questionnaire_item_id: q.questionnaire_item_id, choice_id: a.choiceId });
    else if (q.response_type === 'MULTIPLE_CHOICE' && a.choiceIds?.length) out.push({ questionnaire_item_id: q.questionnaire_item_id, choice_ids: [...a.choiceIds].sort((x, y) => x - y) });
    else if (q.response_type === 'TEXT' && (a.text?.trim() ?? '') !== '') out.push({ questionnaire_item_id: q.questionnaire_item_id, text: a.text!.trim() });
  }
  return out;
}

export const optionalIdParam = z.string().regex(/^\d{1,15}$/).transform(Number).optional().catch(undefined);
