'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { ActivityDetail, Opt, TeamMember } from '@/features/activity-data';
import { ACHIEVEMENTS, activityPayload, activitySchema, label, teamSchema, type ActivityInput, type ActivityValues, type TeamInput, type TeamValues } from '@/lib/activity-validation';
import { createClient } from '@/lib/supabase/client';
import { EvidencePanel as GenericEvidence } from '@/features/evidence-panel';
import { WorkflowActions as GenericWorkflow } from '@/features/workflow-actions';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023' || e.code === '23505') return e.message;
  if (e.code === '42501') return /Not authorised/.test(e.message) ? e.message : 'You are not allowed to do that.';
  return fallback;
}
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const area = 'w-full rounded-md border border-border bg-card p-2 text-sm';
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

export function WorkflowActions({ a }: { a: ActivityDetail }) {
  return <GenericWorkflow id={a.student_activity_id} flags={a} rpcPrefix="student_activity" afterDeleteHref="/activities" />;
}

export function EvidencePanel({ a, documentTypes, evidenceTypes }: { a: ActivityDetail; documentTypes: Opt[]; evidenceTypes: Opt[] }) {
  return <GenericEvidence a={{ activityId: a.student_activity_id, ownerId: a.student_id, ownerKind: 'student', canEdit: a.can_edit, evidence: a.evidence }} documentTypes={documentTypes} evidenceTypes={evidenceTypes} />;
}
