'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { Detail, Opt } from '@/features/announcement-data';
import {
  announcementSchema, APPROVER_TARGETS, AUDIENCES, DESCRIPTION_MAX, label, toLocalInput, TRANSITIONS,
  type AnnouncementInput, type AnnouncementValues,
} from '@/lib/announcement-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023') return e.message;
  if (e.code === '42501') return /Not authorised/.test(e.message) ? e.message : 'You are not allowed to do that.';
  return fallback;
}
const iso = (local: string) => new Date(local).toISOString();

export function AnnouncementForm({ types, departments, initial }: { types: Opt[]; departments: Opt[]; initial?: Detail }) {
  const router = useRouter();
  const form = useForm<AnnouncementInput, unknown, AnnouncementValues>({
    resolver: zodResolver(announcementSchema),
    defaultValues: initial
      ? {
          announcement_type_id: String(initial.announcement_type_id), department_id: initial.department_id ? String(initial.department_id) : '', title: initial.title, description: initial.description,
          audience_type: initial.audience_type as (typeof AUDIENCES)[number], publish_from: toLocalInput(initial.publish_from), publish_to: toLocalInput(initial.publish_to),
        }
      : { audience_type: 'ALL', department_id: '', publish_to: '' },
  });
  const e = form.formState.errors;
  async function submit(v: AnnouncementValues) {
    const { data, error } = await createClient().rpc('announcement_save', {
      p_id: initial?.announcement_id ?? null, p_type_id: v.announcement_type_id, p_department_id: v.department_id ?? null, p_title: v.title, p_description: v.description,
      p_publish_from: iso(v.publish_from), p_publish_to: v.publish_to ? iso(v.publish_to) : null, p_audience: v.audience_type,
    });
    if (error) return void toast.error(dbMessage(error, 'The announcement could not be saved.'));
    toast.success('Saved.');
    if (initial) router.refresh();
    else router.push(`/announcements/${data as number}`);
  }
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-3" noValidate aria-label="Announcement">
      <div className="flex flex-wrap items-start gap-3">
        <SelectField id="an-type" label="Type *" className="w-56" options={types} {...form.register('announcement_type_id')} error={e.announcement_type_id?.message} />
        <div className="w-48">
          <label htmlFor="an-aud" className="text-sm font-medium">Audience *</label>
          <select id="an-aud" className="flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm" {...form.register('audience_type')}>{AUDIENCES.map((a) => <option key={a} value={a}>{label(a)}</option>)}</select>
        </div>
        <SelectField id="an-dept" label="Department" className="w-56" options={departments} hint="Leave empty for institution-wide (needs a global grant)" {...form.register('department_id')} error={e.department_id?.message} />
      </div>
      <TextField id="an-title" label="Title *" className="max-w-2xl" maxLength={250} {...form.register('title')} error={e.title?.message} />
      <div className="max-w-2xl">
        <label htmlFor="an-desc" className="text-sm font-medium">Description *</label>
        <textarea id="an-desc" rows={8} maxLength={DESCRIPTION_MAX} className="w-full rounded-md border border-border bg-card p-2 text-sm" {...form.register('description')} />
        {e.description?.message && <p role="alert" className="text-sm text-destructive">{e.description.message}</p>}
      </div>
      <div className="flex flex-wrap gap-3">
        <TextField id="an-from" type="datetime-local" label="Publish from *" className="w-60" {...form.register('publish_from')} error={e.publish_from?.message} />
        <TextField id="an-to" type="datetime-local" label="Publish until (optional)" className="w-60" {...form.register('publish_to')} error={e.publish_to?.message} />
      </div>
      <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving…' : initial ? 'Save changes' : 'Create draft'}</Button>
    </form>
  );
}

export function StatusActions({ detail }: { detail: Detail }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const targets = (TRANSITIONS[detail.approval_status] ?? []).filter((t) => ((APPROVER_TARGETS as readonly string[]).includes(t) ? detail.can_approve : detail.can_update));
  async function move(to: string) {
    setBusy(true);
    const { error } = await createClient().rpc('announcement_set_status', { p_id: detail.announcement_id, p_status: to });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The status could not be changed.'));
    toast.success(`Now ${label(to).toLowerCase()}.`);
    router.refresh();
  }
  async function remove() {
    setBusy(true);
    const { error } = await createClient().rpc('announcement_delete', { p_id: detail.announcement_id });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The announcement could not be deleted.'));
    toast.success('Deleted.');
    router.push('/announcements');
  }
  const verb: Record<string, string> = { PENDING: 'Submit for approval', APPROVED: 'Approve and publish', REJECTED: 'Reject', ARCHIVED: 'Archive', DRAFT: 'Move back to draft' };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {targets.map((t) => <Button key={t} type="button" variant={t === 'REJECTED' ? 'outline' : 'default'} disabled={busy} onClick={() => move(t)}>{verb[t] ?? label(t)}</Button>)}
      {detail.can_delete && detail.approval_status === 'DRAFT' && (confirmDelete
        ? <><span className="text-sm">Delete this draft?</span><Button type="button" variant="outline" disabled={busy} onClick={remove}>Yes, delete</Button><Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button></>
        : <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)}>Delete</Button>)}
    </div>
  );
}
