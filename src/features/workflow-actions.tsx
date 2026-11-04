'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { APPROVE_DECISIONS, label, reviewSchema, VERIFY_DECISIONS, type ReviewInput, type ReviewValues } from '@/lib/activity-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023' || e.code === '23505') return e.message;
  if (e.code === '42501') return /Not authorised|cannot review/.test(e.message) ? e.message : 'You are not allowed to do that.';
  return fallback;
}
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';

export type WorkflowFlags = { can_edit: boolean; can_delete: boolean; can_verify: boolean; can_approve: boolean };

/** Submit / verify / approve / delete for a record that follows the DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED lifecycle. rpcPrefix is student_activity or staff_activity. */
export function WorkflowActions({ id, flags, rpcPrefix, afterDeleteHref }: { id: number; flags: WorkflowFlags; rpcPrefix: 'student_activity' | 'staff_activity'; afterDeleteHref: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const step = flags.can_verify ? 'VERIFY' : 'APPROVE';
  const form = useForm<ReviewInput, unknown, ReviewValues>({ resolver: zodResolver(reviewSchema), defaultValues: { step, decision: '', remarks: '' } });
  const e = form.formState.errors;
  const decisions = step === 'VERIFY' ? VERIFY_DECISIONS : APPROVE_DECISIONS;
  const supabase = createClient();
  async function call(fn: () => PromiseLike<{ error: DbError | null }>, ok: string, fallback: string, after?: () => void) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, fallback));
    toast.success(ok);
    after?.();
    router.refresh();
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {flags.can_edit && <Button type="button" disabled={busy} onClick={() => call(() => supabase.rpc(`${rpcPrefix}_submit`, { p_activity_id: id }), 'Submitted for verification.', 'It could not be submitted.')}>Submit for verification</Button>}
        {flags.can_delete && (confirmDelete
          ? <><span className="text-sm">Delete this record?</span><Button type="button" variant="outline" disabled={busy} onClick={() => call(() => supabase.rpc(`${rpcPrefix}_delete`, { p_activity_id: id, p_reason: null }), 'Deleted.', 'It could not be deleted.', () => router.push(afterDeleteHref))}>Yes, delete</Button><Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button></>
          : <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)}>Delete</Button>)}
      </div>
      {(flags.can_verify || flags.can_approve) && (
        <form onSubmit={form.handleSubmit((v) => call(() => supabase.rpc(`${rpcPrefix}_review`, { p_activity_id: id, p_step: v.step, p_decision: v.decision, p_remarks: v.remarks ?? null }), 'Decision recorded.', 'The decision could not be saved.', () => form.reset({ step, decision: '', remarks: '' })))}
          className="space-y-2 rounded-md border border-border bg-muted p-3" noValidate aria-label={step === 'VERIFY' ? 'Verify the record' : 'Approve the record'}>
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
