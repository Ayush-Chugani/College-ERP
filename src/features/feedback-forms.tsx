'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { CycleRow, ItemRow, Opt, QuestionnaireRow, QuestionRow } from '@/features/feedback-data';
import { StatusControl } from '@/features/registration-forms';
import {
  buildAnswers, categorySchema, CYCLE_TRANSITIONS, cycleSchema, itemSchema, parseChoices, QUESTIONNAIRE_STATUSES, QUESTIONNAIRE_TYPES, questionnaireSchema, questionSchema, RATING_MAX,
  RESPONSE_TYPES, TEXT_MAX, validateAnswers, VISIBILITIES,
  type AnswerState, type CategoryInput, type CategoryValues, type CycleInput, type CycleValues, type FormQuestion, type ItemInput, type ItemValues, type QuestionInput,
  type QuestionnaireInput, type QuestionnaireValues, type QuestionValues,
} from '@/lib/feedback-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
/** Rule messages raised by the feedback RPCs and guards are safe to show; anything else is generic. */
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023') return e.message;
  if (e.code === '42501') return /Not authorised|Only students/.test(e.message) ? e.message : 'You are not allowed to do that.';
  if (e.code === '23505') return 'That already exists.';
  if (e.code === '23503') return 'It is referenced by other records, or a selected option does not exist.';
  return fallback;
}
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
function Check({ id, label, ...rest }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label htmlFor={id} className="flex items-center gap-2 text-sm"><input id={id} type="checkbox" {...rest} /> {label}</label>;
}

// ---------------------------------------------------------------------------
export function FeedbackForm({ cycleId, courseOfferingId, facultyAssignmentId, questions, anonymous }: { cycleId: number; courseOfferingId: number | null; facultyAssignmentId: number | null; questions: FormQuestion[]; anonymous: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<AnswerState>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const patch = (id: number, p: AnswerState[number]) => setState((s) => ({ ...s, [id]: { ...s[id], ...p } }));

  async function submit() {
    const errs = validateAnswers(questions, state);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return void toast.error('Please complete the highlighted questions.');
    setBusy(true);
    const { data, error } = await createClient().rpc('feedback_submit', { p_cycle_id: cycleId, p_course_offering_id: courseOfferingId, p_faculty_assignment_id: facultyAssignmentId, p_answers: buildAnswers(questions, state) });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'Your feedback could not be submitted.'));
    setReceipt(String(data));
    toast.success('Thank you. Your feedback was submitted.');
    router.refresh();
  }

  if (receipt)
    return (
      <div role="status" className="space-y-2 rounded-md border border-border bg-muted p-4 text-sm">
        <p className="font-medium">Your feedback has been submitted.</p>
        <p>Receipt: <code>{receipt}</code></p>
        {anonymous && <p className="text-muted-foreground">This feedback is anonymous. The receipt is the only trace of it you will have; nobody can look it up by your name.</p>}
        <a href="/feedback" className="text-primary underline-offset-4 hover:underline">Back to feedback</a>
      </div>
    );
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-5" noValidate aria-label="Feedback form">
      {questions.map((q, i) => {
        const a = state[q.questionnaire_item_id];
        const err = errors[q.questionnaire_item_id];
        const name = `q${q.questionnaire_item_id}`;
        return (
          <fieldset key={q.questionnaire_item_id} className="space-y-2" aria-describedby={err ? `${name}-err` : undefined}>
            <legend className="text-sm font-medium">{i + 1}. {q.question_text}{q.is_required ? <span aria-hidden> *</span> : <span className="font-normal text-muted-foreground"> (optional)</span>}</legend>
            {q.response_type === 'RATING' && (
              <div className="flex flex-wrap items-center gap-3">
                {Array.from({ length: RATING_MAX }, (_, k) => k + 1).map((n) => (
                  <label key={n} className="flex items-center gap-1 text-sm"><input type="radio" name={name} checked={a?.score === n} onChange={() => patch(q.questionnaire_item_id, { score: n })} /> {n}</label>
                ))}
                <span className="text-xs text-muted-foreground">1 = lowest, {RATING_MAX} = highest</span>
              </div>
            )}
            {q.response_type === 'SINGLE_CHOICE' && q.choices.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm"><input type="radio" name={name} checked={a?.choiceId === c.id} onChange={() => patch(q.questionnaire_item_id, { choiceId: c.id })} /> {c.text}</label>
            ))}
            {q.response_type === 'MULTIPLE_CHOICE' && q.choices.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={a?.choiceIds?.includes(c.id) ?? false} onChange={(e) => patch(q.questionnaire_item_id, { choiceIds: e.target.checked ? [...(a?.choiceIds ?? []), c.id] : (a?.choiceIds ?? []).filter((x) => x !== c.id) })} /> {c.text}
              </label>
            ))}
            {q.response_type === 'TEXT' && (
              <textarea aria-label={q.question_text} rows={3} maxLength={TEXT_MAX} value={a?.text ?? ''} onChange={(e) => patch(q.questionnaire_item_id, { text: e.target.value })} className="w-full rounded-md border border-border bg-card p-2 text-sm" />
            )}
            {err && <p id={`${name}-err`} role="alert" className="text-sm text-destructive">{err}</p>}
          </fieldset>
        );
      })}
      <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit feedback'}</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function SetupManager({ categories, questions, choices, questionnaires, items, cycles, terms, canManage }: {
  categories: { feedback_category_id: number; category_code: string; category_name: string }[]; questions: QuestionRow[];
  choices: { feedback_choice_id: number; feedback_question_id: number; choice_text: string }[]; questionnaires: QuestionnaireRow[]; items: ItemRow[]; cycles: CycleRow[]; terms: Opt[]; canManage: boolean;
}) {
  const router = useRouter();
  const [questionnaireId, setQuestionnaireId] = useState('');
  const cat = useForm<CategoryInput, unknown, CategoryValues>({ resolver: zodResolver(categorySchema) });
  const que = useForm<QuestionInput, unknown, QuestionValues>({ resolver: zodResolver(questionSchema), defaultValues: { response_type: 'RATING', choices: '' } });
  const qn = useForm<QuestionnaireInput, unknown, QuestionnaireValues>({ resolver: zodResolver(questionnaireSchema), defaultValues: { questionnaire_type: 'COURSE', is_anonymous: true } });
  const itm = useForm<ItemInput, unknown, ItemValues>({ resolver: zodResolver(itemSchema), defaultValues: { display_order: '1', is_required: true } });
  const cyc = useForm<CycleInput, unknown, CycleValues>({ resolver: zodResolver(cycleSchema), defaultValues: { result_visibility: 'ADMIN_ONLY' } });
  const done = (msg: string) => { toast.success(msg); router.refresh(); };

  async function addCategory(v: CategoryValues) {
    const { error } = await createClient().from('feedback_question_category').insert(v);
    if (error) return void toast.error(dbMessage(error, 'Could not add the category.'));
    cat.reset({ category_code: '', category_name: '' });
    done('Category added.');
  }
  async function addQuestion(v: QuestionValues) {
    const parsed = parseChoices(v.choices);
    if (!parsed.ok) return void que.setError('choices', { message: parsed.error });
    const supabase = createClient();
    const { data, error } = await supabase.from('feedback_question').insert({ feedback_category_id: v.feedback_category_id, question_text: v.question_text, response_type: v.response_type }).select('feedback_question_id').single();
    if (error || !data) return void toast.error(dbMessage(error ?? { message: '' }, 'Could not add the question.'));
    if (parsed.choices.length > 0) {
      const { error: ce } = await supabase.from('feedback_choice').insert(parsed.choices.map((c) => ({ ...c, feedback_question_id: (data as { feedback_question_id: number }).feedback_question_id })));
      if (ce) {
        await supabase.from('feedback_question').delete().eq('feedback_question_id', (data as { feedback_question_id: number }).feedback_question_id);
        return void toast.error(dbMessage(ce, 'The choices could not be saved, so the question was not added.'));
      }
    }
    que.reset({ question_text: '', response_type: 'RATING', choices: '' });
    done('Question added.');
  }
  async function addQuestionnaire(v: QuestionnaireValues) {
    const { error } = await createClient().from('feedback_questionnaire').insert({ ...v, status: 'DRAFT' });
    if (error) return void toast.error(dbMessage(error, 'Could not add the questionnaire.'));
    qn.reset({ questionnaire_code: '', questionnaire_name: '', questionnaire_type: 'COURSE', is_anonymous: true });
    done('Questionnaire added as a draft.');
  }
  async function addItem(v: ItemValues) {
    if (!questionnaireId) return void toast.error('Choose a questionnaire.');
    const { error } = await createClient().from('feedback_questionnaire_item').insert({ questionnaire_id: Number(questionnaireId), ...v });
    if (error) return void toast.error(dbMessage(error, 'Could not add the question to the questionnaire.'));
    itm.reset({ feedback_question_id: '', display_order: String(v.display_order + 1), is_required: true });
    done('Question added to the questionnaire.');
  }
  async function addCycle(v: CycleValues) {
    const { error } = await createClient().from('feedback_cycle').insert({ ...v, start_at: new Date(v.start_at).toISOString(), end_at: new Date(v.end_at).toISOString(), status: 'SCHEDULED' });
    if (error) return void toast.error(dbMessage(error, 'Could not schedule the cycle.'));
    cyc.reset({ cycle_name: '', start_at: '', end_at: '', result_visibility: 'ADMIN_ONLY' });
    done('Cycle scheduled.');
  }

  const qLabel = new Map(questions.map((q) => [q.feedback_question_id, q.question_text]));
  const choicesOf = (id: number) => choices.filter((c) => c.feedback_question_id === id).map((c) => c.choice_text);
  const nameOf = new Map(questionnaires.map((q) => [q.questionnaire_id, q.questionnaire_name]));
  const termOf = new Map(terms.map((t) => [t.id, t.label]));

  return (
    <div className="space-y-8">
      {!canManage && <p className="rounded-md border border-border bg-muted p-3 text-sm">Feedback configuration is shared across institutions, so changing it needs a global configuration permission. You can view it.</p>}

      <section aria-labelledby="h-cat" className="space-y-3">
        <h2 id="h-cat" className="text-base font-semibold">Question categories</h2>
        <p className="text-sm text-muted-foreground">{categories.length ? categories.map((c) => `${c.category_code} — ${c.category_name}`).join(' · ') : 'No categories yet.'}</p>
        {canManage && (
          <form onSubmit={cat.handleSubmit(addCategory)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Add category">
            <TextField id="fcc" label="Code *" className="w-32" maxLength={30} {...cat.register('category_code')} error={cat.formState.errors.category_code?.message} />
            <TextField id="fcn" label="Name *" className="w-56" maxLength={100} {...cat.register('category_name')} error={cat.formState.errors.category_name?.message} />
            <div className="pt-6"><Button type="submit" disabled={cat.formState.isSubmitting}>Add category</Button></div>
          </form>
        )}
      </section>

      <section aria-labelledby="h-q" className="space-y-3">
        <h2 id="h-q" className="text-base font-semibold">Questions</h2>
        {questions.length === 0 ? <p className="text-sm text-muted-foreground">No questions yet.</p> : (
          <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
            {questions.map((q) => (
              <li key={q.feedback_question_id} className="px-4 py-2"><span className="font-medium">{q.question_text}</span> <span className="text-muted-foreground">· {q.response_type}{choicesOf(q.feedback_question_id).length ? ` · ${choicesOf(q.feedback_question_id).join(' / ')}` : ''}</span></li>
            ))}
          </ul>
        )}
        {canManage && (
          <form onSubmit={que.handleSubmit(addQuestion)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Add question">
            <SelectField id="fqc" label="Category *" className="w-48" options={categories.map((c) => ({ id: c.feedback_category_id, label: c.category_name }))} emptyHint="Add a category first." {...que.register('feedback_category_id')} error={que.formState.errors.feedback_category_id?.message} />
            <TextField id="fqt" label="Question *" className="w-80" maxLength={1000} {...que.register('question_text')} error={que.formState.errors.question_text?.message} />
            <div className="w-44"><label htmlFor="fqr" className="text-sm font-medium">Answer type *</label><select id="fqr" className={sel} {...que.register('response_type')}>{RESPONSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            <div className="w-72">
              <label htmlFor="fqch" className="text-sm font-medium">Choices (choice questions)</label>
              <textarea id="fqch" rows={3} className="w-full rounded-md border border-border bg-card p-2 text-sm" placeholder={'One per line, optionally "text | score"'} {...que.register('choices')} />
              {que.formState.errors.choices?.message && <p role="alert" className="text-sm text-destructive">{que.formState.errors.choices.message}</p>}
            </div>
            <div className="pt-6"><Button type="submit" disabled={que.formState.isSubmitting}>Add question</Button></div>
          </form>
        )}
      </section>

      <section aria-labelledby="h-qn" className="space-y-3">
        <h2 id="h-qn" className="text-base font-semibold">Questionnaires</h2>
        {questionnaires.length === 0 ? <p className="text-sm text-muted-foreground">No questionnaires yet.</p> : questionnaires.map((q) => {
          const its = items.filter((i) => i.questionnaire_id === q.questionnaire_id);
          return (
            <div key={q.questionnaire_id} className="rounded-md border border-border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium">{q.questionnaire_code}</span> · {q.questionnaire_name} · {q.questionnaire_type} · {q.is_anonymous ? 'anonymous' : 'named'} · <span className="font-medium">{q.status}</span></span>
                {canManage && <StatusControl table="feedback_questionnaire" id={q.questionnaire_id} current={q.status} options={QUESTIONNAIRE_STATUSES} compact />}
              </div>
              <ol className="mt-2 list-decimal space-y-0.5 pl-5">{its.map((i) => <li key={i.questionnaire_item_id}>{qLabel.get(i.feedback_question_id) ?? `Question ${i.feedback_question_id}`}{i.is_required ? '' : ' (optional)'}</li>)}</ol>
              {its.length === 0 && <p className="mt-1 text-muted-foreground">No questions in this questionnaire.</p>}
            </div>
          );
        })}
        {canManage && (
          <>
            <form onSubmit={qn.handleSubmit(addQuestionnaire)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Add questionnaire">
              <TextField id="fnc" label="Code *" className="w-32" maxLength={30} {...qn.register('questionnaire_code')} error={qn.formState.errors.questionnaire_code?.message} />
              <TextField id="fnn" label="Name *" className="w-64" maxLength={150} {...qn.register('questionnaire_name')} error={qn.formState.errors.questionnaire_name?.message} />
              <div className="w-40"><label htmlFor="fnt" className="text-sm font-medium">Type *</label><select id="fnt" className={sel} {...qn.register('questionnaire_type')}>{QUESTIONNAIRE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
              <div className="pt-6"><Check id="fna" label="Anonymous" {...qn.register('is_anonymous')} /></div>
              <div className="pt-6"><Button type="submit" disabled={qn.formState.isSubmitting}>Add questionnaire</Button></div>
            </form>
            <form onSubmit={itm.handleSubmit(addItem)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Add question to questionnaire">
              <SelectField id="fiq" label="Questionnaire *" className="w-64" value={questionnaireId} onChange={(e) => setQuestionnaireId(e.target.value)} options={questionnaires.map((q) => ({ id: q.questionnaire_id, label: q.questionnaire_name }))} />
              <SelectField id="fiqq" label="Question *" className="w-80" options={questions.map((q) => ({ id: q.feedback_question_id, label: q.question_text.slice(0, 70) }))} {...itm.register('feedback_question_id')} error={itm.formState.errors.feedback_question_id?.message} />
              <TextField id="fio" label="Order *" className="w-20" inputMode="numeric" {...itm.register('display_order')} error={itm.formState.errors.display_order?.message} />
              <div className="pt-6"><Check id="fir" label="Required" {...itm.register('is_required')} /></div>
              <div className="pt-6"><Button type="submit" variant="outline" disabled={itm.formState.isSubmitting}>Add to questionnaire</Button></div>
            </form>
          </>
        )}
      </section>

      <section aria-labelledby="h-cy" className="space-y-3">
        <h2 id="h-cy" className="text-base font-semibold">Feedback cycles</h2>
        {cycles.length === 0 ? <p className="text-sm text-muted-foreground">No cycles yet.</p> : cycles.map((c) => (
          <div key={c.feedback_cycle_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3 text-sm">
            <span><span className="font-medium">{c.cycle_name}</span> · {nameOf.get(c.questionnaire_id) ?? '—'} · {termOf.get(c.academic_term_id) ?? '—'} · {new Date(c.start_at).toLocaleString()} → {new Date(c.end_at).toLocaleString()} · results {c.result_visibility.toLowerCase().replace('_', ' ')} · <span className="font-medium">{c.status}</span></span>
            {canManage && <StatusControl table="feedback_cycle" id={c.feedback_cycle_id} current={c.status} options={CYCLE_TRANSITIONS[c.status] ?? []} compact />}
          </div>
        ))}
        {canManage && (
          <form onSubmit={cyc.handleSubmit(addCycle)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Schedule cycle">
            <SelectField id="fyq" label="Questionnaire *" className="w-56" options={questionnaires.filter((q) => q.status === 'ACTIVE').map((q) => ({ id: q.questionnaire_id, label: q.questionnaire_name }))} emptyHint="Only ACTIVE questionnaires can run." {...cyc.register('questionnaire_id')} error={cyc.formState.errors.questionnaire_id?.message} />
            <SelectField id="fyt" label="Term *" className="w-44" options={terms} {...cyc.register('academic_term_id')} error={cyc.formState.errors.academic_term_id?.message} />
            <TextField id="fyn" label="Name *" className="w-52" maxLength={150} {...cyc.register('cycle_name')} error={cyc.formState.errors.cycle_name?.message} />
            <TextField id="fys" label="Opens *" type="datetime-local" className="w-52" {...cyc.register('start_at')} error={cyc.formState.errors.start_at?.message} />
            <TextField id="fye" label="Closes *" type="datetime-local" className="w-52" {...cyc.register('end_at')} error={cyc.formState.errors.end_at?.message} />
            <div className="w-40"><label htmlFor="fyv" className="text-sm font-medium">Results visible to *</label><select id="fyv" className={sel} {...cyc.register('result_visibility')}>{VISIBILITIES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            <div className="pt-6"><Button type="submit" disabled={cyc.formState.isSubmitting}>Schedule cycle</Button></div>
          </form>
        )}
      </section>
    </div>
  );
}
