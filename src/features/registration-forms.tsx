'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { DeleteButton } from '@/features/academic-forms';
import type { BatchRow, CourseOfferingRow, CourseRegRow, Opt, RegLookups, SectionRow } from '@/features/registration-data';
import {
  batchSchema,
  courseRegSchema,
  COURSE_REG_NEXT,
  offeringSchema,
  OFFERING_STATUSES,
  registerStudentSchema,
  REGISTRATION_TYPES,
  sectionSchema,
  type BatchInput,
  type BatchValues,
  type CourseRegInput,
  type CourseRegValues,
  type OfferingInput,
  type OfferingValues,
  type RegisterStudentInput,
  type RegisterStudentValues,
  type SectionInput,
  type SectionValues,
} from '@/lib/registration-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };

/** Business-rule messages (capacity, ownership, approval) come from the database and are safe to show; row-level-security failures are generic. */
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023') return e.message;
  if (e.code === '42501') return /Not authorised to/.test(e.message) ? e.message : 'You are not allowed to do that for this programme.';
  if (e.code === '23505') return 'That already exists (codes and combinations must be unique).';
  if (e.code === '23503') return 'It is still referenced by other records, or a selected option does not exist.';
  if (e.code === '23514') return 'The values break a database rule.';
  return fallback;
}

const num = (v: number | undefined) => (v === undefined ? null : v);

// ---------------------------------------------------------------------------
export type StatusTable = 'programme_term_offering' | 'course_offering' | 'student_term_registration' | 'student_course_registration' | 'class_session' | 'assessment_event' | 'feedback_cycle' | 'feedback_questionnaire';
const PK: Record<StatusTable, { pk: string; col: string }> = {
  programme_term_offering: { pk: 'programme_term_offering_id', col: 'status' },
  course_offering: { pk: 'course_offering_id', col: 'status' },
  student_term_registration: { pk: 'term_registration_id', col: 'registration_status' },
  student_course_registration: { pk: 'course_registration_id', col: 'registration_status' },
  class_session: { pk: 'class_session_id', col: 'session_status' },
  assessment_event: { pk: 'assessment_event_id', col: 'status' },
  feedback_cycle: { pk: 'feedback_cycle_id', col: 'status' },
  feedback_questionnaire: { pk: 'questionnaire_id', col: 'status' },
};

/** Change a status with explicit confirmation. The database decides whether the caller may do it (e.g. APPROVE permission, capacity). */
export function StatusControl({ table, id, current, options, label = 'Status', compact = false }: { table: StatusTable; id: number; current: string; options: readonly string[]; label?: string; compact?: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const choices = options.filter((o) => o !== current);
  if (choices.length === 0) return compact ? null : <p className="text-sm text-muted-foreground">No further status changes.</p>;

  async function apply() {
    const { pk, col } = PK[table];
    setBusy(true);
    const { data, error } = await createClient().from(table).update({ [col]: target }).eq(pk, id).select(pk);
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The status could not be changed.'));
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success(`Status changed to ${target}.`);
    setConfirming(false);
    setTarget('');
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          {!compact && <Label htmlFor={`st_${table}_${id}`}>{label}</Label>}
          <select id={`st_${table}_${id}`} aria-label={`${label} (${current})`} value={target} onChange={(e) => { setTarget(e.target.value); setConfirming(false); }} className="h-9 rounded-md border border-border bg-card px-3 text-sm">
            <option value="">— {current} —</option>
            {choices.map((o) => (<option key={o} value={o}>{o}</option>))}
          </select>
        </div>
        <Button type="button" variant="outline" disabled={!target || confirming} onClick={() => setConfirming(true)}>Change…</Button>
      </div>
      {confirming && target && (
        <div role="alertdialog" aria-label="Confirm status change" className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="mb-2">Change status from <strong>{current}</strong> to <strong>{target}</strong>? This is recorded in the audit log.</p>
          <div className="flex gap-2">
            <Button type="button" variant={['CANCELLED', 'DROPPED', 'WITHDRAWN'].includes(target) ? 'destructive' : 'default'} disabled={busy} onClick={apply}>{busy ? 'Applying…' : 'Confirm'}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function OfferingForm({ lookups }: { lookups: RegLookups }) {
  const router = useRouter();
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<OfferingInput, unknown, OfferingValues>({ resolver: zodResolver(offeringSchema), defaultValues: { status: 'PLANNED' } });
  const programmeId = Number(watch('programme_id')) || undefined;
  const schemes = useMemo(() => lookups.schemes.filter((s) => s.programmeId === programmeId), [lookups.schemes, programmeId]);
  const e = errors as Record<string, { message?: string } | undefined>;

  async function onSubmit(v: OfferingValues) {
    const { data, error } = await createClient().from('programme_term_offering').insert(v).select('programme_term_offering_id');
    if (error) return void toast.error(error.code === '23505' ? 'An offering for this term, programme and semester already exists.' : dbMessage(error, 'Could not create the offering.'));
    if (!data || data.length === 0) return void toast.error('You are not allowed to create offerings for that programme.');
    toast.success('Offering created.');
    router.push(`/registration/${(data[0] as { programme_term_offering_id: number }).programme_term_offering_id}`);
    router.refresh();
  }
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <SelectField id="academic_term_id" label="Academic term *" options={lookups.terms} emptyHint="No academic terms exist yet." {...register('academic_term_id')} error={e.academic_term_id?.message} />
      <SelectField id="programme_id" label="Programme *" options={lookups.programmes} emptyHint="No programmes are visible to you." {...register('programme_id')} error={e.programme_id?.message} />
      <SelectField id="curriculum_scheme_id" label="Curriculum scheme *" options={schemes} emptyHint={programmeId ? 'This programme has no curriculum scheme yet.' : 'Select a programme first.'} {...register('curriculum_scheme_id')} error={e.curriculum_scheme_id?.message} />
      <SelectField id="semester_id" label="Semester *" options={lookups.semesters} emptyHint="No semesters exist yet." {...register('semester_id')} error={e.semester_id?.message} />
      <div>
        <Label htmlFor="status">Status</Label>
        <select id="status" className="flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm" {...register('status')}>{OFFERING_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}</select>
      </div>
      <div className="flex gap-3 sm:col-span-2">
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Create offering'}</Button>
        <Link href="/registration" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Cancel</Link>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function SectionManager({ offeringId, sections, batches, canManage }: { offeringId: number; sections: SectionRow[]; batches: BatchRow[]; canManage: boolean }) {
  const router = useRouter();
  const [batchFor, setBatchFor] = useState<number | null>(null);
  const sec = useForm<SectionInput, unknown, SectionValues>({ resolver: zodResolver(sectionSchema) });
  const bat = useForm<BatchInput, unknown, BatchValues>({ resolver: zodResolver(batchSchema) });

  async function addSection(v: SectionValues) {
    const { error } = await createClient().from('class_section').insert({ programme_term_offering_id: offeringId, section_code: v.section_code, section_name: v.section_name ?? null, capacity: num(v.capacity) });
    if (error) return void toast.error(error.code === '23505' ? 'That section code already exists in this offering.' : dbMessage(error, 'Could not add the section.'));
    toast.success('Section added.');
    sec.reset({ section_code: '', section_name: '', capacity: '' });
    router.refresh();
  }
  async function addBatch(sectionId: number, v: BatchValues) {
    const { error } = await createClient().from('class_batch').insert({ class_section_id: sectionId, batch_code: v.batch_code, batch_name: v.batch_name ?? null, capacity: num(v.capacity) });
    if (error) return void toast.error(error.code === '23505' ? 'That batch code already exists in this section.' : dbMessage(error, 'Could not add the batch.'));
    toast.success('Batch added.');
    bat.reset({ batch_code: '', batch_name: '', capacity: '' });
    setBatchFor(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {sections.length === 0 ? <p className="text-sm text-muted-foreground">No sections yet.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {sections.map((s) => (
            <li key={s.class_section_id} className="space-y-2 px-4 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium">Section {s.section_code}</span>{s.section_name ? ` · ${s.section_name}` : ''}<span className="text-muted-foreground"> · capacity {s.capacity ?? 'not limited'}</span></span>
                {canManage && (
                  <span className="flex items-start gap-2">
                    <Button type="button" variant="outline" onClick={() => setBatchFor(batchFor === s.class_section_id ? null : s.class_section_id)}>Add batch</Button>
                    <DeleteButton table="class_section" id={s.class_section_id} label="section" />
                  </span>
                )}
              </div>
              {batches.filter((b) => b.class_section_id === s.class_section_id).map((b) => (
                <div key={b.class_batch_id} className="ml-5 flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                  <span>Batch {b.batch_code}{b.batch_name ? ` · ${b.batch_name}` : ''} · capacity {b.capacity ?? 'not limited'}</span>
                  {canManage && <DeleteButton table="class_batch" id={b.class_batch_id} label="batch" />}
                </div>
              ))}
              {batchFor === s.class_section_id && (
                <form onSubmit={bat.handleSubmit((v) => addBatch(s.class_section_id, v))} className="ml-5 flex flex-wrap items-start gap-2" noValidate>
                  <TextField id={`bc${s.class_section_id}`} label="Batch code *" className="w-28" maxLength={20} {...bat.register('batch_code')} error={bat.formState.errors.batch_code?.message} />
                  <TextField id={`bn${s.class_section_id}`} label="Name" className="w-40" maxLength={100} {...bat.register('batch_name')} error={bat.formState.errors.batch_name?.message} />
                  <TextField id={`bp${s.class_section_id}`} label="Capacity" className="w-24" inputMode="numeric" {...bat.register('capacity')} error={bat.formState.errors.capacity?.message} />
                  <div className="pt-6"><Button type="submit">Add</Button></div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={sec.handleSubmit(addSection)} className="flex flex-wrap items-start gap-3" noValidate>
          <TextField id="sec_code" label="Section code *" className="w-32" maxLength={20} {...sec.register('section_code')} error={sec.formState.errors.section_code?.message} />
          <TextField id="sec_name" label="Name" className="w-48" maxLength={100} {...sec.register('section_name')} error={sec.formState.errors.section_name?.message} />
          <TextField id="sec_cap" label="Capacity" className="w-28" inputMode="numeric" hint="Blank = no limit" {...sec.register('capacity')} error={sec.formState.errors.capacity?.message} />
          <div className="pt-6"><Button type="submit" disabled={sec.formState.isSubmitting}>Add section</Button></div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function CourseOfferingManager({ offeringId, offerings, canManage, canGenerate }: { offeringId: number; offerings: CourseOfferingRow[]; canManage: boolean; canGenerate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cap, setCap] = useState<Record<number, string>>({});

  async function generate() {
    setBusy(true);
    const { data, error } = await createClient().rpc('offering_generate_courses', { p_programme_term_offering_id: offeringId });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'Could not generate course offerings.'));
    toast.success(Number(data) === 0 ? 'Nothing to add: every scheme course already has an offering.' : `${data} course offering(s) created from the curriculum scheme.`);
    router.refresh();
  }
  async function saveCap(o: CourseOfferingRow) {
    const raw = (cap[o.course_offering_id] ?? '').trim();
    if (raw !== '' && (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535)) return void toast.error('Capacity must be a whole number from 1 to 65535, or blank for no limit.');
    const { data, error } = await createClient().from('course_offering').update({ registration_capacity: raw === '' ? null : Number(raw) }).eq('course_offering_id', o.course_offering_id).select('course_offering_id');
    if (error) return void toast.error(dbMessage(error, 'Could not save the capacity.'));
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success('Capacity saved.');
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canGenerate && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={busy} onClick={generate}>{busy ? 'Generating…' : 'Generate from curriculum scheme'}</Button>
          <span className="text-xs text-muted-foreground">Creates an offering for each course the scheme lists for this semester. Existing ones are kept.</span>
        </div>
      )}
      {offerings.length === 0 ? <p className="text-sm text-muted-foreground">No course offerings yet.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {offerings.map((o) => (
            <li key={o.course_offering_id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-2">
              <span>
                <span className="font-medium">{o.code ?? `#${o.course_id}`}</span> {o.title}
                <br /><span className="text-muted-foreground">{o.offering_code} · {o.status} · capacity {o.registration_capacity ?? 'not limited'}</span>
              </span>
              {canManage && (
                <span className="flex flex-wrap items-start gap-2">
                  <input aria-label={`Capacity for ${o.offering_code}`} inputMode="numeric" placeholder="capacity" value={cap[o.course_offering_id] ?? ''} onChange={(e) => setCap({ ...cap, [o.course_offering_id]: e.target.value })} className="h-9 w-24 rounded-md border border-border bg-card px-3 text-sm" />
                  <Button type="button" variant="outline" onClick={() => saveCap(o)}>Set capacity</Button>
                  <StatusControl table="course_offering" id={o.course_offering_id} current={o.status} options={['PLANNED', 'OPEN', 'ACTIVE', 'COMPLETED', 'CANCELLED']} compact />
                  <DeleteButton table="course_offering" id={o.course_offering_id} label="course offering" />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
type Candidate = { enrolment_id: number; student_number: string; display_name: string };

export function RegisterStudentForm({ offeringId, sections, batches }: { offeringId: number; sections: SectionRow[]; batches: BatchRow[] }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<RegisterStudentInput, unknown, RegisterStudentValues>({ resolver: zodResolver(registerStudentSchema), defaultValues: { registration_date: today } });
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const sectionId = Number(watch('class_section_id')) || undefined;
  const e = errors as Record<string, { message?: string } | undefined>;

  useEffect(() => {
    const handle = setTimeout(async () => {
      const { data } = await createClient().rpc('registration_candidates', { p_offering_id: offeringId, p_q: q.trim() || null });
      setCandidates((data ?? []) as Candidate[]);
    }, 250);
    return () => clearTimeout(handle);
  }, [q, offeringId]);

  async function onSubmit(v: RegisterStudentValues) {
    const { error } = await createClient().from('student_term_registration').insert({
      enrolment_id: v.enrolment_id, programme_term_offering_id: offeringId, class_section_id: num(v.class_section_id), class_batch_id: num(v.class_batch_id),
      roll_number: v.roll_number ?? null, registration_date: v.registration_date, registration_status: 'REGISTERED',
    });
    if (error) return void toast.error(dbMessage(error, 'Could not register the student.'));
    toast.success('Student registered for the term.');
    reset({ registration_date: today });
    setQ('');
    router.refresh();
  }

  const options: Opt[] = candidates.map((c) => ({ id: c.enrolment_id, label: `${c.student_number} — ${c.display_name}` }));
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <TextField id="cand_q" label="Find a student" hint="Type a name or number; only active, not-yet-registered students of this programme are listed." value={q} onChange={(ev) => setQ(ev.target.value)} />
      <SelectField id="enrolment_id" label="Student *" options={options} emptyHint="No eligible students found." {...register('enrolment_id')} error={e.enrolment_id?.message} />
      <SelectField id="class_section_id" label="Section" options={sections.map((s) => ({ id: s.class_section_id, label: `${s.section_code}${s.capacity ? ` (cap ${s.capacity})` : ''}` }))} emptyHint="No sections defined." {...register('class_section_id')} error={e.class_section_id?.message} />
      <SelectField id="class_batch_id" label="Batch" options={batches.filter((b) => b.class_section_id === sectionId).map((b) => ({ id: b.class_batch_id, label: b.batch_code }))} emptyHint="Select a section with batches." {...register('class_batch_id')} error={e.class_batch_id?.message} />
      <TextField id="roll_number" label="Roll number" maxLength={30} {...register('roll_number')} error={e.roll_number?.message} />
      <TextField id="registration_date" type="date" label="Registration date *" {...register('registration_date')} error={e.registration_date?.message} />
      <div className="sm:col-span-2"><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Registering…' : 'Register student'}</Button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function CourseRegManager({ termRegId, regs, available, canManage }: { termRegId: number; regs: CourseRegRow[]; available: Opt[]; canManage: boolean }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CourseRegInput, unknown, CourseRegValues>({ resolver: zodResolver(courseRegSchema), defaultValues: { registration_type: 'REGULAR', registration_date: today } });
  const taken = new Set(regs.map((r) => r.course_offering_id));
  const e = errors as Record<string, { message?: string } | undefined>;

  async function onSubmit(v: CourseRegValues) {
    const { error } = await createClient().from('student_course_registration').insert({ term_registration_id: termRegId, course_offering_id: v.course_offering_id, registration_type: v.registration_type, registration_date: v.registration_date, registration_status: 'REGISTERED' });
    if (error) return void toast.error(dbMessage(error, 'Could not register the course.'));
    toast.success('Course registered.');
    reset({ registration_type: 'REGULAR', registration_date: today });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {regs.length === 0 ? <p className="text-sm text-muted-foreground">No courses registered yet.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {regs.map((r) => (
            <li key={r.course_registration_id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-2">
              <span><span className="font-medium">{r.offering_code ?? `#${r.course_offering_id}`}</span> {r.title}<br /><span className="text-muted-foreground">{r.registration_type} · {r.registration_date} · {r.registration_status}</span></span>
              {canManage && (
                <span className="flex flex-wrap items-start gap-2">
                  <StatusControl table="student_course_registration" id={r.course_registration_id} current={r.registration_status} options={COURSE_REG_NEXT[r.registration_status] ?? []} compact />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-start gap-3" noValidate>
          <SelectField id="course_offering_id" label="Add course *" className="w-80" options={available.filter((o) => !taken.has(o.id))} emptyHint="No other course offerings in this term." {...register('course_offering_id')} error={e.course_offering_id?.message} />
          <div>
            <Label htmlFor="registration_type">Type</Label>
            <select id="registration_type" className="flex h-9 w-40 rounded-md border border-border bg-card px-3 text-sm" {...register('registration_type')}>{REGISTRATION_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}</select>
          </div>
          <TextField id="creg_date" type="date" label="Date *" className="w-40" {...register('registration_date')} error={e.registration_date?.message} />
          <div className="pt-6"><Button type="submit" disabled={isSubmitting}>Register course</Button></div>
        </form>
      )}
    </div>
  );
}
