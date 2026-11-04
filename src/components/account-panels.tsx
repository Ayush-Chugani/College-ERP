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
