'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { RoleOpt, ScopeOpts, UserDetail } from '@/features/iam-data';
import { ACCOUNT_STATUSES, assignSchema, label, REASON_MAX, statusSchema, type AssignInput, type AssignValues, type StatusInput, type StatusValues } from '@/lib/iam-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023') return e.message;
  if (e.code === '42501') return /Not authorised|Only a super/.test(e.message) ? e.message : 'You are not allowed to do that.';
  return fallback;
}
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';

export function AccountStatusForm({ userId, current, disabled }: { userId: number; current: string; disabled: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<StatusValues | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm<StatusInput, unknown, StatusValues>({ resolver: zodResolver(statusSchema), defaultValues: { account_status: ACCOUNT_STATUSES.find((s) => s !== current) ?? 'DISABLED' } });
  const e = form.formState.errors;
  async function apply(v: StatusValues) {
    setBusy(true);
    const { error } = await createClient().rpc('iam_set_account_status', { p_user_id: userId, p_status: v.account_status, p_reason: v.reason ?? null });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The account status could not be changed.'));
    toast.success('Account status changed.');
    setConfirming(null);
    router.refresh();
  }
  if (disabled) return <p className="text-sm text-muted-foreground">You cannot change your own account status.</p>;
  return (
    <form onSubmit={form.handleSubmit((v) => setConfirming(v))} className="space-y-3" noValidate aria-label="Change account status">
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-48"><label htmlFor="as-s" className="text-sm font-medium">New status</label>
          <select id="as-s" className={sel} {...form.register('account_status')}>{ACCOUNT_STATUSES.filter((s) => s !== current).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div className="w-96 max-w-full"><label htmlFor="as-r" className="text-sm font-medium">Reason (required to disable or lock)</label>
          <input id="as-r" maxLength={REASON_MAX} className={sel} {...form.register('reason')} />
          {e.reason?.message && <p role="alert" className="text-sm text-destructive">{e.reason.message}</p>}</div>
      </div>
      <Button type="submit" disabled={busy}>Change status…</Button>
      {confirming && (
        <div role="alertdialog" aria-label="Confirm status change" className="rounded-md border border-border bg-muted p-3 text-sm">
          <p>Set this account to <strong>{label(confirming.account_status)}</strong>? {confirming.account_status !== 'ACTIVE' && 'The person will lose access immediately.'}</p>
          <div className="mt-2 flex gap-2"><Button type="button" disabled={busy} onClick={() => apply(confirming)}>Confirm</Button><Button type="button" variant="outline" onClick={() => setConfirming(null)}>Cancel</Button></div>
        </div>
      )}
    </form>
  );
}

export function AssignRoleForm({ userId, roles, scopes, disabled }: { userId: number; roles: RoleOpt[]; scopes: ScopeOpts; disabled: boolean }) {
  const router = useRouter();
  const form = useForm<AssignInput, unknown, AssignValues>({ resolver: zodResolver(assignSchema), defaultValues: { role_id: '', scope_entity_id: '', reason: '' } });
  const roleId = form.watch('role_id');
  const role = roles.find((r) => String(r.role_id) === roleId);
  const level = role?.role_level;
  const options = level && level in scopes ? scopes[level as keyof ScopeOpts] : [];
  const needsEntity = level !== undefined && level !== 'GLOBAL' && level !== 'SELF';
  const e = form.formState.errors;
  async function submit(v: AssignValues) {
    if (!role) return;
    if (needsEntity && v.scope_entity_id === undefined) return void form.setError('scope_entity_id', { message: 'Select the scope' });
    const { error } = await createClient().rpc('iam_assign_role', { p_user_id: userId, p_role_id: v.role_id, p_scope_type: role.role_level, p_scope_entity_id: needsEntity ? v.scope_entity_id ?? null : null, p_reason: v.reason ?? null });
    if (error) return void toast.error(dbMessage(error, 'The role could not be assigned.'));
    toast.success('Role assigned.');
    form.reset({ role_id: '', scope_entity_id: '', reason: '' });
    router.refresh();
  }
  if (disabled) return <p className="text-sm text-muted-foreground">You cannot change your own roles.</p>;
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-3" noValidate aria-label="Assign a role">
      <div className="flex flex-wrap items-start gap-3">
        <SelectField id="ar-role" label="Role *" className="w-64" options={roles.map((r) => ({ id: r.role_id, label: `${r.role_name} (${label(r.role_level)})` }))} {...form.register('role_id')} error={e.role_id?.message} />
        {needsEntity && <SelectField id="ar-scope" label={`${label(level ?? '')} *`} className="w-64" options={options} {...form.register('scope_entity_id')} error={e.scope_entity_id?.message} />}
        <div className="w-80 max-w-full"><label htmlFor="ar-reason" className="text-sm font-medium">Reason (optional)</label><input id="ar-reason" maxLength={REASON_MAX} className={sel} {...form.register('reason')} /></div>
      </div>
      <Button type="submit" disabled={form.formState.isSubmitting}>Assign role</Button>
    </form>
  );
}

export function RevokeButton({ assignmentId, roleName }: { assignmentId: number; roleName: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function revoke() {
    setBusy(true);
    const { error } = await createClient().rpc('iam_revoke_role', { p_assignment_id: assignmentId, p_reason: null });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The role could not be revoked.'));
    toast.success('Role revoked.');
    router.refresh();
  }
  if (!confirm) return <Button type="button" variant="outline" onClick={() => setConfirm(true)} aria-label={`Revoke ${roleName}`}>Revoke</Button>;
  return <span className="inline-flex items-center gap-2 text-xs">Revoke {roleName}? <Button type="button" disabled={busy} onClick={revoke}>Yes</Button><Button type="button" variant="outline" onClick={() => setConfirm(false)}>No</Button></span>;
}

export type { UserDetail };
