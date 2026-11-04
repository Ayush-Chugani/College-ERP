import { describe, expect, it } from 'vitest';
import { parseFbId } from '@/features/feedback-data';
import {
  buildAnswers, categorySchema, CYCLE_TRANSITIONS, cycleSchema, itemSchema, parseChoices, questionnaireSchema, questionSchema, validateAnswers, type FormQuestion,
} from '@/lib/feedback-validation';

describe('parseChoices', () => {
  it('reads one choice per line with an optional score and keeps order', () => {
    expect(parseChoices('Too fast | 1\nJust right|3\n\n  Too slow  ')).toEqual({
      ok: true, choices: [{ choice_text: 'Too fast', score: 1, display_order: 1 }, { choice_text: 'Just right', score: 3, display_order: 2 }, { choice_text: 'Too slow', score: null, display_order: 3 }],
    });
    expect(parseChoices('')).toEqual({ ok: true, choices: [] });
  });
  it('rejects blank text, bad scores, duplicates (case-insensitive) and overlong or excessive input', () => {
    expect(parseChoices(' | 3')).toMatchObject({ ok: false });
    expect(parseChoices('A | x')).toMatchObject({ ok: false });
    expect(parseChoices('A | 1.234')).toMatchObject({ ok: false });
    expect(parseChoices('Yes\nyes')).toMatchObject({ ok: false });
    expect(parseChoices('x'.repeat(251))).toMatchObject({ ok: false });
    expect(parseChoices(Array.from({ length: 51 }, (_, i) => `c${i}`).join('\n'))).toMatchObject({ ok: false });
  });
});

describe('question schema', () => {
  const base = { feedback_category_id: '1', question_text: 'How was it?', response_type: 'RATING', choices: '' };
  it('choice questions need two choices; other types take none', () => {
    expect(questionSchema.safeParse(base).success).toBe(true);
    expect(questionSchema.safeParse({ ...base, response_type: 'SINGLE_CHOICE', choices: 'Only one' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, response_type: 'SINGLE_CHOICE', choices: 'A\nB' }).success).toBe(true);
    expect(questionSchema.safeParse({ ...base, response_type: 'MULTIPLE_CHOICE', choices: 'A | 1\nB | 2' }).success).toBe(true);
    expect(questionSchema.safeParse({ ...base, response_type: 'TEXT', choices: 'A\nB' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, question_text: ' ' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, feedback_category_id: '' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, response_type: 'SLIDER' }).success).toBe(false);
  });
});

describe('configuration schemas', () => {
  it('category, questionnaire and item', () => {
    expect(categorySchema.safeParse({ category_code: ' ', category_name: 'x' }).success).toBe(false);
    expect(questionnaireSchema.parse({ questionnaire_code: 'Q1', questionnaire_name: 'Course', questionnaire_type: 'COURSE', is_anonymous: true })).toMatchObject({ is_anonymous: true });
    expect(questionnaireSchema.safeParse({ questionnaire_code: 'Q1', questionnaire_name: 'Course', questionnaire_type: 'SURVEY', is_anonymous: true }).success).toBe(false);
    expect(itemSchema.parse({ feedback_question_id: '3', display_order: '2', is_required: true })).toEqual({ feedback_question_id: 3, display_order: 2, is_required: true });
    expect(itemSchema.safeParse({ feedback_question_id: '3', display_order: '0', is_required: true }).success).toBe(false);
  });
  it('a cycle must end after it starts and use a known visibility', () => {
    const ok = { questionnaire_id: '1', academic_term_id: '2', cycle_name: 'Odd 2025', start_at: '2025-09-01T09:00', end_at: '2025-09-10T17:00', result_visibility: 'ADMIN_ONLY' };
    expect(cycleSchema.safeParse(ok).success).toBe(true);
    expect(cycleSchema.safeParse({ ...ok, end_at: '2025-09-01T09:00' }).success).toBe(false);
    expect(cycleSchema.safeParse({ ...ok, result_visibility: 'EVERYONE' }).success).toBe(false);
    expect(cycleSchema.safeParse({ ...ok, start_at: '' }).success).toBe(false);
  });
  it('cycle transitions mirror the database (one-way, final states)', () => {
    expect(CYCLE_TRANSITIONS).toEqual({ SCHEDULED: ['OPEN', 'CANCELLED'], OPEN: ['CLOSED', 'CANCELLED'], CLOSED: [], CANCELLED: [] });
  });
});

describe('answering', () => {
  const qs: FormQuestion[] = [
    { questionnaire_item_id: 1, response_type: 'RATING', is_required: true, question_text: 'r', choices: [] },
    { questionnaire_item_id: 2, response_type: 'SINGLE_CHOICE', is_required: true, question_text: 's', choices: [{ id: 10, text: 'a' }] },
    { questionnaire_item_id: 3, response_type: 'MULTIPLE_CHOICE', is_required: false, question_text: 'm', choices: [{ id: 11, text: 'b' }, { id: 12, text: 'c' }] },
    { questionnaire_item_id: 4, response_type: 'TEXT', is_required: false, question_text: 't', choices: [] },
  ];
  it('reports every missing required answer and nothing for optional ones', () => {
    expect(validateAnswers(qs, {})).toEqual({ 1: 'This question is required', 2: 'This question is required' });
    expect(validateAnswers(qs, { 1: { score: 4 }, 2: { choiceId: 10 } })).toEqual({});
  });
  it('rejects out-of-range ratings and overlong text; treats blank text and an empty selection as unanswered', () => {
    expect(validateAnswers(qs, { 1: { score: 6 }, 2: { choiceId: 10 } })).toEqual({ 1: 'Choose 1 to 5' });
    expect(validateAnswers(qs, { 1: { score: 0 }, 2: { choiceId: 10 } })).toEqual({ 1: 'Choose 1 to 5' });
    expect(validateAnswers(qs, { 1: { score: 3 }, 2: { choiceId: 10 }, 4: { text: 'x'.repeat(2001) } })).toEqual({ 4: 'At most 2000 characters' });
    expect(validateAnswers(qs, { 1: { score: 3 }, 2: { choiceId: 10 }, 3: { choiceIds: [] }, 4: { text: '   ' } })).toEqual({});
  });
  it('builds the RPC payload: trimmed text, sorted multi-choice, no unanswered optional questions', () => {
    expect(buildAnswers(qs, { 1: { score: 4 }, 2: { choiceId: 10 }, 3: { choiceIds: [12, 11] }, 4: { text: '  fine  ' } })).toEqual([
      { questionnaire_item_id: 1, score: 4 }, { questionnaire_item_id: 2, choice_id: 10 }, { questionnaire_item_id: 3, choice_ids: [11, 12] }, { questionnaire_item_id: 4, text: 'fine' },
    ]);
    expect(buildAnswers(qs, { 1: { score: 4 }, 2: { choiceId: 10 }, 3: { choiceIds: [] }, 4: { text: ' ' } })).toEqual([{ questionnaire_item_id: 1, score: 4 }, { questionnaire_item_id: 2, choice_id: 10 }]);
  });
  it('parseFbId accepts only positive integers', () => {
    expect(parseFbId('9')).toBe(9);
    for (const bad of [undefined, '', '0', '-1', '1.5', 'x', '99999999999999999999']) expect(parseFbId(bad)).toBeNull();
  });
});
