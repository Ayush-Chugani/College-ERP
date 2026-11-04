'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const msg = (e: { code?: string; message: string }, fb: string) => (['22023', '23505', '42501', '45000'].includes(e.code ?? '') ? e.message : fb);

/** Link a sign-in account that already exists in Supabase Auth (created in the dashboard) to a SIMS account and, optionally, a person (migration 058). */
export function LinkAuthUserForm() {
  const router = useRouter();
  const [f, setF] = useState({ email: '', kind: 'student', number: '' });
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { data, error } = await createClient().rpc('iam_link_auth_user', { p_email: f.email, p_student_number: f.kind === 'student' && f.number ? f.number : null, p_employee_number: f.kind === 'employee' && f.number ? f.number : null });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'The account could not be linked.'));
    toast.success('Linked.');
    router.push(`/admin/users/${String(data)}`);
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-72"><label htmlFor="la-e" className="text-sm font-medium">Sign-in email *</label><input id="la-e" type="email" className={sel} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div className="w-32"><label htmlFor="la-k" className="text-sm font-medium">Person</label><select id="la-k" className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="student">Student</option><option value="employee">Employee</option></select></div>
      <div className="w-44"><label htmlFor="la-n" className="text-sm font-medium">Number (optional)</label><input id="la-n" className={sel} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></div>
      <Button type="button" disabled={busy || !f.email} onClick={go}>Link account</Button>
    </div>
  );
}

/** Attach a student or employee to an existing account that has none. */
export function LinkPersonForm({ userId, disabled }: { userId: number; disabled: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ kind: 'student', number: '' });
  const [busy, setBusy] = useState(false);
  if (disabled) return <p className="text-sm text-muted-foreground">You cannot change your own links.</p>;
  async function go() {
    setBusy(true);
    const { error } = await createClient().rpc('iam_link_person', { p_user_id: userId, p_student_number: f.kind === 'student' ? f.number : null, p_employee_number: f.kind === 'employee' ? f.number : null });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'The person could not be linked.'));
    toast.success('Linked.');
    setF({ ...f, number: '' });
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-32"><label htmlFor="lp-k" className="text-sm font-medium">Person</label><select id="lp-k" className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="student">Student</option><option value="employee">Employee</option></select></div>
      <div className="w-44"><label htmlFor="lp-n" className="text-sm font-medium">Number *</label><input id="lp-n" className={sel} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></div>
      <Button type="button" disabled={busy || !f.number} onClick={go}>Link person</Button>
      <p className="w-full text-xs text-muted-foreground">Only works for an account that is not linked to a person yet.</p>
    </div>
  );
}

type Row = { role_code: string; role_name: string; required: boolean };
export function MfaPolicyTable({ rows, gaps }: { rows: Row[]; gaps: { username: string; role_code: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle(r: Row) {
    setBusy(true);
    const { error } = await createClient().rpc('iam_mfa_policy_set', { p_role_code: r.role_code, p_required: !r.required });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'The policy could not be changed.'));
    router.refresh();
  }
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border text-sm">
        {rows.map((r) => (
          <li key={r.role_code} className="flex items-center justify-between gap-2 py-2">
            <span>{r.role_name} <span className="text-muted-foreground">({r.role_code})</span></span>
            <Button type="button" variant={r.required ? 'default' : 'outline'} disabled={busy} onClick={() => toggle(r)}>{r.required ? 'Required: turn off' : 'Require'}</Button>
          </li>
        ))}
      </ul>
      <div>
        <p className="text-sm font-medium">Not enrolled yet ({gaps.length})</p>
        {gaps.length === 0 ? <p className="text-sm text-muted-foreground">Everyone who holds a required role has two-step verification.</p> : <ul className="text-sm">{gaps.map((g) => <li key={`${g.username}-${g.role_code}`}>{g.username} <span className="text-muted-foreground">· {g.role_code}</span></li>)}</ul>}
      </div>
    </div>
  );
}
