import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NewPasswordForm } from '@/components/new-password-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The recovery link signs the user in through /auth/callback; without that session there is nothing to reset.
  if (!user) redirect('/forgot-password');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
      </CardHeader>
      <CardContent>
        <NewPasswordForm redirectTo="/dashboard" />
      </CardContent>
    </Card>
  );
}
