import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MfaPolicyTable } from '@/features/iam-links';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Two-step verification policy' };

export default async function MfaPolicyPage() {
  const { supabase } = await requireContext();
  const [list, gaps] = await Promise.all([supabase.rpc('iam_mfa_policy_list'), supabase.rpc('iam_mfa_policy_gaps')]);
  if (list.error) notFound();
  return (
    <div className="max-w-3xl space-y-4">
      <div><h1 className="text-xl font-semibold">Two-step verification policy</h1><p className="text-sm text-muted-foreground">People who hold a required role see only the set-up screen until they enrol an authenticator. <Link href="/admin/users" className="text-primary underline-offset-4 hover:underline">Users</Link></p></div>
      <Card><CardHeader><CardTitle>Roles</CardTitle></CardHeader><CardContent><MfaPolicyTable rows={(list.data ?? []) as { role_code: string; role_name: string; required: boolean }[]} gaps={(gaps.data ?? []) as { username: string; role_code: string }[]} /></CardContent></Card>
    </div>
  );
}
