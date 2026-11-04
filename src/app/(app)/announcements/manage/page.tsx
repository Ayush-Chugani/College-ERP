import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { COMM_PAGE_SIZE, listManaged } from '@/features/communication-data';
import { audienceLabel, listParams, statusLabel, STATUSES, type ListParams } from '@/lib/communication-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Manage announcements' };

function href(p: ListParams, patch: Partial<ListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.status) sp.set('status', n.status);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/announcements/manage?${sp.toString()}`;
}

export default async function ManagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!ctx.permissions.some((p) => p.startsWith('COMMUNICATION.'))) notFound();
  const params = listParams.parse(await searchParams);
  const { rows, total, error } = await listManaged(supabase, params);
  const pages = Math.max(1, Math.ceil(total / COMM_PAGE_SIZE));
  const sel = 'h-9 rounded-md border border-border bg-card px-3 text-sm';
  const canCreate = ctx.permissions.includes('COMMUNICATION.ALL.CREATE');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Manage announcements</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} announcement{total === 1 ? '' : 's'} you can manage. <Link href="/announcements" className="text-primary underline-offset-4 hover:underline">Back to announcements</Link></p>
        </div>
        {canCreate && <Link href="/announcements/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground hover:opacity-90">New announcement</Link>}
      </div>
      <form method="get" action="/announcements/manage" className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={params.q ?? ''} aria-label="Search" placeholder="Title" maxLength={100} className="h-9 w-64 rounded-md border border-border bg-card px-3 text-sm" />
        <select name="status" defaultValue={params.status ?? ''} aria-label="Status" className={sel}><option value="">Any status</option>{STATUSES.map((s) => (<option key={s} value={s}>{statusLabel(s)}</option>))}</select>
        <Button type="submit">Search</Button>
      </form>
      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load announcements.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr>
            <th scope="col" className="px-4 py-2 font-medium">Title</th><th scope="col" className="px-4 py-2 font-medium">Type</th><th scope="col" className="px-4 py-2 font-medium">Department</th>
            <th scope="col" className="px-4 py-2 font-medium">Audience</th><th scope="col" className="px-4 py-2 font-medium">Status</th><th scope="col" className="px-4 py-2 font-medium">Shown from</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{params.q || params.status ? 'No announcements match the search.' : 'No announcements yet.'}</td></tr>
            ) : rows.map((a) => (
              <tr key={a.announcement_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2"><Link href={`/announcements/${a.announcement_id}`} className="text-primary underline-offset-4 hover:underline">{a.title}</Link>{a.is_mine ? <span className="text-xs text-muted-foreground"> (yours)</span> : null}</td>
                <td className="px-4 py-2">{a.type_name}</td><td className="px-4 py-2">{a.department_name ?? 'Institution'}</td><td className="px-4 py-2">{audienceLabel[a.audience_type] ?? a.audience_type}</td>
                <td className="px-4 py-2">{statusLabel(a.approval_status)}</td><td className="px-4 py-2 whitespace-nowrap">{new Date(a.publish_from).toLocaleDateString()}</td>
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
