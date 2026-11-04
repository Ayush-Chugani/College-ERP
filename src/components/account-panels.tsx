'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { mfaCodeSchema, profilePayload, profileSchema, type MfaCodeInput, type MfaCodeValues, type ProfileInput, type ProfileValues } from '@/lib/account-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '22023' || e.code === '23505' || e.code === '42501') return e.message;
  return fallback;
}

export function ProfileForm({ initial }: { initial: { primary_email: string | null; primary_phone: string | null } }) {
  const router = useRouter();
  const form = useForm<ProfileInput, unknown, ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: { primary_email: initial.primary_email ?? '', primary_phone: initial.primary_phone ?? '' } });
  const e = form.formState.errors;
  async function submit(v: ProfileValues) {
    const { error } = await createClient().rpc('my_profile_update', { p: profilePayload(v) });
    if (error) return void toast.error(dbMessage(error, 'Your details could not be saved.'));
    toast.success('Your details were saved.');
    router.refresh();
  }
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-3" noValidate aria-label="Contact details">
      <TextField id="pf-email" type="email" label="Contact email" className="max-w-sm" maxLength={254} {...form.register('primary_email')} error={e.primary_email?.message} />
      <TextField id="pf-phone" type="tel" label="Phone" className="max-w-xs" maxLength={25} {...form.register('primary_phone')} error={e.primary_phone?.message} />
      <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving…' : 'Save'}</Button>
    </form>
  );
}

type Factor = { id: string; friendly_name?: string | null; status: string };
type Enrolment = { factorId: string; qr: string; secret: string };

export function MfaPanel() {
  const router = useRouter();
  const supabase = createClient();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrol, setEnrol] = useState<Enrolment | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm<MfaCodeInput, unknown, MfaCodeValues>({ resolver: zodResolver(mfaCodeSchema) });
  const e = form.formState.errors;

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  async function start() {
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `SIMS ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (error || !data) return void toast.error('Two-step verification could not be started.');
    setEnrol({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }
  async function confirm(v: MfaCodeValues) {
    if (!enrol) return;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrol.factorId, code: v.code });
    if (error) return void toast.error('That code is not valid. Check the time on your phone and try again.');
    await supabase.rpc('mfa_sync');
    toast.success('Two-step verification is on.');
    setEnrol(null);
    form.reset();
    await load();
    router.refresh();
  }
  async function cancelEnrol() {
    if (enrol) await supabase.auth.mfa.unenroll({ factorId: enrol.factorId });
    setEnrol(null);
    form.reset();
  }
  async function remove(f: Factor) {
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (!error) await supabase.rpc('mfa_sync');
    setBusy(false);
    if (error) return void toast.error('It could not be turned off. Sign in again with your code and retry.');
    toast.success('Two-step verification is off.');
    await load();
    router.refresh();
  }
  if (factors === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const active = factors.filter((f) => f.status === 'verified');
  return (
    <div className="space-y-3">
      {active.length > 0 ? (
        <ul className="divide-y divide-border text-sm">
          {active.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>Authenticator app <span className="text-muted-foreground">{f.friendly_name ? `· ${f.friendly_name}` : ''}</span></span>
              <Button type="button" variant="outline" disabled={busy} onClick={() => remove(f)}>Turn off</Button>
            </li>
          ))}
        </ul>
      ) : !enrol ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Two-step verification asks for a code from an authenticator app after your password. It is off for your account.</p>
          <Button type="button" disabled={busy} onClick={start}>Set up two-step verification</Button>
        </div>
      ) : null}
      {active.length > 0 && <RecoveryCodes />}
      {enrol && (
        <form onSubmit={form.handleSubmit(confirm)} className="space-y-3 rounded-md border border-border bg-muted p-3" noValidate aria-label="Confirm two-step verification">
          <p className="text-sm">Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…), then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qr} alt="QR code for the authenticator app" width={160} height={160} className="rounded bg-white p-1" />
          <p className="break-all text-xs text-muted-foreground">Cannot scan? Enter this key by hand: <code>{enrol.secret}</code></p>
          <TextField id="mfa-code" label="Code" className="max-w-[10rem]" inputMode="numeric" autoComplete="one-time-code" maxLength={8} {...form.register('code')} error={e.code?.message} />
          <div className="flex gap-2"><Button type="submit" disabled={form.formState.isSubmitting}>Turn on</Button><Button type="button" variant="outline" onClick={cancelEnrol}>Cancel</Button></div>
        </form>
      )}
    </div>
  );
}

/** Recovery codes (migration 056): shown once after generation; only the count of unused codes is ever shown again. */
export function RecoveryCodes() {
  const supabase = createClient();
  const [status, setStatus] = useState<{ unused: number; generated_at: string | null } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('mfa_recovery_status');
    setStatus((data ?? null) as { unused: number; generated_at: string | null } | null);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);
  async function generate() {
    if (status && status.unused > 0 && !window.confirm('This replaces your current recovery codes. Continue?')) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('mfa_recovery_generate');
    setBusy(false);
    if (error) return void toast.error('The recovery codes could not be created. Sign in again with your authenticator code and retry.');
    setCodes(data as string[]);
    await load();
  }
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-sm font-medium">Recovery codes</p>
      <p className="text-sm text-muted-foreground">If you lose your phone, one of these codes lets you sign in once and set up a new authenticator. Keep them somewhere safe; each works once.{status ? ` You have ${status.unused} unused code${status.unused === 1 ? '' : 's'}.` : ''}</p>
      <Button type="button" variant="outline" disabled={busy} onClick={generate}>{status && status.unused > 0 ? 'Create new codes' : 'Create recovery codes'}</Button>
      {codes && (
        <div className="space-y-2 rounded-md border border-border bg-muted p-3" role="status">
          <p className="text-sm font-medium">Save these now. They will not be shown again.</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => { void navigator.clipboard?.writeText(codes.join('\n')); toast.success('Copied.'); }}>Copy</Button>
            <Button type="button" variant="outline" onClick={() => setCodes(null)}>I have saved them</Button>
          </div>
        </div>
      )}
    </div>
  );
}
