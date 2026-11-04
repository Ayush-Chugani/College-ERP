'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { ActivityDetail, Evidence, Opt, TeamMember } from '@/features/activity-data';
import {
  ACHIEVEMENTS, activityPayload, activitySchema, APPROVE_DECISIONS, evidenceSchema, label, reviewSchema, teamSchema, VERIFY_DECISIONS,
  type ActivityInput, type ActivityValues, type EvidenceInput, type EvidenceValues, type ReviewInput, type ReviewValues, type TeamInput, type TeamValues,
} from '@/lib/activity-validation';
import { BUCKET, checkFile, storageKey } from '@/lib/document-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023' || e.code === '23505') return e.message;
  if (e.code === '42501') return /Not authorised/.test(e.message) ? e.message : 'You are not allowed to do that.';
  return fallback;
}
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const area = 'w-full rounded-md border border-border bg-card p-2 text-sm';
async function sha256Hex(file: File): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export type Lookups = { types: Opt[]; years: Opt[]; levels: Opt[]; modes: Opt[] };

export function ActivityForm({ lookups, initial }: { lookups: Lookups; initial?: ActivityDetail }) {
  const router = useRouter();
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const form = useForm<ActivityInput, unknown, ActivityValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: initial
      ? {
          student_activity_type_id: s(initial.student_activity_type_id), activity_title: initial.activity_title, event_name: s(initial.event_name), organizer_name: s(initial.organizer_name), team_name: s(initial.team_name),
          participation_role: s(initial.participation_role), start_date: s(initial.start_date), end_date: s(initial.end_date), venue_name: s(initial.venue_name), city: s(initial.city),
          achievement_type: initial.achievement_type as (typeof ACHIEVEMENTS)[number], position_rank: s(initial.position_rank), award_name: s(initial.award_name), activity_url: s(initial.activity_url),
          description: s(initial.description), outcomes: s(initial.outcomes), academic_year_id: s(initial.academic_year_id), participation_level_id: s(initial.participation_level_id), event_mode_id: s(initial.event_mode_id),
        }
      : { achievement_type: 'PARTICIPATION' },
  });
  const e = form.formState.errors;
  async function submit(v: ActivityValues) {
    const { data, error } = await createClient().rpc('student_activity_save', { p_activity_id: initial?.student_activity_id ?? null, p_student_id: null, p: activityPayload(v) });
    if (error) return void toast.error(dbMessage(error, 'The activity could not be saved.'));
    toast.success('Saved.');
    if (initial) router.refresh();
    else router.push(`/activities/${data as number}`);
  }
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-3" noValidate aria-label="Activity">
      <div className="flex flex-wrap items-start gap-3">
        <SelectField id="ac-type" label="Type *" className="w-64" options={lookups.types} {...form.register('student_activity_type_id')} error={e.student_activity_type_id?.message} />
        <SelectField id="ac-year" label="Academic year" className="w-40" options={lookups.years} {...form.register('academic_year_id')} error={e.academic_year_id?.message} />
        <SelectField id="ac-level" label="Level" className="w-44" options={lookups.levels} {...form.register('participation_level_id')} error={e.participation_level_id?.message} />
        <SelectField id="ac-mode" label="Mode" className="w-40" options={lookups.modes} {...form.register('event_mode_id')} error={e.event_mode_id?.message} />
      </div>
      <TextField id="ac-title" label="Title *" className="max-w-2xl" maxLength={500} {...form.register('activity_title')} error={e.activity_title?.message} />
      <div className="flex flex-wrap items-start gap-3">
        <TextField id="ac-event" label="Event name" className="w-72" maxLength={500} {...form.register('event_name')} error={e.event_name?.message} />
        <TextField id="ac-org" label="Organiser" className="w-64" maxLength={300} {...form.register('organizer_name')} error={e.organizer_name?.message} />
        <TextField id="ac-team" label="Team name" className="w-52" maxLength={250} {...form.register('team_name')} error={e.team_name?.message} />
        <TextField id="ac-role" label="Your role" className="w-52" maxLength={150} {...form.register('participation_role')} error={e.participation_role?.message} />
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <TextField id="ac-start" type="date" label="Start date" className="w-44" {...form.register('start_date')} error={e.start_date?.message} />
        <TextField id="ac-end" type="date" label="End date" className="w-44" {...form.register('end_date')} error={e.end_date?.message} />
        <TextField id="ac-venue" label="Venue" className="w-64" maxLength={250} {...form.register('venue_name')} error={e.venue_name?.message} />
        <TextField id="ac-city" label="City" className="w-44" maxLength={120} {...form.register('city')} error={e.city?.message} />
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-52"><label htmlFor="ac-ach" className="text-sm font-medium">Achievement *</label><select id="ac-ach" className={sel} {...form.register('achievement_type')}>{ACHIEVEMENTS.map((a) => <option key={a} value={a}>{label(a)}</option>)}</select></div>
        <TextField id="ac-rank" label="Rank" className="w-24" inputMode="numeric" {...form.register('position_rank')} error={e.position_rank?.message} />
        <TextField id="ac-award" label="Award name" className="w-72" maxLength={500} {...form.register('award_name')} error={e.award_name?.message} />
        <TextField id="ac-url" label="Link" className="w-80" maxLength={1000} {...form.register('activity_url')} error={e.activity_url?.message} />
      </div>
      <div className="max-w-2xl"><label htmlFor="ac-desc" className="text-sm font-medium">Description</label><textarea id="ac-desc" rows={4} maxLength={5000} className={area} {...form.register('description')} />{e.description?.message && <p role="alert" className="text-sm text-destructive">{e.description.message}</p>}</div>
      <div className="max-w-2xl"><label htmlFor="ac-out" className="text-sm font-medium">Outcomes</label><textarea id="ac-out" rows={3} maxLength={5000} className={area} {...form.register('outcomes')} />{e.outcomes?.message && <p role="alert" className="text-sm text-destructive">{e.outcomes.message}</p>}</div>
      <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving…' : initial ? 'Save changes' : 'Create draft'}</Button>
    </form>
  );
}

export function WorkflowActions({ a }: { a: ActivityDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const step = a.can_verify ? 'VERIFY' : 'APPROVE';
  const form = useForm<ReviewInput, unknown, ReviewValues>({ resolver: zodResolver(reviewSchema), defaultValues: { step, decision: '', remarks: '' } });
  const e = form.formState.errors;
  const decisions = step === 'VERIFY' ? VERIFY_DECISIONS : APPROVE_DECISIONS;
  async function call<T>(fn: () => PromiseLike<{ data: T | null; error: DbError | null }>, ok: string, fallback: string, after?: () => void) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, fallback));
    toast.success(ok);
    after?.();
    router.refresh();
  }
  const supabase = createClient();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {a.can_edit && <Button type="button" disabled={busy} onClick={() => call(() => supabase.rpc('student_activity_submit', { p_activity_id: a.student_activity_id }), 'Submitted for verification.', 'It could not be submitted.')}>Submit for verification</Button>}
        {a.can_delete && (confirmDelete
          ? <><span className="text-sm">Delete this activity?</span><Button type="button" variant="outline" disabled={busy} onClick={() => call(() => supabase.rpc('student_activity_delete', { p_activity_id: a.student_activity_id, p_reason: null }), 'Deleted.', 'It could not be deleted.', () => router.push('/activities'))}>Yes, delete</Button><Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button></>
          : <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)}>Delete</Button>)}
      </div>
      {(a.can_verify || a.can_approve) && (
        <form onSubmit={form.handleSubmit((v) => call(() => supabase.rpc('student_activity_review', { p_activity_id: a.student_activity_id, p_step: v.step, p_decision: v.decision, p_remarks: v.remarks ?? null }), 'Decision recorded.', 'The decision could not be saved.', () => form.reset({ step, decision: '', remarks: '' })))}
          className="space-y-2 rounded-md border border-border bg-muted p-3" noValidate aria-label={step === 'VERIFY' ? 'Verify the activity' : 'Approve the activity'}>
          <input type="hidden" {...form.register('step')} />
          <div className="flex flex-wrap items-start gap-3">
            <div className="w-56"><label htmlFor="rv-d" className="text-sm font-medium">{step === 'VERIFY' ? 'Verification' : 'Approval'} decision</label>
              <select id="rv-d" className={sel} {...form.register('decision')}><option value="">— select —</option>{decisions.map((d) => <option key={d} value={d}>{label(d)}</option>)}</select>
              {e.decision?.message && <p role="alert" className="text-sm text-destructive">{e.decision.message}</p>}</div>
            <div className="w-96 max-w-full"><label htmlFor="rv-r" className="text-sm font-medium">Remarks</label><input id="rv-r" maxLength={1000} className={sel} {...form.register('remarks')} />{e.remarks?.message && <p role="alert" className="text-sm text-destructive">{e.remarks.message}</p>}</div>
          </div>
          <Button type="submit" disabled={busy}>Save decision</Button>
        </form>
      )}
    </div>
  );
}

export function TeamPanel({ a }: { a: ActivityDetail }) {
  const router = useRouter();
  const form = useForm<TeamInput, unknown, TeamValues>({ resolver: zodResolver(teamSchema), defaultValues: { kind: 'EXTERNAL' } });
  const kind = form.watch('kind');
  const e = form.formState.errors;
  async function add(v: TeamValues) {
    const supabase = createClient();
    let studentId: number | null = null;
    if (v.kind === 'STUDENT') {
      const { data } = await supabase.from('student').select('student_id').eq('student_number', v.student_number ?? '').maybeSingle();
      if (!data) return void form.setError('student_number', { message: 'No visible student has that number' });
      studentId = Number((data as { student_id: number }).student_id);
    }
    const { error } = await supabase.rpc('student_activity_team_add', { p_activity_id: a.student_activity_id, p_student_id: studentId, p_external_name: v.kind === 'EXTERNAL' ? v.external_name ?? null : null, p_external_email: v.external_email ?? null, p_role: v.role ?? null, p_is_lead: v.is_lead ?? false });
    if (error) return void toast.error(dbMessage(error, 'The member could not be added.'));
    toast.success('Member added.');
    form.reset({ kind: v.kind });
    router.refresh();
  }
  async function remove(m: TeamMember) {
    const { error } = await createClient().rpc('student_activity_team_remove', { p_member_id: m.member_id });
    if (error) return void toast.error(dbMessage(error, 'The member could not be removed.'));
    router.refresh();
  }
  return (
    <div className="space-y-3">
      {a.team.length === 0 ? <p className="text-sm text-muted-foreground">No team members.</p> : (
        <ul className="divide-y divide-border text-sm">
          {a.team.map((m) => (
            <li key={m.member_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{m.name}{m.is_lead ? ' (lead)' : ''}<span className="text-muted-foreground">{m.role ? ` · ${m.role}` : ''}{m.is_student ? '' : ' · external'}</span></span>
              {a.can_edit && <Button type="button" variant="outline" onClick={() => remove(m)} aria-label={`Remove ${m.name}`}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {a.can_edit && (
        <form onSubmit={form.handleSubmit(add)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Add a team member">
          <div className="w-40"><label htmlFor="tm-k" className="text-sm font-medium">Member is</label><select id="tm-k" className={sel} {...form.register('kind')}><option value="EXTERNAL">Not a student here</option><option value="STUDENT">A student here</option></select></div>
          {kind === 'STUDENT' ? <TextField id="tm-n" label="Student number *" className="w-44" {...form.register('student_number')} error={e.student_number?.message} /> : <TextField id="tm-e" label="Name *" className="w-52" maxLength={250} {...form.register('external_name')} error={e.external_name?.message} />}
          {kind === 'EXTERNAL' && <TextField id="tm-m" label="Email" className="w-52" maxLength={254} {...form.register('external_email')} error={e.external_email?.message} />}
          <TextField id="tm-r" label="Role" className="w-40" maxLength={150} {...form.register('role')} />
          <label className="mt-6 flex items-center gap-1 text-sm"><input type="checkbox" {...form.register('is_lead')} /> Team lead</label>
          <Button type="submit" className="mt-5" disabled={form.formState.isSubmitting}>Add</Button>
        </form>
      )}
    </div>
  );
}

export function EvidencePanel({ a, documentTypes, evidenceTypes }: { a: ActivityDetail; documentTypes: Opt[]; evidenceTypes: Opt[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const form = useForm<EvidenceInput, unknown, EvidenceValues>({ resolver: zodResolver(evidenceSchema), defaultValues: { title: '', issue_date: '', issuing_authority: '', certificate_number: '' } });
  const e = form.formState.errors;
  const supabase = createClient();

  async function upload(file: File) {
    const key = storageKey(a.student_id, file.name, crypto.randomUUID());
    const up = await supabase.storage.from(BUCKET).upload(key, file, { contentType: file.type, upsert: false });
    return up.error ? null : key;
  }
  async function add(v: EvidenceValues) {
    const file = fileRef.current?.files?.[0];
    if (!file) return void setFileError('Choose a file');
    const problem = checkFile(file);
    if (problem) return void setFileError(problem);
    setFileError(undefined);
    const key = await upload(file);
    if (!key) return void toast.error('The file could not be uploaded.');
    const { error } = await supabase.rpc('student_activity_evidence_add', {
      p_activity_id: a.student_activity_id, p_document_type_id: v.document_type_id, p_evidence_type_id: v.evidence_type_id ?? null, p_title: v.title, p_issue_date: v.issue_date ?? null,
      p_issuing_authority: v.issuing_authority ?? null, p_certificate_number: v.certificate_number ?? null, p_storage_key: key, p_file_name: file.name, p_mime: file.type, p_size: file.size, p_checksum: await sha256Hex(file),
    });
    if (error) { await supabase.storage.from(BUCKET).remove([key]); return void toast.error(dbMessage(error, 'The evidence could not be saved.')); }
    toast.success('Evidence added.');
    form.reset();
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();
  }
  async function open(ev: Evidence) {
    setBusy(true);
    const info = await supabase.rpc('student_activity_evidence_download_info', { p_evidence_id: ev.evidence_id });
    if (info.error) { setBusy(false); return void toast.error(dbMessage(info.error, 'The file could not be opened.')); }
    const signed = await supabase.storage.from(BUCKET).createSignedUrl((info.data as { storage_key: string }).storage_key, 60);
    setBusy(false);
    if (signed.error || !signed.data) return void toast.error('The file could not be opened.');
    window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer');
  }
  async function replace(ev: Evidence, file: File | undefined) {
    if (!file) return;
    const problem = checkFile(file);
    if (problem) return void toast.error(problem);
    setBusy(true);
    const key = await upload(file);
    if (!key) { setBusy(false); return void toast.error('The file could not be uploaded.'); }
    const { error } = await supabase.rpc('student_activity_evidence_replace', { p_evidence_id: ev.evidence_id, p_reason: null, p_storage_key: key, p_file_name: file.name, p_mime: file.type, p_size: file.size, p_checksum: await sha256Hex(file) });
    setBusy(false);
    if (error) { await supabase.storage.from(BUCKET).remove([key]); return void toast.error(dbMessage(error, 'The file could not be replaced.')); }
    toast.success('New version saved.');
    router.refresh();
  }
  async function remove(ev: Evidence) {
    const { error } = await supabase.rpc('student_activity_evidence_delete', { p_evidence_id: ev.evidence_id, p_reason: null });
    if (error) return void toast.error(dbMessage(error, 'The evidence could not be removed.'));
    router.refresh();
  }
  return (
    <div className="space-y-4">
      {a.evidence.length === 0 ? <p className="text-sm text-muted-foreground">No evidence uploaded.</p> : (
        <ul className="divide-y divide-border text-sm">
          {a.evidence.map((ev) => (
            <li key={ev.evidence_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{ev.title}</span><span className="text-muted-foreground"> · {ev.evidence_type ?? 'Evidence'} · {ev.file_name} · version {ev.version}{ev.certificate_number ? ` · No. ${ev.certificate_number}` : ''}</span></span>
              <span className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => open(ev)}>Open</Button>
                {a.can_edit && <><label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border bg-card px-3 text-sm hover:bg-muted">Replace<input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png" aria-label={`Replace ${ev.title}`} onChange={(x) => replace(ev, x.target.files?.[0])} /></label>
                  <Button type="button" variant="outline" onClick={() => remove(ev)} aria-label={`Remove ${ev.title}`}>Remove</Button></>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {a.can_edit && (
        <form onSubmit={form.handleSubmit(add)} className="space-y-3" noValidate aria-label="Add evidence">
          <div className="flex flex-wrap items-start gap-3">
            <SelectField id="ev-dt" label="Document type *" className="w-56" options={documentTypes} {...form.register('document_type_id')} error={e.document_type_id?.message} />
            <SelectField id="ev-et" label="Evidence type" className="w-56" options={evidenceTypes} {...form.register('evidence_type_id')} error={e.evidence_type_id?.message} />
            <TextField id="ev-t" label="Title *" className="w-72" maxLength={500} {...form.register('title')} error={e.title?.message} />
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <TextField id="ev-i" type="date" label="Issue date" className="w-44" {...form.register('issue_date')} error={e.issue_date?.message} />
            <TextField id="ev-a" label="Issued by" className="w-64" maxLength={300} {...form.register('issuing_authority')} />
            <TextField id="ev-c" label="Certificate number" className="w-52" maxLength={150} {...form.register('certificate_number')} />
          </div>
          <div><label htmlFor="ev-f" className="text-sm font-medium">File * (PDF, JPEG or PNG, up to 10 MB)</label>
            <input id="ev-f" ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" onChange={() => setFileError(undefined)} className="block text-sm" aria-invalid={!!fileError} />
            {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}</div>
          <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Uploading…' : 'Add evidence'}</Button>
        </form>
      )}
    </div>
  );
}
