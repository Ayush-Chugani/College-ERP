'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { safeNextPath } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { loginSchema, type LoginValues } from '@/lib/validation';

export function LoginForm({ next, expired }: { next?: string; expired: boolean }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginValues) {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      // Same message for unknown user / wrong password: no account enumeration. The attempt is logged (throttled in the database).
      void supabase.rpc('auth_failure_record', { p_username: values.email, p_reason: error.code === 'email_not_confirmed' ? 'EMAIL_NOT_CONFIRMED' : 'INVALID_CREDENTIALS' });
      toast.error('Invalid email or password.');
      return;
    }
    // A user with a verified authenticator must pass the second step before the database gives them any identity.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      router.replace(`/mfa?next=${encodeURIComponent(safeNextPath(next))}`);
      router.refresh();
      return;
    }
    await supabase.rpc('auth_login_record');
    router.replace(safeNextPath(next));
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {expired && (
        <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm">
          Your session expired. Please sign in again.
        </p>
      )}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="username" {...register('email')} aria-invalid={!!errors.email} />
        <FieldError message={errors.email?.message} />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" {...register('password')} aria-invalid={!!errors.password} />
        <FieldError message={errors.password?.message} />
      </div>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
          Forgot password?
        </Link>
      </p>
    </form>
  );
}
