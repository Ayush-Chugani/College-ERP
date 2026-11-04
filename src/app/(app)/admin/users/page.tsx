import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IAM_PAGE_SIZE, listUsers } from '@/features/iam-data';
import { can } from '@/lib/context';
import { label, userListParams, type UserListParams } from '@/lib/iam-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Users and roles' };
const STATUSES = ['PENDING', 'ACTIVE', 'LOCKED', 'DISABLED', 'EXPIRED'];

function href(p: UserListParams, patch: Partial<UserListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.status) sp.set('status', n.status);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/admin/users?${sp.toString()}`;
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'IAM.ALL.READ')) notFound();
  const params = userListParams.parse(await searchParams);
  const { rows, total, error } = await listUsers(supabase, params);
  const pages = Math.max(1, Math.ceil(total / IAM_PAGE_SIZE));
  return (
    <div className="max-w-6xl space-y-4">
      <div><h1 className="text-xl font-semibold">Users and roles</h1><p className="text-sm text-muted-foreground">Activate or deactivate accounts and manage role assignments.</p></div>
      <form method="get" action="/admin/users" className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={params.q ?? ''} aria-label="Search" placeholder="Username or email" maxLength={100} className="h-9 w-72 rounded-md border border-border bg-card px-3 text-sm" />
        <select name="status" defaultValue={params.status ?? ''} aria-label="Status" className="h-9 rounded-md border border-border bg-card px-3 text-sm"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <Button type="submit">Search</Button>
      </form>
      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load users.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr>
            <th scope="col" className="px-4 py-2 font-medium">User</th><th scope="col" className="px-4 py-2 font-medium">Linked to</th><th scope="col" className="px-4 py-2 font-medium">Roles</th><th scope="col" className="px-4 py-2 font-medium">Status</th><th scope="col" className="px-4 py-2 font-medium">Last sign-in</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">{params.q || params.status ? 'No users match the search.' : 'No users.'}</td></tr> : rows.map((u) => (
              <tr key={u.user_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2"><Link href={`/admin/users/${u.user_id}`} className="text-primary underline-offset-4 hover:underline">{u.username}</Link>{u.email && <div className="text-xs text-muted-foreground">{u.email}</div>}</td>
                <td className="px-4 py-2">{u.linked_to || '—'}</td><td className="px-4 py-2">{u.roles || '—'}</td><td className="px-4 py-2">{label(u.account_status)}</td>
                <td className="px-4 py-2 whitespace-nowrap">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
        <span>Page {Math.min(params.page, pages)} of {pages}</span>
        <div className="flex gap-2">
          {params.page > 1 && <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={href(params, { page: params.page - 1 })}>Previous</Link>}
          {params.page < pages && <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={href(params, { page: params.page + 1 })}>Next</Link>}
        </div>
      </nav>
    </div>
  );
}
