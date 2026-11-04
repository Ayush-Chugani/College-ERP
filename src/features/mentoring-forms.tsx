'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { toLocalInput, type SessionRow } from '@/features/mentoring-data';
import {
  assignSchema, levelHelp, levelLabel, LEVELS, NOTES_MAX, sessionSchema, SESSION_STATUSES,
  type AssignInput, type AssignValues, type SessionInput, type SessionValues,
} from '@/lib/mentoring-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023') return e.message;
  if (e.code === '42501') return /Not authorised/.test(e.message) ? e.message : 'You are not allowed to do that.';
  return fallback;
}
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const nul = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);

export function AssignForm() {
  const router = useRouter();
  const form = useForm<AssignInput, unknown, AssignValues>({ resolver: zodResolver(assignSchema) });
  async function submit(v: AssignValues) {
    const { data, error } = await createClient().rpc('mentoring_assign', { p_student_number: v.student_number, p_employee_number: v.employee_number, p_start: v.start_date ?? null });
    if (error) return void toast.error(dbMessage(error, 'Could not assign the mentor.'));
    toast.success('Mentor assigned.');
    router.push(`/mentoring/${data as number}`);
  }
  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Assign a mentor">
      <TextField id="ms" label="Student number *" className="w-44" maxLength={40} {...form.register('student_number')} error={e.student_number?.message} />
      <TextField id="me" label="Mentor's employee number *" className="w-52" maxLength={30} {...form.register('employee_number')} error={e.employee_number?.message} />
      <TextField id="md" label="Start date" type="date" className="w-40" {...form.register('start_date')} error={e.start_date?.message} />
      <div className="pt-6"><Button type="submit" disabled={form.formState.isSubmitting}>Assign mentor</Button></div>
    </form>
  );
}

export function EndAssignment({ assignmentId }: { assignmentId: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<'COMPLETED' | 'CANCELLED'>('COMPLETED');
  const [date, setDate] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function apply() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setConfirming(false); return void toast.error('Choose an end date.'); }
    setBusy(true);
    const { error } = await createClient().rpc('mentoring_end_assignment', { p_assignment_id: assignmentId, p_status: status, p_end_date: date });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'Could not end the assignment.'));
    toast.success('Assignment ended.');
    setConfirming(false);
    router.refresh();
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div><label htmlFor="es" className="text-sm font-medium">End as</label><select id="es" className="h-9 rounded-md border border-border bg-card px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value as 'COMPLETED' | 'CANCELLED')}><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></div>
        <div><label htmlFor="ed" className="text-sm font-medium">End date</label><input id="ed" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-md border border-border bg-card px-2 text-sm" /></div>
        <Button type="button" variant="outline" disabled={!date || confirming} onClick={() => setConfirming(true)}>End assignment…</Button>
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="Confirm ending the assignment" className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="mb-2">End this mentoring assignment as <strong>{status.toLowerCase()}</strong> on {date}? No further sessions can be recorded afterwards.</p>
          <div className="flex gap-2"><Button type="button" variant="destructive" disabled={busy} onClick={apply}>{busy ? 'Saving…' : 'Confirm'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button></div>
        </div>
      )}
    </div>
  );
}

function SessionFields({ form, idp }: { form: ReturnType<typeof useForm<SessionInput, unknown, SessionValues>>; idp: string }) {
  const e = form.formState.errors;
  const level = form.watch('confidentiality_level');
  return (
    <>
      <TextField id={`${idp}d`} label="Date and time *" type="datetime-local" className="w-56" {...form.register('session_date')} error={e.session_date?.message} />
      <div className="w-52"><label htmlFor={`${idp}s`} className="text-sm font-medium">Status *</label><select id={`${idp}s`} className={sel} {...form.register('session_status')}>{SESSION_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}</select></div>
      <TextField id={`${idp}f`} label="Follow-up date" type="date" className="w-44" {...form.register('follow_up_date')} error={e.follow_up_date?.message} />
      <div className="w-60">
        <label htmlFor={`${idp}l`} className="text-sm font-medium">Who can read the notes *</label>
        <select id={`${idp}l`} className={sel} {...form.register('confidentiality_level')}>{LEVELS.map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}</select>
        <p className="mt-1 text-xs text-muted-foreground">{levelHelp[level ?? 'RESTRICTED']}</p>
      </div>
      <div className="w-full max-w-2xl">
        <label htmlFor={`${idp}o`} className="text-sm font-medium">Observations</label>
        <textarea id={`${idp}o`} rows={4} maxLength={NOTES_MAX} className="w-full rounded-md border border-border bg-card p-2 text-sm" {...form.register('observations')} />
        {e.observations?.message && <p role="alert" className="text-sm text-destructive">{e.observations.message}</p>}
      </div>
      <div className="w-full max-w-2xl">
        <label htmlFor={`${idp}a`} className="text-sm font-medium">Action plan</label>
        <textarea id={`${idp}a`} rows={3} maxLength={NOTES_MAX} className="w-full rounded-md border border-border bg-card p-2 text-sm" {...form.register('action_plan')} />
        {e.action_plan?.message && <p role="alert" className="text-sm text-destructive">{e.action_plan.message}</p>}
      </div>
    </>
  );
}

export function SessionForm({ assignmentId }: { assignmentId: number }) {
  const router = useRouter();
  const form = useForm<SessionInput, unknown, SessionValues>({ resolver: zodResolver(sessionSchema), defaultValues: { session_status: 'COMPLETED', confidentiality_level: 'RESTRICTED' } });
  async function submit(v: SessionValues) {
    const { error } = await createClient().rpc('mentoring_record_session', {
      p_assignment_id: assignmentId, p_date: new Date(v.session_date).toISOString(), p_observations: nul(v.observations), p_action_plan: nul(v.action_plan), p_follow_up: nul(v.follow_up_date),
      p_status: v.session_status, p_level: v.confidentiality_level,
    });
    if (error) return void toast.error(dbMessage(error, 'Could not record the session.'));
    toast.success('Session recorded.');
    form.reset({ session_status: 'COMPLETED', confidentiality_level: 'RESTRICTED', session_date: '', observations: '', action_plan: '', follow_up_date: '' });
    router.refresh();
  }
  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Record a session">
      <SessionFields form={form} idp="ns" />
      <div className="w-full"><Button type="submit" disabled={form.formState.isSubmitting}>Record session</Button></div>
    </form>
  );
}

export function SessionList({ sessions, canEdit }: { sessions: SessionRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<number | null>(null);
  if (sessions.length === 0) return <p className="text-sm text-muted-foreground">No sessions recorded yet.</p>;
  return (
    <ul className="space-y-3">
      {sessions.map((s) => (
        <li key={s.counselling_session_id} className="rounded-md border border-border bg-card p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{new Date(s.session_date).toLocaleString()} · {s.session_status.replace(/_/g, ' ').toLowerCase()} <span className="font-normal text-muted-foreground">· {levelLabel(s.confidentiality_level)}</span></span>
            {canEdit && !s.redacted && editing !== s.counselling_session_id && <Button type="button" variant="outline" onClick={() => setEditing(s.counselling_session_id)}>Edit</Button>}
          </div>
          {editing === s.counselling_session_id ? <EditSession session={s} onDone={() => setEditing(null)} /> : s.redacted ? (
            <p className="mt-1 text-muted-foreground">The notes of this session are confidential and not shown to you.{s.follow_up_date ? ` Follow-up: ${s.follow_up_date}.` : ''}</p>
          ) : (
            <div className="mt-2 space-y-1">
              {s.observations && <p><span className="font-medium">Observations:</span> <span className="whitespace-pre-wrap">{s.observations}</span></p>}
              {s.action_plan && <p><span className="font-medium">Action plan:</span> <span className="whitespace-pre-wrap">{s.action_plan}</span></p>}
              {s.follow_up_date && <p><span className="font-medium">Follow-up:</span> {s.follow_up_date}</p>}
              {!s.observations && !s.action_plan && !s.follow_up_date && <p className="text-muted-foreground">No notes.</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function EditSession({ session, onDone }: { session: SessionRow; onDone: () => void }) {
  const router = useRouter();
  const form = useForm<SessionInput, unknown, SessionValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      session_date: toLocalInput(session.session_date), observations: session.observations ?? '', action_plan: session.action_plan ?? '', follow_up_date: session.follow_up_date ?? '',
      session_status: session.session_status as SessionInput['session_status'], confidentiality_level: session.confidentiality_level as SessionInput['confidentiality_level'],
    },
  });
  async function submit(v: SessionValues) {
    const { error } = await createClient().rpc('mentoring_update_session', {
      p_session_id: session.counselling_session_id, p_date: new Date(v.session_date).toISOString(), p_observations: nul(v.observations), p_action_plan: nul(v.action_plan), p_follow_up: nul(v.follow_up_date),
      p_status: v.session_status, p_level: v.confidentiality_level,
    });
    if (error) return void toast.error(dbMessage(error, 'Could not save the session.'));
    toast.success('Session updated.');
    onDone();
    router.refresh();
  }
  return (
    <form onSubmit={form.handleSubmit(submit)} className="mt-3 flex flex-wrap items-start gap-3" noValidate aria-label="Edit session">
      <SessionFields form={form} idp={`es${session.counselling_session_id}`} />
      <div className="flex w-full gap-2"><Button type="submit" disabled={form.formState.isSubmitting}>Save</Button><Button type="button" variant="outline" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}
