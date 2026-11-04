'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { mfaCodeSchema, type MfaCodeInput, type MfaCodeValues } from '@/lib/account-validation';
import { createClient } from '@/lib/supabase/client';
import { safeNextPath } from '@/lib/utils';

export function MfaChallengeForm({ next }: { next?: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<MfaCodeInput, unknown, MfaCodeValues>({ resolver: zodResolver(mfaCodeSchema) });

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const f = data?.totp?.[0]; // listFactors returns verified factors only
      setFactorId(f?.id ?? null);
      setState(f ? 'ready' : 'none');
    });
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []);

  async function onSubmit(v: MfaCodeValues) {
    if (!factorId) return;
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: v.code });
    if (error) {
      if (email) void supabase.rpc('auth_failure_record', { p_username: email, p_reason: 'MFA_FAILED' });
      toast.error('That code is not valid. Check the time on your phone and try again.');
      return;
    }
    await supabase.rpc('auth_login_record');
    router.replace(safeNextPath(next));
    router.refresh();
  }

  if (state === 'loading') return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (state === 'none') return <p className="text-sm">No authenticator is set up for this account. <a className="text-primary underline-offset-4 hover:underline" href="/login">Back to sign in</a></p>;
  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate aria-label="Verification code">
        <p className="text-sm text-muted-foreground">Open your authenticator app and enter the 6-digit code for SIMS.</p>
        <div>
          <Label htmlFor="code">Code</Label>
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} {...register('code')} aria-invalid={!!errors.code} />
          <FieldError message={errors.code?.message} />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? 'Checking…' : 'Verify'}</Button>
      </form>
      <form action="/auth/signout" method="post"><Button type="submit" variant="outline" className="w-full">Cancel and sign out</Button></form>
    </div>
  );
}
