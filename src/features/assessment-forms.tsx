'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { DeleteButton } from '@/features/academic-forms';
import type { ComponentRow, CourseSheetRow, EventRow, MarkSheetRow, RuleRow, ScaleRow, TermSheetRow } from '@/features/assessment-data';
import {
  buildMarkEntries, componentSchema, COMPONENT_TYPES, eventSchema, EXPLICIT_RESULT_STATUSES, gradeRuleSchema, gradeScaleSchema, MARK_STATUSES, RESULT_STATUSES,
  validateMarkRow, validateResultRow,
  type ComponentInput, type ComponentValues, type EventInput, type EventValues, type GradeRuleInput, type GradeRuleValues, type GradeScaleInput, type GradeScaleValues,
  type MarkRow, type ResultRow,
} from '@/lib/assessment-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023') return e.message;
  if (e.code === '42501') return /Not authorised/.test(e.message) ? e.message : 'You are not allowed to do that for this programme.';
  if (e.code === '23505') return 'That already exists.';
  if (e.code === '23503') return 'It is referenced by other records, or a selected option does not exist.';
  if (e.code === '23514') return 'The values break a database rule (check the marks and dates).';
  return fallback;
}
const nul = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);

function Check({ id, label, ...rest }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label htmlFor={id} className="flex items-center gap-2 text-sm"><input id={id} type="checkbox" {...rest} /> {label}</label>;
}
const cell = 'h-8 w-full rounded-md border border-border bg-card px-2 text-sm';

// ---------------------------------------------------------------------------
export function ComponentManager({ offeringId, components, canManage }: { offeringId: number; components: ComponentRow[]; canManage: boolean }) {
  const router = useRouter();
  const form = useForm<ComponentInput, unknown, ComponentValues>({ resolver: zodResolver(componentSchema), defaultValues: { component_type: 'INTERNAL_TEST', is_mandatory: true } });
  async function create(v: ComponentValues) {
    const { error } = await createClient().from('assessment_component').insert({ course_offering_id: offeringId, ...v, weightage_percent: nul(v.weightage_percent) });
    if (error) return void toast.error(dbMessage(error, 'Could not add the component.'));
    toast.success('Component added.');
    form.reset({ component_code: '', component_name: '', component_type: 'INTERNAL_TEST', maximum_marks: '', weightage_percent: '', is_mandatory: true });
    router.refresh();
  }
  return (
    <div className="space-y-4">
      {components.length === 0 ? <p className="text-sm text-muted-foreground">No assessment components yet.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {components.map((c) => (
            <li key={c.assessment_component_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span><span className="font-medium">{c.component_code}</span> · {c.component_name} · {c.component_type} · max {c.maximum_marks}{c.weightage_percent !== null ? ` · ${c.weightage_percent}%` : ''}{c.is_mandatory ? ' · mandatory' : ''}</span>
              {canManage && <DeleteButton table="assessment_component" id={c.assessment_component_id} label="component" />}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={form.handleSubmit(create)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Add component">
          <TextField id="cc" label="Code *" className="w-28" maxLength={30} {...form.register('component_code')} error={form.formState.errors.component_code?.message} />
          <TextField id="cn" label="Name *" className="w-48" maxLength={100} {...form.register('component_name')} error={form.formState.errors.component_name?.message} />
          <div className="w-44">
            <label htmlFor="ct" className="text-sm font-medium">Type *</label>
            <select id="ct" className={cell} {...form.register('component_type')}>{COMPONENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </div>
          <TextField id="cm" label="Max marks *" className="w-28" inputMode="decimal" {...form.register('maximum_marks')} error={form.formState.errors.maximum_marks?.message} />
          <TextField id="cw" label="Weightage %" className="w-28" inputMode="decimal" {...form.register('weightage_percent')} error={form.formState.errors.weightage_percent?.message} />
          <div className="pt-6"><Check id="cmand" label="Mandatory" {...form.register('is_mandatory')} /></div>
          <div className="pt-6"><Button type="submit" disabled={form.formState.isSubmitting}>Add component</Button></div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function EventManager({ offeringId, components, events, canManage }: { offeringId: number; components: ComponentRow[]; events: EventRow[]; canManage: boolean }) {
  const router = useRouter();
  const [componentId, setComponentId] = useState('');
  const form = useForm<EventInput, unknown, EventValues>({ resolver: zodResolver(eventSchema) });
  const byId = new Map(components.map((c) => [c.assessment_component_id, c]));
  async function create(v: EventValues) {
    if (!componentId) return void toast.error('Choose a component.');
    const { error } = await createClient().from('assessment_event').insert({
      course_offering_id: offeringId, assessment_component_id: Number(componentId), event_title: v.event_title, assessment_date: v.assessment_date,
      start_time: nul(v.start_time), end_time: nul(v.end_time), maximum_marks: v.maximum_marks, reduced_maximum_marks: nul(v.reduced_maximum_marks), event_number: nul(v.event_number), details: nul(v.details),
    });
    if (error) return void toast.error(dbMessage(error, 'Could not schedule the event.'));
    toast.success('Event scheduled.');
    form.reset({ event_title: '', assessment_date: '', start_time: '', end_time: '', maximum_marks: '', reduced_maximum_marks: '', event_number: '', details: '' });
    router.refresh();
  }
  return (
    <div className="space-y-4">
      {events.length === 0 ? <p className="text-sm text-muted-foreground">No assessment events yet.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {events.map((e) => (
            <li key={e.assessment_event_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span>
                <Link href={`/assessment/event/${e.assessment_event_id}`} className="font-medium text-primary underline-offset-4 hover:underline">{e.event_title}</Link>
                {' '}· {byId.get(e.assessment_component_id)?.component_code ?? '—'} · {e.assessment_date} · max {e.maximum_marks} · <span className="font-medium">{e.status}</span>
              </span>
              {canManage && e.status === 'PLANNED' && <DeleteButton table="assessment_event" id={e.assessment_event_id} label="event" />}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        components.length === 0 ? <p className="text-sm text-muted-foreground">Add a component before scheduling events.</p> : (
          <form onSubmit={form.handleSubmit(create)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Schedule event">
            <SelectField id="ec" label="Component *" className="w-48" value={componentId} onChange={(e) => setComponentId(e.target.value)} options={components.map((c) => ({ id: c.assessment_component_id, label: `${c.component_code} — ${c.component_name}` }))} />
            <TextField id="et" label="Title *" className="w-52" maxLength={150} {...form.register('event_title')} error={form.formState.errors.event_title?.message} />
            <TextField id="ed" label="Date *" type="date" className="w-40" {...form.register('assessment_date')} error={form.formState.errors.assessment_date?.message} />
            <TextField id="es" label="Start" type="time" className="w-28" {...form.register('start_time')} error={form.formState.errors.start_time?.message} />
            <TextField id="ee" label="End" type="time" className="w-28" {...form.register('end_time')} error={form.formState.errors.end_time?.message} />
            <TextField id="em" label="Max marks *" className="w-28" inputMode="decimal" {...form.register('maximum_marks')} error={form.formState.errors.maximum_marks?.message} />
            <TextField id="er" label="Reduced max" className="w-28" inputMode="decimal" {...form.register('reduced_maximum_marks')} error={form.formState.errors.reduced_maximum_marks?.message} />
            <TextField id="en" label="Event no." className="w-24" inputMode="numeric" {...form.register('event_number')} error={form.formState.errors.event_number?.message} />
            <div className="pt-6"><Button type="submit" disabled={form.formState.isSubmitting}>Schedule</Button></div>
          </form>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function MarksSheet({ eventId, maxMarks, reducedMax, rows, canEnter, locked }: { eventId: number; maxMarks: number; reducedMax: number | null; rows: MarkSheetRow[]; canEnter: boolean; locked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<MarkRow[]>(() =>
    rows.map((r) => ({
      course_registration_id: r.course_registration_id, status: r.attendance_status ?? 'PRESENT', marks: r.marks_obtained === null ? '' : String(r.marks_obtained),
      reduced: r.reduced_marks === null ? '' : String(r.reduced_marks), remarks: r.remarks ?? '', touched: false,
    })),
  );
  const errors = state.map((r) => (r.touched ? validateMarkRow(r, maxMarks, reducedMax) : null));
  const readOnly = !canEnter || locked;
  const patch = (i: number, p: Partial<MarkRow>) => setState((s) => s.map((r, k) => (k === i ? { ...r, ...p, touched: true } : r)));

  async function save() {
    const bad = state.findIndex((r) => r.touched && validateMarkRow(r, maxMarks, reducedMax));
    if (bad >= 0) return void toast.error(`Fix the entry for ${rows[bad]?.display_name ?? 'a student'} first.`);
    const entries = buildMarkEntries(state);
    if (entries.length === 0) return void toast.message('Nothing has changed.');
    setBusy(true);
    const { data, error } = await createClient().rpc('assessment_enter_marks', { p_event_id: eventId, p_marks: entries });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'Could not save the marks.'));
    toast.success(`${data as number} entr${data === 1 ? 'y' : 'ies'} saved.`);
    router.refresh();
  }

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No students are registered for this course offering.</p>;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr>
            <th scope="col" className="px-3 py-2 font-medium">Student</th><th scope="col" className="px-3 py-2 font-medium">Attendance</th>
            <th scope="col" className="px-3 py-2 font-medium">Marks (max {maxMarks})</th>{reducedMax !== null && <th scope="col" className="px-3 py-2 font-medium">Reduced (max {reducedMax})</th>}
            <th scope="col" className="px-3 py-2 font-medium">Remarks</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const s = state[i];
              if (!s) return null;
              return (
                <tr key={r.course_registration_id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2">{r.display_name}<div className="text-xs text-muted-foreground">{r.student_number}</div></td>
                  <td className="px-3 py-2"><select aria-label={`Attendance for ${r.display_name}`} className={cell} disabled={readOnly} value={s.status} onChange={(e) => patch(i, { status: e.target.value, ...(e.target.value !== 'PRESENT' ? { marks: '', reduced: '' } : {}) })}>{MARK_STATUSES.map((m) => <option key={m} value={m}>{m}</option>)}</select></td>
                  <td className="px-3 py-2"><input aria-label={`Marks for ${r.display_name}`} className={cell} inputMode="decimal" disabled={readOnly || s.status !== 'PRESENT'} value={s.marks} onChange={(e) => patch(i, { marks: e.target.value })} aria-invalid={!!errors[i]} />{errors[i] && <p role="alert" className="mt-1 text-xs text-destructive">{errors[i]}</p>}</td>
                  {reducedMax !== null && <td className="px-3 py-2"><input aria-label={`Reduced marks for ${r.display_name}`} className={cell} inputMode="decimal" disabled={readOnly || s.status !== 'PRESENT'} value={s.reduced} onChange={(e) => patch(i, { reduced: e.target.value })} /></td>}
                  <td className="px-3 py-2"><input aria-label={`Remarks for ${r.display_name}`} className={cell} maxLength={500} disabled={readOnly} value={s.remarks} onChange={(e) => patch(i, { remarks: e.target.value })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {locked && <p className="text-sm text-muted-foreground">Marks of a published or cancelled event cannot be changed.</p>}
      {!locked && !canEnter && <p className="text-sm text-muted-foreground">You can view these marks but not enter them.</p>}
      {!readOnly && <Button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save marks'}</Button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function CourseResultSheet({ rows, internalMax, externalMax, canRecord }: { rows: CourseSheetRow[]; internalMax: number | null; externalMax: number | null; canRecord: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ResultRow[]>(() =>
    rows.map((r) => ({
      course_registration_id: r.course_registration_id, internal: r.internal_marks === null ? '' : String(r.internal_marks), external: r.external_marks === null ? '' : String(r.external_marks),
      status: r.result_status && (EXPLICIT_RESULT_STATUSES as readonly string[]).includes(r.result_status) ? r.result_status : '', touched: false,
    })),
  );
  const errors = state.map((r) => (r.touched ? validateResultRow(r, internalMax, externalMax) : null));
  const patch = (i: number, p: Partial<ResultRow>) => setState((s) => s.map((r, k) => (k === i ? { ...r, ...p, touched: true } : r)));

  async function save() {
    const bad = state.findIndex((r) => r.touched && validateResultRow(r, internalMax, externalMax));
    if (bad >= 0) return void toast.error(`Fix the entry for ${rows[bad]?.display_name ?? 'a student'} first.`);
    const touched = state.filter((r) => r.touched);
    if (touched.length === 0) return void toast.message('Nothing has changed.');
    setBusy(true);
    const supabase = createClient();
    let ok = 0;
    for (const r of touched) {
      const attempt = rows.find((x) => x.course_registration_id === r.course_registration_id)?.attempt_number ?? 1;
      const { error } = await supabase.rpc('result_record_course', {
        p_course_registration_id: r.course_registration_id, p_internal: r.status ? null : Number(r.internal), p_external: r.status ? null : Number(r.external), p_attempt: attempt, p_status: r.status || null,
      });
      if (error) { setBusy(false); toast.error(`${rows.find((x) => x.course_registration_id === r.course_registration_id)?.display_name ?? 'Entry'}: ${dbMessage(error, 'could not be saved.')}${ok ? ` (${ok} saved before this)` : ''}`); router.refresh(); return; }
      ok++;
    }
    setBusy(false);
    toast.success(`${ok} result${ok === 1 ? '' : 's'} recorded.`);
    router.refresh();
  }

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No students are registered for this course offering.</p>;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr>
            <th scope="col" className="px-3 py-2 font-medium">Student</th><th scope="col" className="px-3 py-2 font-medium">Internal{internalMax !== null ? ` (max ${internalMax})` : ''}</th>
            <th scope="col" className="px-3 py-2 font-medium">External{externalMax !== null ? ` (max ${externalMax})` : ''}</th><th scope="col" className="px-3 py-2 font-medium">Explicit status</th>
            <th scope="col" className="px-3 py-2 font-medium">Recorded</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const s = state[i];
              if (!s) return null;
              return (
                <tr key={r.course_registration_id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2">{r.display_name}<div className="text-xs text-muted-foreground">{r.student_number}</div></td>
                  <td className="px-3 py-2"><input aria-label={`Internal marks for ${r.display_name}`} className={cell} inputMode="decimal" disabled={!canRecord || !!s.status} value={s.internal} onChange={(e) => patch(i, { internal: e.target.value })} aria-invalid={!!errors[i]} />{errors[i] && <p role="alert" className="mt-1 text-xs text-destructive">{errors[i]}</p>}</td>
                  <td className="px-3 py-2"><input aria-label={`External marks for ${r.display_name}`} className={cell} inputMode="decimal" disabled={!canRecord || !!s.status} value={s.external} onChange={(e) => patch(i, { external: e.target.value })} /></td>
                  <td className="px-3 py-2"><select aria-label={`Status for ${r.display_name}`} className={cell} disabled={!canRecord} value={s.status} onChange={(e) => patch(i, { status: e.target.value })}><option value="">Compute from marks</option>{EXPLICIT_RESULT_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select></td>
                  <td className="px-3 py-2 text-xs">{r.result_status ? <>{r.result_status}{r.grade_letter ? ` · ${r.grade_letter}` : ''}{r.total_marks !== null ? ` · ${r.total_marks}` : ''}{r.published ? ' · published' : ''}</> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canRecord && <Button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Record results'}</Button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function TermResultTable({ rows, canCompute, canPublish }: { rows: TermSheetRow[]; canCompute: boolean; canPublish: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  async function run(id: number, fn: 'compute' | 'publish' | 'unpublish') {
    setBusy(id);
    const supabase = createClient();
    const { error } = fn === 'compute' ? await supabase.rpc('result_compute_term', { p_term_registration_id: id }) : await supabase.rpc('result_publish_term', { p_term_registration_id: id, p_publish: fn === 'publish' });
    setBusy(null);
    if (error) return void toast.error(dbMessage(error, 'The action could not be completed.'));
    toast.success(fn === 'compute' ? 'Term result computed.' : fn === 'publish' ? 'Result published.' : 'Result unpublished.');
    router.refresh();
  }
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No students have a term registration in this offering.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted text-left"><tr>
          <th scope="col" className="px-3 py-2 font-medium">Student</th><th scope="col" className="px-3 py-2 font-medium">Credits (earned / registered)</th>
          <th scope="col" className="px-3 py-2 font-medium">SGPA</th><th scope="col" className="px-3 py-2 font-medium">CGPA</th><th scope="col" className="px-3 py-2 font-medium">Status</th>
          <th scope="col" className="px-3 py-2 font-medium">Actions</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.term_registration_id} className="border-b border-border last:border-0">
              <td className="px-3 py-2">{r.display_name}<div className="text-xs text-muted-foreground">{r.student_number}</div></td>
              <td className="px-3 py-2">{r.credits_registered === null ? '—' : `${r.credits_earned ?? 0} / ${r.credits_registered}`}</td>
              <td className="px-3 py-2">{r.sgpa ?? '—'}</td><td className="px-3 py-2">{r.cgpa ?? '—'}</td>
              <td className="px-3 py-2">{r.result_status ?? 'Not computed'}{r.published_at ? ' · published' : ''}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  {canCompute && !r.published_at && <Button type="button" variant="outline" disabled={busy === r.term_registration_id} onClick={() => run(r.term_registration_id, 'compute')}>Compute</Button>}
                  {canPublish && r.result_status && !r.published_at && <Button type="button" disabled={busy === r.term_registration_id} onClick={() => run(r.term_registration_id, 'publish')}>Publish</Button>}
                  {canPublish && r.published_at && <Button type="button" variant="outline" disabled={busy === r.term_registration_id} onClick={() => run(r.term_registration_id, 'unpublish')}>Unpublish</Button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function GradeManager({ scales, rules, canManage }: { scales: ScaleRow[]; rules: RuleRow[]; canManage: boolean }) {
  const router = useRouter();
  const scaleForm = useForm<GradeScaleInput, unknown, GradeScaleValues>({ resolver: zodResolver(gradeScaleSchema), defaultValues: { is_active: true } });
  const ruleForm = useForm<GradeRuleInput, unknown, GradeRuleValues>({ resolver: zodResolver(gradeRuleSchema), defaultValues: { result_status: 'PASS' } });
  const [ruleScale, setRuleScale] = useState('');

  async function addScale(v: GradeScaleValues) {
    const { error } = await createClient().from('grade_scale').insert({ ...v, effective_to: nul(v.effective_to) });
    if (error) return void toast.error(dbMessage(error, 'Could not add the grade scale.'));
    toast.success('Grade scale added.');
    scaleForm.reset({ scale_name: '', effective_from: '', effective_to: '', is_active: true });
    router.refresh();
  }
  async function addRule(v: GradeRuleValues) {
    if (!ruleScale) return void toast.error('Choose a grade scale.');
    const { error } = await createClient().from('grade_rule').insert({ grade_scale_id: Number(ruleScale), ...v });
    if (error) return void toast.error(dbMessage(error, 'Could not add the grade rule.'));
    toast.success('Grade rule added.');
    ruleForm.reset({ grade_letter: '', grade_point: '', minimum_percentage: '', maximum_percentage: '', result_status: 'PASS' });
    router.refresh();
  }
  return (
    <div className="space-y-6">
      {scales.length === 0 ? <p className="text-sm text-muted-foreground">No grade scales yet. Without an active scale, results cannot be graded.</p> : scales.map((s) => (
        <div key={s.grade_scale_id} className="rounded-md border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm">
            <span><span className="font-medium">{s.scale_name}</span> · from {s.effective_from}{s.effective_to ? ` to ${s.effective_to}` : ''} · {s.is_active ? 'active' : 'inactive'}</span>
            {canManage && <DeleteButton table="grade_scale" id={s.grade_scale_id} label="grade scale" />}
          </div>
          <ul className="divide-y divide-border text-sm">
            {rules.filter((r) => r.grade_scale_id === s.grade_scale_id).map((r) => (
              <li key={r.grade_rule_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5">
                <span><span className="font-medium">{r.grade_letter}</span> · {r.grade_point} pts · {r.minimum_percentage}–{r.maximum_percentage}% · {r.result_status}</span>
                {canManage && <DeleteButton table="grade_rule" id={r.grade_rule_id} label="grade rule" />}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {canManage && (
        <>
          <form onSubmit={scaleForm.handleSubmit(addScale)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Add grade scale">
            <TextField id="gsn" label="Scale name *" className="w-52" maxLength={100} {...scaleForm.register('scale_name')} error={scaleForm.formState.errors.scale_name?.message} />
            <TextField id="gsf" label="Effective from *" type="date" className="w-40" {...scaleForm.register('effective_from')} error={scaleForm.formState.errors.effective_from?.message} />
            <TextField id="gst" label="Effective to" type="date" className="w-40" {...scaleForm.register('effective_to')} error={scaleForm.formState.errors.effective_to?.message} />
            <div className="pt-6"><Check id="gsa" label="Active" {...scaleForm.register('is_active')} /></div>
            <div className="pt-6"><Button type="submit" disabled={scaleForm.formState.isSubmitting}>Add scale</Button></div>
          </form>
          {scales.length > 0 && (
            <form onSubmit={ruleForm.handleSubmit(addRule)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Add grade rule">
              <SelectField id="grs" label="Scale *" className="w-48" value={ruleScale} onChange={(e) => setRuleScale(e.target.value)} options={scales.map((s) => ({ id: s.grade_scale_id, label: s.scale_name }))} />
              <TextField id="grl" label="Letter *" className="w-20" maxLength={5} {...ruleForm.register('grade_letter')} error={ruleForm.formState.errors.grade_letter?.message} />
              <TextField id="grp" label="Grade point *" className="w-28" inputMode="decimal" {...ruleForm.register('grade_point')} error={ruleForm.formState.errors.grade_point?.message} />
              <TextField id="grn" label="Min % *" className="w-24" inputMode="decimal" {...ruleForm.register('minimum_percentage')} error={ruleForm.formState.errors.minimum_percentage?.message} />
              <TextField id="grx" label="Max % *" className="w-24" inputMode="decimal" {...ruleForm.register('maximum_percentage')} error={ruleForm.formState.errors.maximum_percentage?.message} />
              <div className="w-32"><label htmlFor="grt" className="text-sm font-medium">Result *</label><select id="grt" className={cell} {...ruleForm.register('result_status')}>{RESULT_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
              <div className="pt-6"><Button type="submit" disabled={ruleForm.formState.isSubmitting}>Add rule</Button></div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
