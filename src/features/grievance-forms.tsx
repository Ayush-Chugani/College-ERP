'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { Opt } from '@/features/grievance-data';
import {
  actionSchema, categorySchema, DESCRIPTION_MAX, label, NEEDS_RESOLUTION, NOTE_MAX, PRIORITIES, submitSchema, TRANSITIONS,
  type ActionInput, type ActionValues, type CategoryInput, type CategoryValues, type SubmitInput, type SubmitValues,
} from '@/lib/grievance-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023') return e.message;
  if (e.code === '42501') return /Not authorised|Only students|Unknown grievance/.test(e.message) ? e.message : 'You are not allowed to do that.';
  if (e.code === '23505') return 'That already exists.';
  return fallback;
}
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const nul = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);

export function SubmitForm({ categories, departments }: { categories: Opt[]; departments: Opt[] }) {
  const router = useRouter();
  const form = useForm<SubmitInput, unknown, SubmitValues>({ resolver: zodResolver(submitSchema), defaultValues: { priority: 'NORMAL' } });
  const e = form.formState.errors;
  async function submit(v: SubmitValues) {
    const { data, error } = await createClient().rpc('grievance_submit', {
      p_category_id: v.grievance_category_id, p_department_id: nul(v.department_id), p_subject: v.subject, p_description: v.description, p_priority: v.priority,
    });
    if (error) return void toast.error(dbMessage(error, 'Your grievance could not be submitted.'));
    toast.success('Your grievance was submitted.');
    router.push(`/grievances/${data as number}`);
  }
  if (categories.length === 0) return <p className="text-sm text-muted-foreground">Grievances cannot be filed yet: no category has been set up. Please contact the administration.</p>;
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-3" noValidate aria-label="Submit a grievance">
      <div className="flex flex-wrap items-start gap-3">
        <SelectField id="gc" label="Category *" className="w-56" options={categories} {...form.register('grievance_category_id')} error={e.grievance_category_id?.message} />
        {departments.length > 0 && <SelectField id="gd" label="Department (optional)" className="w-56" options={departments} {...form.register('department_id')} error={e.department_id?.message} />}
        <div className="w-40"><label htmlFor="gp" className="text-sm font-medium">Priority *</label><select id="gp" className={sel} {...form.register('priority')}>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></div>
      </div>
      <TextField id="gs" label="Subject *" className="max-w-2xl" maxLength={200} {...form.register('subject')} error={e.subject?.message} />
      <div className="max-w-2xl">
        <label htmlFor="gx" className="text-sm font-medium">Description *</label>
        <textarea id="gx" rows={6} maxLength={DESCRIPTION_MAX} className="w-full rounded-md border border-border bg-card p-2 text-sm" {...form.register('description')} />
        {e.description?.message && <p role="alert" className="text-sm text-destructive">{e.description.message}</p>}
      </div>
      <p className="text-xs text-muted-foreground">Your name is stored with the grievance and visible to the staff who handle it.</p>
      <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Submitting…' : 'Submit grievance'}</Button>
    </form>
  );
}

export function StudentRespond({ grievanceId, status }: { grievanceId: number; status: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const canClose = status === 'RESOLVED' || status === 'REJECTED';
  const canReopen = status === 'RESOLVED';
  async function respond(response: 'CLOSE' | 'REOPEN') {
    setBusy(true);
    const { error } = await createClient().rpc('grievance_student_respond', { p_grievance_id: grievanceId, p_response: response, p_notes: notes.trim() || null });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'Could not record your response.'));
    toast.success(response === 'CLOSE' ? 'Grievance closed.' : 'Grievance re-opened.');
    setNotes('');
    router.refresh();
  }
  if (!canClose) return null;
  return (
    <div className="space-y-2">
      <label htmlFor="sr" className="text-sm font-medium">Your response (optional)</label>
      <textarea id="sr" rows={3} maxLength={NOTE_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full max-w-2xl rounded-md border border-border bg-card p-2 text-sm" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => respond('CLOSE')}>{status === 'RESOLVED' ? 'Accept and close' : 'Close'}</Button>
        {canReopen && <Button type="button" variant="outline" disabled={busy} onClick={() => respond('REOPEN')}>Not resolved, re-open</Button>}
      </div>
    </div>
  );
}

export function ActionForm({ grievanceId, status }: { grievanceId: number; status: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<ActionValues | null>(null);
  const [busy, setBusy] = useState(false);
  const next = TRANSITIONS[status] ?? [];
  const form = useForm<ActionInput, unknown, ActionValues>({ resolver: zodResolver(actionSchema), defaultValues: { action_type: 'COMMENT' } });
  const type = form.watch('action_type');
  const target = form.watch('new_status');
  const e = form.formState.errors;

  async function apply(v: ActionValues) {
    setBusy(true);
    const { error } = await createClient().rpc('grievance_act', { p_grievance_id: grievanceId, p_action_type: v.action_type, p_notes: nul(v.notes), p_new_status: v.action_type === 'STATUS_CHANGE' ? nul(v.new_status) : null, p_resolution: nul(v.resolution) });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The action could not be recorded.'));
    toast.success('Recorded.');
    setConfirming(null);
    form.reset({ action_type: 'COMMENT', notes: '', new_status: '', resolution: '' });
    router.refresh();
  }
  if (status === 'CLOSED') return <p className="text-sm text-muted-foreground">This grievance is closed.</p>;
  return (
    <form onSubmit={form.handleSubmit((v) => (v.action_type === 'STATUS_CHANGE' ? setConfirming(v) : void apply(v)))} className="space-y-3" noValidate aria-label="Record an action">
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-56">
          <label htmlFor="at" className="text-sm font-medium">Action</label>
          <select id="at" className={sel} {...form.register('action_type')}>
            <option value="COMMENT">Comment (student sees it)</option><option value="INTERNAL_NOTE">Internal note (staff only)</option>
            {next.length > 0 && <option value="STATUS_CHANGE">Change status</option>}
          </select>
        </div>
        {type === 'STATUS_CHANGE' && (
          <div className="w-48"><label htmlFor="ns" className="text-sm font-medium">New status</label>
            <select id="ns" className={sel} {...form.register('new_status')}><option value="">— select —</option>{next.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
            {e.new_status?.message && <p role="alert" className="text-sm text-destructive">{e.new_status.message}</p>}
          </div>
        )}
      </div>
      <div className="max-w-2xl">
        <label htmlFor="an" className="text-sm font-medium">{type === 'STATUS_CHANGE' ? 'Note (optional)' : 'Note *'}</label>
        <textarea id="an" rows={3} maxLength={NOTE_MAX} className="w-full rounded-md border border-border bg-card p-2 text-sm" {...form.register('notes')} />
        {e.notes?.message && <p role="alert" className="text-sm text-destructive">{e.notes.message}</p>}
      </div>
      {type === 'STATUS_CHANGE' && target && (NEEDS_RESOLUTION as readonly string[]).includes(target) && (
        <div className="max-w-2xl">
          <label htmlFor="ar" className="text-sm font-medium">Resolution * (shown to the student)</label>
          <textarea id="ar" rows={3} maxLength={DESCRIPTION_MAX} className="w-full rounded-md border border-border bg-card p-2 text-sm" {...form.register('resolution')} />
          {e.resolution?.message && <p role="alert" className="text-sm text-destructive">{e.resolution.message}</p>}
        </div>
      )}
      <Button type="submit" disabled={busy}>{type === 'STATUS_CHANGE' ? 'Change status…' : 'Add'}</Button>
      {confirming && (
        <div role="alertdialog" aria-label="Confirm status change" className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="mb-2">Change the status from <strong>{label(status)}</strong> to <strong>{label(confirming.new_status ?? '')}</strong>? This is recorded in the history and the student is shown it.</p>
          <div className="flex gap-2">
            <Button type="button" variant={confirming.new_status === 'REJECTED' ? 'destructive' : 'default'} disabled={busy} onClick={() => apply(confirming)}>{busy ? 'Saving…' : 'Confirm'}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </form>
  );
}

export function CategoryManager({ categories, canManage }: { categories: { grievance_category_id: number; category_code: string; category_name: string; is_active: boolean }[]; canManage: boolean }) {
  const router = useRouter();
  const form = useForm<CategoryInput, unknown, CategoryValues>({ resolver: zodResolver(categorySchema) });
  async function add(v: CategoryValues) {
    const { error } = await createClient().from('grievance_category').insert(v);
    if (error) return void toast.error(error.code === '23505' ? 'That code or name already exists.' : dbMessage(error, 'Could not add the category.'));
    toast.success('Category added.');
    form.reset({ category_code: '', category_name: '' });
    router.refresh();
  }
  async function toggle(id: number, active: boolean) {
    const { data, error } = await createClient().from('grievance_category').update({ is_active: !active }).eq('grievance_category_id', id).select('grievance_category_id');
    if (error || !data?.length) return void toast.error('Could not change the category.');
    router.refresh();
  }
  return (
    <div className="space-y-3">
      {categories.length === 0 ? <p className="text-sm text-muted-foreground">No categories yet. Students cannot file grievances until one exists.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {categories.map((c) => (
            <li key={c.grievance_category_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span>{c.category_code} — {c.category_name} <span className="text-muted-foreground">· {c.is_active ? 'active' : 'inactive'}</span></span>
              {canManage && <Button type="button" variant="outline" onClick={() => toggle(c.grievance_category_id, c.is_active)}>{c.is_active ? 'Deactivate' : 'Activate'}</Button>}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={form.handleSubmit(add)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Add category">
          <TextField id="cc" label="Code *" className="w-32" maxLength={30} {...form.register('category_code')} error={form.formState.errors.category_code?.message} />
          <TextField id="cn" label="Name *" className="w-64" maxLength={100} {...form.register('category_name')} error={form.formState.errors.category_name?.message} />
          <div className="pt-6"><Button type="submit" disabled={form.formState.isSubmitting}>Add category</Button></div>
        </form>
      )}
    </div>
  );
}
