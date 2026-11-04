import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LinkAuthUserForm } from '@/features/iam-links';
import { UserProvisioningForm } from '@/features/user-provisioning-form';
import { serviceRoleConfigured } from '@/lib/supabase/admin';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Create user' };

export default async function NewUserPage() {
  const { supabase } = await requireContext();
  const { data: allowed } = await supabase.rpc('iam_can_provision'); // authoritative; the nav only hints
  if (allowed !== true) notFound();
  const configured = serviceRoleConfigured();

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Create user</h1>
        <p className="text-sm text-muted-foreground">Creates a sign-in (Supabase Auth) and the matching SIMS account. <Link href="/admin/users" className="text-primary underline-offset-4 hover:underline">Back to users</Link></p>
      </div>
      {!configured && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">
          This server has no <code>SUPABASE_SERVICE_ROLE_KEY</code>, so users cannot be created here yet. Add it to the server environment (never to a <code>NEXT_PUBLIC_</code> variable) and restart.
        </p>
      )}
      <Card><CardHeader><CardTitle>New user</CardTitle></CardHeader><CardContent><UserProvisioningForm /></CardContent></Card>
      <Card><CardHeader><CardTitle>Link a sign-in account that already exists</CardTitle></CardHeader><CardContent><p className="mb-3 text-sm text-muted-foreground">For a user you created in the Supabase Authentication dashboard. Needs no service key.</p><LinkAuthUserForm /></CardContent></Card>
    </div>
  );
}
