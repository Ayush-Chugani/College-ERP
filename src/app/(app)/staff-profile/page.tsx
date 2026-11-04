import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getStaffReport, listStaffActivities, STAFF_PAGE_SIZE } from '@/features/staff-data';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';
import { ACTIVITY_GROUPS, APPROVAL_STATUSES, label, listParams, type ListParams } from '@/lib/staff-validation';

export const metadata: Metadata = { title: 'Staff profile and research' };

function href(p: ListParams, patch: Partial<ListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.status) sp.set('status', n.status);
  if (n.group) sp.set('group', n.group);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/staff-profile?${sp.toString()}`;
}

export default async function StaffProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  const isEmployee = ctx.employee_id !== null;
  if (!isEmployee && !ctx.readable_modules.includes('STAFF_PROFILE')) notFound();
  const params = listParams.parse(await searchParams);
  const [{ rows, total, error }, report] = await Promise.all([listStaffActivities(supabase, params), can(ctx, 'STAFF_PROFILE.STAFF_REPORT.READ') ? getStaffReport(supabase) : Promise.resolve([])]);
  const pages = Math.max(1, Math.ceil(total / STAFF_PAGE_SIZE));
  const field = 'h-9 rounded-md border border-border bg-card px-3 text-sm';
  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Staff profile and research</h1><p className="text-sm text-muted-foreground">Publications, conferences, projects, training, awards, memberships and other academic and professional records, with their evidence.</p></div>
        {isEmployee && <Link href="/staff-profile/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground hover:opacity-90">New record</Link>}
      </div>
      <form method="get" action="/staff-profile" className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={params.q ?? ''} aria-label="Search" placeholder="Title, name, number" maxLength={100} className={`${field} w-64`} />
        <select name="group" defaultValue={params.group ?? ''} aria-label="Kind" className={field}><option value="">Any kind</option>{ACTIVITY_GROUPS.map((g) => <option key={g} value={g}>{label(g)}</option>)}</select>
        <select name="status" defaultValue={params.status ?? ''} aria-label="Status" className={field}><option value="">Any status</option>{APPROVAL_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <Button type="submit">Search</Button>
      </form>
      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load the records.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr>
            <th scope="col" className="px-4 py-2 font-medium">Record</th><th scope="col" className="px-4 py-2 font-medium">Staff</th><th scope="col" className="px-4 py-2 font-medium">Verification</th><th scope="col" className="px-4 py-2 font-medium">Approval</th><th scope="col" className="px-4 py-2 font-medium">Evidence</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">{params.q || params.status || params.group ? 'No records match the search.' : 'No records yet.'}</td></tr> : rows.map((r) => (
              <tr key={r.staff_activity_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2"><Link href={`/staff-profile/${r.staff_activity_id}`} className="text-primary underline-offset-4 hover:underline">{r.activity_title}</Link><div className="text-xs text-muted-foreground">{r.type_name}{r.start_date ? ` · ${r.start_date}` : ''}</div></td>
                <td className="px-4 py-2">{r.staff_name}<div className="text-xs text-muted-foreground">{r.employee_number}</div></td>
                <td className="px-4 py-2">{label(r.verification_status)}</td><td className="px-4 py-2">{label(r.approval_status)}</td><td className="px-4 py-2">{Number(r.evidence_count)}</td>
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
      {report.length > 0 && (
        <Card className="overflow-x-auto">
          <CardHeader><CardTitle>Summary by kind</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left"><tr><th scope="col" className="py-2 pr-4 font-medium">Kind</th><th scope="col" className="py-2 pr-4 font-medium">Status</th><th scope="col" className="py-2 pr-4 font-medium">Records</th><th scope="col" className="py-2 font-medium">Staff</th></tr></thead>
              <tbody>{report.map((r) => <tr key={`${r.activity_group}-${r.approval_status}`} className="border-b border-border last:border-0"><td className="py-2 pr-4">{label(r.activity_group)}</td><td className="py-2 pr-4">{label(r.approval_status)}</td><td className="py-2 pr-4">{r.records}</td><td className="py-2">{r.employees}</td></tr>)}</tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
