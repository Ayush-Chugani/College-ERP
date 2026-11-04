import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getUser, listRoles, listScopes, parseId } from '@/features/iam-data';
import { AccountStatusForm, AssignRoleForm, RevokeButton } from '@/features/iam-forms';
import { label } from '@/lib/iam-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'User' };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const { supabase } = await requireContext();
  const u = await getUser(supabase, id);
  if (!u) notFound();
  const [roles, scopes] = u.can_update ? await Promise.all([listRoles(supabase), listScopes(supabase)]) : [[], { INSTITUTION: [], CAMPUS: [], DEPARTMENT: [], PROGRAMME: [] }];
  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{u.username}</h1>
          <p className="text-sm text-muted-foreground">{u.email ?? 'No email'} · <span className="font-medium text-foreground">{label(u.account_status)}</span> · last sign-in {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'never'}</p>
        </div>
        <Link href="/admin/users" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">All users</Link>
      </div>
      {u.can_update && <Card><CardHeader><CardTitle>Account status</CardTitle></CardHeader><CardContent><AccountStatusForm userId={u.user_id} current={u.account_status} disabled={u.is_self} /></CardContent></Card>}
      <Card className="overflow-x-auto">
        <CardHeader><CardTitle>Role assignments</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left"><tr><th scope="col" className="py-2 pr-4 font-medium">Role</th><th scope="col" className="py-2 pr-4 font-medium">Scope</th><th scope="col" className="py-2 pr-4 font-medium">Status</th><th scope="col" className="py-2 pr-4 font-medium">Since</th><th scope="col" className="py-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {u.assignments.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No role assignments.</td></tr> : u.assignments.map((a) => (
                <tr key={a.assignment_id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4">{a.role_name}</td><td className="py-2 pr-4">{label(a.scope_type)}{a.scope ? ` · ${a.scope}` : ''}</td><td className="py-2 pr-4">{label(a.status)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{new Date(a.valid_from).toLocaleDateString()}</td>
                  <td className="py-2">{u.can_update && !u.is_self && a.status !== 'REVOKED' && <RevokeButton assignmentId={a.assignment_id} roleName={a.role_name} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {u.can_update && <Card><CardHeader><CardTitle>Assign a role</CardTitle></CardHeader><CardContent><AssignRoleForm userId={u.user_id} roles={roles} scopes={scopes} disabled={u.is_self} /></CardContent></Card>}
    </div>
  );
}
