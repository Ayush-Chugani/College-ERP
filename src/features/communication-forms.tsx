'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { Opt } from '@/features/communication-data';
import {
  announcementSchema, audienceLabel, AUDIENCES, TEXT_MAX,
  type AnnouncementInput, type AnnouncementValues,
} from '@/lib/communication-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023') return e.message;
  if (e.code === '42501') return /Not authorised|your own/.test(e.message) ? e.message : 'You are not allowed to do that.';
  return fallback;
}
const nul = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';

export function AnnouncementForm({ id, defaults, types, departments, canPostGlobal }: { id?: number; defaults?: AnnouncementInput; types: Opt[]; departments: Opt[]; canPostGlobal: boolean }) {
  const router = useRouter();
  const form = useForm<AnnouncementInput, unknown, AnnouncementValues>({ resolver: zodResolver(announcementSchema), defaultValues: defaults ?? { audience_type: 'ALL', department_id: canPostGlobal ? '' : departments[0] ? String(departments[0].id) : '' } });
  const e = form.formState.errors;
  async function submit(v: AnnouncementValues) {
    const { data, error } = await createClient().rpc('announcement_save', {
      p_id: id ?? null, p_type_id: v.announcement_type_id, p_department_id: nul(v.department_id), p_title: v.title, p_description: v.description,
      p_publish_from: new Date(v.publish_from).toISOString(), p_publish_to: v.publish_to ? new Date(v.publish_to).toISOString() : null, p_audience: v.audience_type,
    });
    if (error) return void toast.error(dbMessage(error, 'Could not save the announcement.'));
    toast.success(id ? 'Announcement saved as a draft.' : 'Draft saved. Submit it for approval when it is ready.');
    router.push(`/announcements/${data as number}`);
    router.refresh();
  }
  if (types.length === 0) return <p className="text-sm text-muted-foreground">No announcement type exists yet. A global administrator must add one first.</p>;
  if (departments.length === 0 && !canPostGlobal) return <p className="text-sm text-muted-foreground">You are not allowed to post announcements.</p>;
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate aria-label="Announcement">
      <div className="flex flex-wrap items-start gap-3">
        <SelectField id="at" label="Type *" className="w-48" options={types} {...form.register('announcement_type_id')} error={e.announcement_type_id?.message} />
        <div className="w-60">
          <label htmlFor="ad" className="text-sm font-medium">Department</label>
          <select id="ad" className={sel} {...form.register('department_id')}>
            {canPostGlobal && <option value="">Whole institution</option>}
            {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          {e.department_id?.message && <p role="alert" className="text-sm text-destructive">{e.department_id.message}</p>}
        </div>
        <div className="w-60">
          <label htmlFor="au" className="text-sm font-medium">Audience *</label>
          <select id="au" className={sel} {...form.register('audience_type')}>{AUDIENCES.map((a) => <option key={a} value={a}>{audienceLabel[a]}</option>)}</select>
          {e.audience_type?.message && <p role="alert" className="text-sm text-destructive">{e.audience_type.message}</p>}
        </div>
      </div>
      <TextField id="ati" label="Title *" className="max-w-2xl" maxLength={250} {...form.register('title')} error={e.title?.message} />
      <div className="max-w-2xl">
        <label htmlFor="ax" className="text-sm font-medium">Text *</label>
        <textarea id="ax" rows={8} maxLength={TEXT_MAX} className="w-full rounded-md border border-border bg-card p-2 text-sm" {...form.register('description')} />
        {e.description?.message && <p role="alert" className="text-sm text-destructive">{e.description.message}</p>}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <TextField id="apf" label="Show from *" type="datetime-local" className="w-56" {...form.register('publish_from')} error={e.publish_from?.message} />
        <TextField id="apt" label="Show until" type="datetime-local" className="w-56" hint="Leave empty to keep it up until archived." {...form.register('publish_to')} error={e.publish_to?.message} />
      </div>
      <p className="text-xs text-muted-foreground">With a department, only that department&apos;s active students and current staff see it. Attachments are not available yet.</p>
      <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving…' : id ? 'Save draft' : 'Create draft'}</Button>
    </form>
  );
}

export function WorkflowButtons({ id, canSubmit, canDecide, canArchive }: { id: number; canSubmit: boolean; canDecide: boolean; canArchive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'approve' | 'reject' | 'archive' | null>(null);
  async function run(kind: 'submit' | 'approve' | 'reject' | 'archive') {
    setBusy(true);
    const supabase = createClient();
    const { error } =
      kind === 'submit' ? await supabase.rpc('announcement_submit', { p_id: id })
      : kind === 'archive' ? await supabase.rpc('announcement_archive', { p_id: id })
      : await supabase.rpc('announcement_decide', { p_id: id, p_approve: kind === 'approve' });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The action could not be completed.'));
    toast.success(kind === 'submit' ? 'Submitted for approval.' : kind === 'approve' ? 'Approved and published.' : kind === 'reject' ? 'Rejected.' : 'Archived.');
    setConfirm(null);
    router.refresh();
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canSubmit && <Button type="button" disabled={busy} onClick={() => run('submit')}>Submit for approval</Button>}
        {canDecide && <Button type="button" disabled={busy} onClick={() => setConfirm('approve')}>Approve…</Button>}
        {canDecide && <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm('reject')}>Reject…</Button>}
        {canArchive && <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm('archive')}>Archive…</Button>}
      </div>
      {confirm && (
        <div role="alertdialog" aria-label="Confirm" className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="mb-2">
            {confirm === 'approve' ? 'Approve this announcement? It becomes visible to its audience from its start time.' : confirm === 'reject' ? 'Reject this announcement? The author can edit and resubmit it.' : 'Archive this announcement? It stops being shown.'}
          </p>
          <div className="flex gap-2"><Button type="button" variant={confirm === 'approve' ? 'default' : 'destructive'} disabled={busy} onClick={() => run(confirm)}>{busy ? 'Saving…' : 'Confirm'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button></div>
        </div>
      )}
    </div>
  );
}
