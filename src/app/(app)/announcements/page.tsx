import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ANN_PAGE_SIZE, getFeed, listManaged } from '@/features/announcement-data';
import { can } from '@/lib/context';
import { label, listParams, STATUSES, type ListParams } from '@/lib/announcement-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Announcements' };

function href(p: ListParams, patch: Partial<ListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.status) sp.set('status', n.status);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/announcements?${sp.toString()}`;
}

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  const staff = ctx.readable_modules.includes('COMMUNICATION');
  const params = listParams.parse(await searchParams);
  const [feed, managed] = await Promise.all([getFeed(supabase), staff ? listManaged(supabase, params) : Promise.resolve({ rows: [], total: 0, error: null as string | null })]);
  const pages = Math.max(1, Math.ceil(managed.total / ANN_PAGE_SIZE));
  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Announcements</h1>
          <p className="text-sm text-muted-foreground">Notices published for you.</p>
        </div>
        {can(ctx, 'COMMUNICATION.ALL.CREATE') && <Link href="/announcements/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground hover:opacity-90">New announcement</Link>}
      </div>

      <Card>
        <CardHeader><CardTitle>Current notices</CardTitle></CardHeader>
        <CardContent>
          {feed.length === 0 ? <p className="text-sm text-muted-foreground">There are no announcements for you right now.</p> : (
            <ul className="divide-y divide-border">
              {feed.map((a) => (
                <li key={a.announcement_id} className="space-y-1 py-3">
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.type_name}{a.department_name ? ` · ${a.department_name}` : ''} · {new Date(a.publish_from).toLocaleDateString()}</div>
                  <p className="whitespace-pre-wrap text-sm">{a.description}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {staff && (
        <>
          <h2 className="text-lg font-semibold">Manage</h2>
          <form method="get" action="/announcements" className="flex flex-wrap gap-2" role="search">
            <input name="q" defaultValue={params.q ?? ''} aria-label="Search" placeholder="Title" maxLength={100} className="h-9 w-72 rounded-md border border-border bg-card px-3 text-sm" />
            <select name="status" defaultValue={params.status ?? ''} aria-label="Status" className="h-9 rounded-md border border-border bg-card px-3 text-sm"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
            <Button type="submit">Search</Button>
          </form>
          {managed.error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load announcements.</p>}
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted text-left"><tr>
                <th scope="col" className="px-4 py-2 font-medium">Title</th><th scope="col" className="px-4 py-2 font-medium">Audience</th><th scope="col" className="px-4 py-2 font-medium">Status</th><th scope="col" className="px-4 py-2 font-medium">Publish from</th>
              </tr></thead>
              <tbody>
                {managed.rows.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">{params.q || params.status ? 'No announcements match the search.' : 'No announcements yet.'}</td></tr>
                ) : managed.rows.map((a) => (
                  <tr key={a.announcement_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2"><Link href={`/announcements/${a.announcement_id}`} className="text-primary underline-offset-4 hover:underline">{a.title}</Link><div className="text-xs text-muted-foreground">{a.type_name}</div></td>
                    <td className="px-4 py-2">{label(a.audience_type)}{a.department_name ? <div className="text-xs text-muted-foreground">{a.department_name}</div> : null}</td>
                    <td className="px-4 py-2">{label(a.approval_status)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{new Date(a.publish_from).toLocaleDateString()}</td>
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
        </>
      )}
    </div>
  );
}
