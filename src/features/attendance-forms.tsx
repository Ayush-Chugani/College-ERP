'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { DeleteButton } from '@/features/academic-forms';
import type { AssignmentRow, CorrectionRow, Opt, SessionRow, SheetRow, StatusRow, TeachingSectionRow } from '@/features/attendance-data';
import { StatusControl } from '@/features/registration-forms';
import type { BatchRow, CourseOfferingRow, SectionRow } from '@/features/registration-data';
import {
  assignmentSchema, ASSIGNMENT_ROLES, buildMarks, correctionSchema, sessionSchema, SESSION_STATUSES, SESSION_TYPES, statusSchema, teachingSectionSchema,
  type AssignmentInput, type AssignmentValues, type CorrectionInput, type CorrectionValues, type SessionInput, type SessionValues, type StatusInput, type StatusValues,
  type TeachingSectionInput, type TeachingSectionValues,
} from '@/lib/attendance-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
/** Business-rule messages raised by the database are safe to show; RLS failures are generic. */
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023') return e.message;
  if (e.code === '42501') return /Not authorised/.test(e.message) ? e.message : 'You are not allowed to do that for this programme.';
  if (e.code === '23505') return 'That already exists.';
  if (e.code === '23503') return 'It is referenced by other records, or a selected option does not exist.';
  if (e.code === '23514') return 'The values break a database rule (check the times and dates).';
  return fallback;
}
const num = (v: number | undefined) => (v === undefined ? null : v);
const hhmm = (t: string) => t.slice(0, 5);

function Check({ id, label, ...rest }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label htmlFor={id} className="flex items-center gap-2 text-sm"><input id={id} type="checkbox" {...rest} /> {label}</label>;
}

// ---------------------------------------------------------------------------
export function AttendanceStatusManager({ statuses, canManage }: { statuses: StatusRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const add = useForm<StatusInput, unknown, StatusValues>({ resolver: zodResolver(statusSchema), defaultValues: { counts_as_present: false, is_active: true } });
  const edit = useForm<StatusInput, unknown, StatusValues>({ resolver: zodResolver(statusSchema) });
  const fail = (e: DbError) => toast.error(e.code === '23505' ? 'That code or name already exists.' : dbMessage(e, 'Could not save the status.'));

  async function create(v: StatusValues) {
    const { error } = await createClient().from('attendance_status').insert(v);
    if (error) return void fail(error);
    toast.success('Status added.');
    add.reset({ status_code: '', status_name: '', counts_as_present: false, is_active: true });
    router.refresh();
  }
  async function save(id: number, v: StatusValues) {
    const { data, error } = await createClient().from('attendance_status').update(v).eq('attendance_status_id', id).select('attendance_status_id');
    if (error) return void fail(error);
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success('Status updated.');
    setEditing(null);
    router.refresh();
  }
  const fields = (f: typeof add, p: string) => (
    <>
      <TextField id={`${p}c`} label="Code *" className="w-28" maxLength={20} {...f.register('status_code')} error={f.formState.errors.status_code?.message} />
      <TextField id={`${p}n`} label="Name *" className="w-48" maxLength={50} {...f.register('status_name')} error={f.formState.errors.status_name?.message} />
      <div className="flex flex-col gap-1 pt-6"><Check id={`${p}p`} label="Counts as present" {...f.register('counts_as_present')} /><Check id={`${p}a`} label="Active" {...f.register('is_active')} /></div>
    </>
  );
  return (
    <div className="space-y-4">
      {statuses.length === 0 ? <p className="text-sm text-muted-foreground">No attendance statuses are defined yet. Until a global administrator defines them (for example Present, Absent, Late), attendance cannot be marked.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {statuses.map((s) => (
            <li key={s.attendance_status_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              {editing === s.attendance_status_id ? (
                <form onSubmit={edit.handleSubmit((v) => save(s.attendance_status_id, v))} className="flex flex-wrap items-start gap-3" noValidate>
                  {fields(edit, `e${s.attendance_status_id}`)}
                  <div className="flex gap-2 pt-6"><Button type="submit">Save</Button><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div>
                </form>
              ) : (
                <>
                  <span><span className="font-medium">{s.status_name}</span> <span className="text-muted-foreground">({s.status_code}) · {s.counts_as_present ? 'counts as present' : 'not present'}{s.is_active ? '' : ' · inactive'}</span></span>
                  {canManage && (
                    <span className="flex items-start gap-2">
                      <Button type="button" variant="outline" onClick={() => { edit.reset({ status_code: s.status_code, status_name: s.status_name, counts_as_present: s.counts_as_present, is_active: s.is_active }); setEditing(s.attendance_status_id); }}>Edit</Button>
                      <DeleteButton table="attendance_status" id={s.attendance_status_id} label="status" />
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={add.handleSubmit(create)} className="flex flex-wrap items-start gap-3" noValidate>
          {fields(add, 'new')}
          <div className="pt-6"><Button type="submit" disabled={add.formState.isSubmitting}>Add status</Button></div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function TeachingSectionManager({ offeringId, courseOfferings, sections, batches, teaching, canManage }: {
  offeringId: number; courseOfferings: CourseOfferingRow[]; sections: SectionRow[]; batches: BatchRow[]; teaching: TeachingSectionRow[]; canManage: boolean;
}) {
  const router = useRouter();
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<TeachingSectionInput, unknown, TeachingSectionValues>({ resolver: zodResolver(teachingSectionSchema) });
  const sectionId = Number(watch('class_section_id')) || undefined;
  const e = errors as Record<string, { message?: string } | undefined>;

  async function onSubmit(v: TeachingSectionValues) {
    const { error } = await createClient().from('course_offering_section').insert({
      course_offering_id: v.course_offering_id, programme_term_offering_id: offeringId, class_section_id: v.class_section_id, class_batch_id: num(v.class_batch_id), session_type: v.session_type,
    });
    if (error) return void toast.error(error.code === '23505' ? 'That course, section, batch and session type already exist.' : dbMessage(error, 'Could not add the teaching section.'));
    toast.success('Teaching section added.');
    reset();
    router.refresh();
  }
  return (
    <div className="space-y-4">
      {teaching.length === 0 ? <p className="text-sm text-muted-foreground">No teaching sections yet. A teaching section is a course taught to a class section (or batch) as lecture, practical and so on; attendance is recorded per teaching section.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {teaching.map((t) => (
            <li key={t.course_offering_section_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <Link href={`/attendance/section/${t.course_offering_section_id}`} className="text-primary underline-offset-4 hover:underline">{t.course_label} · section {t.section_code}{t.batch_code ? ` / ${t.batch_code}` : ''} · {t.session_type}</Link>
              {canManage && <DeleteButton table="course_offering_section" id={t.course_offering_section_id} label="teaching section" />}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-start gap-3" noValidate>
          <SelectField id="ts_course" label="Course offering *" className="w-64" options={courseOfferings.map((o) => ({ id: o.course_offering_id, label: `${o.code ?? o.offering_code}` }))} emptyHint="No course offerings yet." {...register('course_offering_id')} error={e.course_offering_id?.message} />
          <SelectField id="ts_section" label="Class section *" className="w-40" options={sections.map((s) => ({ id: s.class_section_id, label: s.section_code }))} emptyHint="No sections yet." {...register('class_section_id')} error={e.class_section_id?.message} />
          <SelectField id="ts_batch" label="Batch" className="w-40" options={batches.filter((b) => b.class_section_id === sectionId).map((b) => ({ id: b.class_batch_id, label: b.batch_code }))} emptyHint="No batches for this section." {...register('class_batch_id')} error={e.class_batch_id?.message} />
          <div>
            <Label htmlFor="ts_type">Session type *</Label>
            <select id="ts_type" className="flex h-9 w-40 rounded-md border border-border bg-card px-3 text-sm" {...register('session_type')}>
              <option value="">— select —</option>{SESSION_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
            {e.session_type && <p role="alert" className="mt-1 text-sm text-destructive">{e.session_type.message}</p>}
          </div>
          <div className="pt-6"><Button type="submit" disabled={isSubmitting}>Add teaching section</Button></div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AssignmentManager({ cosId, assignments, employees, canManage }: { cosId: number; assignments: AssignmentRow[]; employees: Opt[]; canManage: boolean }) {
  const router = useRouter();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<AssignmentInput, unknown, AssignmentValues>({ resolver: zodResolver(assignmentSchema) });
  const e = errors as Record<string, { message?: string } | undefined>;

  async function onSubmit(v: AssignmentValues) {
    const { error } = await createClient().from('faculty_course_assignment').insert({
      course_offering_section_id: cosId, employee_id: v.employee_id, assignment_role: v.assignment_role, start_date: v.start_date, end_date: v.end_date ?? null, workload_hours: num(v.workload_hours),
    });
    if (error) return void toast.error(error.code === '23505' ? 'That employee already has this role in this teaching section.' : dbMessage(error, 'Could not add the instructor.'));
    toast.success('Instructor assigned.');
    reset();
    router.refresh();
  }
  return (
    <div className="space-y-4">
      {assignments.length === 0 ? <p className="text-sm text-muted-foreground">No instructors assigned.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {assignments.map((a) => (
            <li key={a.faculty_assignment_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span><span className="font-medium">{a.employee_label ?? `Employee #${a.employee_id}`}</span> <span className="text-muted-foreground">· {a.assignment_role} · {a.start_date} → {a.end_date ?? 'open'} · {a.assignment_status}</span></span>
              {canManage && <DeleteButton table="faculty_course_assignment" id={a.faculty_assignment_id} label="assignment" />}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-start gap-3" noValidate>
          <SelectField id="as_emp" label="Employee *" className="w-72" options={employees} emptyHint="No active employees are visible to you." {...register('employee_id')} error={e.employee_id?.message} />
          <div>
            <Label htmlFor="as_role">Role *</Label>
            <select id="as_role" className="flex h-9 w-48 rounded-md border border-border bg-card px-3 text-sm" {...register('assignment_role')}>
              <option value="">— select —</option>{ASSIGNMENT_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
            </select>
            {e.assignment_role && <p role="alert" className="mt-1 text-sm text-destructive">{e.assignment_role.message}</p>}
          </div>
          <TextField id="as_start" type="date" label="Start *" className="w-40" {...register('start_date')} error={e.start_date?.message} />
          <TextField id="as_end" type="date" label="End" className="w-40" {...register('end_date')} error={e.end_date?.message} />
          <TextField id="as_hours" label="Workload hours" className="w-32" inputMode="decimal" {...register('workload_hours')} error={e.workload_hours?.message} />
          <div className="pt-6"><Button type="submit" disabled={isSubmitting}>Assign</Button></div>
        </form>
      )}
    </div>
  );
}

export function RosterButton({ cosId, count }: { cosId: number; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const { data, error } = await createClient().rpc('teaching_populate_roster', { p_cos_id: cosId });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'Could not build the roster.'));
    toast.success(Number(data) === 0 ? 'The roster is already up to date.' : `${data} student(s) added to the roster.`);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm">{count} student{count === 1 ? '' : 's'} on the roster</span>
      <Button type="button" variant="outline" disabled={busy} onClick={run}>{busy ? 'Updating…' : 'Add registered students to the roster'}</Button>
      <span className="text-xs text-muted-foreground">Adds students registered for this course whose term registration is in the same section (and batch).</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function SessionManager({ cosId, sessions, assignments, defaultType, canManage }: { cosId: number; sessions: SessionRow[]; assignments: AssignmentRow[]; defaultType: string; canManage: boolean }) {
  const router = useRouter();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<SessionInput, unknown, SessionValues>({ resolver: zodResolver(sessionSchema), defaultValues: { session_type: (SESSION_TYPES as readonly string[]).includes(defaultType) ? (defaultType as SessionInput['session_type']) : undefined } });
  const e = errors as Record<string, { message?: string } | undefined>;

  async function onSubmit(v: SessionValues) {
    const { error } = await createClient().from('class_session').insert({
      course_offering_section_id: cosId, faculty_assignment_id: num(v.faculty_assignment_id), session_date: v.session_date, start_time: v.start_time, end_time: v.end_time, session_type: v.session_type, planned_topic: v.planned_topic ?? null,
    });
    if (error) return void toast.error(error.code === '23505' ? 'A session already starts at that date and time for this teaching section.' : dbMessage(error, 'Could not create the session.'));
    toast.success('Session created.');
    reset();
    router.refresh();
  }
  return (
    <div className="space-y-4">
      {sessions.length === 0 ? <p className="text-sm text-muted-foreground">No sessions yet.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {sessions.map((s) => (
            <li key={s.class_session_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span>
                <Link href={`/attendance/session/${s.class_session_id}`} className="font-medium text-primary underline-offset-4 hover:underline">{s.session_date} {hhmm(s.start_time)}–{hhmm(s.end_time)}</Link>{' '}
                <span className="text-muted-foreground">· {s.session_type} · {s.session_status}{s.planned_topic ? ` · ${s.planned_topic}` : ''}</span>
              </span>
              {canManage && <DeleteButton table="class_session" id={s.class_session_id} label="session" />}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-start gap-3" noValidate>
          <TextField id="se_date" type="date" label="Date *" className="w-40" {...register('session_date')} error={e.session_date?.message} />
          <TextField id="se_start" type="time" label="Start *" className="w-32" {...register('start_time')} error={e.start_time?.message} />
          <TextField id="se_end" type="time" label="End *" className="w-32" {...register('end_time')} error={e.end_time?.message} />
          <div>
            <Label htmlFor="se_type">Type *</Label>
            <select id="se_type" className="flex h-9 w-36 rounded-md border border-border bg-card px-3 text-sm" {...register('session_type')}>
              <option value="">— select —</option>{SESSION_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
            {e.session_type && <p role="alert" className="mt-1 text-sm text-destructive">{e.session_type.message}</p>}
          </div>
          <SelectField id="se_inst" label="Instructor" className="w-56" options={assignments.map((a) => ({ id: a.faculty_assignment_id, label: `${a.employee_label ?? a.employee_id} (${a.assignment_role})` }))} emptyHint="No instructors assigned." {...register('faculty_assignment_id')} error={e.faculty_assignment_id?.message} />
          <TextField id="se_topic" label="Planned topic" className="w-64" maxLength={2000} {...register('planned_topic')} error={e.planned_topic?.message} />
          <div className="pt-6"><Button type="submit" disabled={isSubmitting}>Create session</Button></div>
        </form>
      )}
    </div>
  );
}

export function SessionStatus({ sessionId, current }: { sessionId: number; current: string }) {
  return <StatusControl table="class_session" id={sessionId} current={current} options={SESSION_STATUSES} label="Session status" />;
}

// ---------------------------------------------------------------------------
type Row = { roster_id: number; status_id: string; remarks: string };

export function MarkingSheet({ sessionId, rows, statuses, canMark, closed }: { sessionId: number; rows: SheetRow[]; statuses: StatusRow[]; canMark: boolean; closed: boolean }) {
  const router = useRouter();
  const active = statuses.filter((s) => s.is_active);
  const [state, setState] = useState<Row[]>(rows.map((r) => ({ roster_id: r.roster_id, status_id: r.attendance_status_id ? String(r.attendance_status_id) : '', remarks: r.remarks ?? '' })));
  const [busy, setBusy] = useState(false);
  const present = active.find((s) => s.counts_as_present);
  const set = (i: number, patch: Partial<Row>) => setState(state.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function save() {
    const marks = buildMarks(state);
    if (marks.length === 0) return void toast.error('Choose a status for at least one student.');
    setBusy(true);
    const { data, error } = await createClient().rpc('attendance_mark', { p_session_id: sessionId, p_marks: marks });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'Could not save the attendance.'));
    toast.success(`Attendance saved for ${data} student(s).`);
    router.refresh();
  }

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">The roster for this teaching section is empty. Add registered students to the roster first.</p>;
  if (active.length === 0) return <p className="text-sm text-muted-foreground">No attendance statuses are defined, so attendance cannot be marked yet. A global administrator defines them under Attendance statuses.</p>;
  return (
    <div className="space-y-3">
      {canMark && !closed && present && (
        <Button type="button" variant="outline" onClick={() => setState(state.map((r) => (r.status_id === '' ? { ...r, status_id: String(present.attendance_status_id) } : r)))}>
          Mark everyone unmarked as “{present.status_name}”
        </Button>
      )}
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr><th scope="col" className="px-4 py-2 font-medium">Student</th><th scope="col" className="px-4 py-2 font-medium">Status</th><th scope="col" className="px-4 py-2 font-medium">Remarks</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.roster_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">{r.student_number} — {r.display_name}</td>
                <td className="px-4 py-2">
                  <select aria-label={`Status for ${r.display_name}`} disabled={!canMark || closed} value={state[i]?.status_id ?? ''} onChange={(ev) => set(i, { status_id: ev.target.value })} className="h-9 rounded-md border border-border bg-card px-3 text-sm disabled:opacity-60">
                    <option value="">— not marked —</option>
                    {statuses.filter((s) => s.is_active || String(s.attendance_status_id) === state[i]?.status_id).map((s) => (<option key={s.attendance_status_id} value={s.attendance_status_id}>{s.status_name}</option>))}
                  </select>
                </td>
                <td className="px-4 py-2"><input aria-label={`Remarks for ${r.display_name}`} disabled={!canMark || closed} maxLength={500} value={state[i]?.remarks ?? ''} onChange={(ev) => set(i, { remarks: ev.target.value })} className="h-9 w-full min-w-40 rounded-md border border-border bg-card px-3 text-sm disabled:opacity-60" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {closed && <p className="text-sm text-muted-foreground">Attendance cannot be marked for a cancelled or rescheduled session.</p>}
      {canMark && !closed && <Button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save attendance'}</Button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function CorrectionPanel({ sessionId, rows, statuses, corrections, canRequest, canDecide }: { sessionId: number; rows: SheetRow[]; statuses: StatusRow[]; corrections: CorrectionRow[]; canRequest: boolean; canDecide: boolean }) {
  const router = useRouter();
  const [rosterId, setRosterId] = useState('');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CorrectionInput, unknown, CorrectionValues>({ resolver: zodResolver(correctionSchema) });
  const marked = rows.filter((r) => r.attendance_status_id !== null);
  const sName = new Map(statuses.map((s) => [s.attendance_status_id, s.status_name]));
  const who = new Map(rows.map((r) => [r.roster_id, `${r.student_number} — ${r.display_name}`]));

  async function request(v: CorrectionValues) {
    if (!rosterId) return void toast.error('Select a student.');
    const { error } = await createClient().rpc('attendance_request_correction', { p_session_id: sessionId, p_roster_id: Number(rosterId), p_requested_status_id: v.requested_status_id, p_reason: v.reason });
    if (error) return void toast.error(dbMessage(error, 'Could not request the correction.'));
    toast.success('Correction requested.');
    reset();
    setRosterId('');
    router.refresh();
  }
  async function decide(id: number, approve: boolean) {
    const { error } = await createClient().rpc('attendance_decide_correction', { p_correction_id: id, p_approve: approve });
    if (error) return void toast.error(dbMessage(error, 'Could not record the decision.'));
    toast.success(approve ? 'Correction approved and applied.' : 'Correction rejected.');
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {corrections.length === 0 ? <p className="text-sm text-muted-foreground">No correction requests for this session.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {corrections.map((c) => (
            <li key={c.attendance_correction_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span>
                <span className="font-medium">{who.get(c.course_offering_section_student_id) ?? `Roster #${c.course_offering_section_student_id}`}</span>: {sName.get(c.old_status_id) ?? c.old_status_id} → {sName.get(c.requested_status_id) ?? c.requested_status_id}
                <br /><span className="text-muted-foreground">{c.reason} · {c.request_status}</span>
              </span>
              {canDecide && c.request_status === 'PENDING' && (
                <span className="flex gap-2"><Button type="button" onClick={() => decide(c.attendance_correction_id, true)}>Approve</Button><Button type="button" variant="outline" onClick={() => decide(c.attendance_correction_id, false)}>Reject</Button></span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canRequest && marked.length > 0 && (
        <form onSubmit={handleSubmit(request)} className="flex flex-wrap items-start gap-3" noValidate>
          <div>
            <Label htmlFor="corr_student">Student *</Label>
            <select id="corr_student" value={rosterId} onChange={(ev) => setRosterId(ev.target.value)} className="flex h-9 w-64 rounded-md border border-border bg-card px-3 text-sm">
              <option value="">— select —</option>{marked.map((r) => (<option key={r.roster_id} value={r.roster_id}>{r.student_number} — {r.display_name}</option>))}
            </select>
          </div>
          <SelectField id="corr_status" label="Correct status *" className="w-48" options={statuses.filter((s) => s.is_active).map((s) => ({ id: s.attendance_status_id, label: s.status_name }))} emptyHint="No statuses." {...register('requested_status_id')} error={errors.requested_status_id?.message} />
          <TextField id="corr_reason" label="Reason *" className="w-72" maxLength={1000} {...register('reason')} error={errors.reason?.message} />
          <div className="pt-6"><Button type="submit" disabled={isSubmitting}>Request correction</Button></div>
        </form>
      )}
    </div>
  );
}
