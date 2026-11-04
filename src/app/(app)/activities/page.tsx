import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ACT_PAGE_SIZE, getReport, listActivities } from '@/features/activity-data';
import { APPROVAL_STATUSES, label, listParams, type ListParams } from '@/lib/activity-validation';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Student activities' };

function href(p: ListParams, patch: Partial<ListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.status) sp.set('status', n.status);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/activities?${sp.toString()}`;
}

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  const isStudent = ctx.student_id !== null;
  const staff = ctx.readable_modules.includes('STUDENT');
  if (!isStudent && !staff) notFound();
  const params = listParams.parse(await searchParams);
  const [{ rows, total, error }, report] = await Promise.all([listActivities(supabase, params), can(ctx, 'STUDENT.STUDENT_ACTIVITY_REPORT.READ') ? getReport(supabase) : Promise.resolve([])]);
  const pages = Math.max(1, Math.ceil(total / ACT_PAGE_SIZE));
  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Student activities</h1><p className="text-sm text-muted-foreground">Conferences, competitions, sports, clubs and other achievements, with their evidence.</p></div>
        {isStudent && <Link href="/activities/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground hover:opacity-90">New activity</Link>}
      </div>
      <form method="get" action="/activities" className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={params.q ?? ''} aria-label="Search" placeholder="Title, student" maxLength={100} className="h-9 w-72 rounded-md border border-border bg-card px-3 text-sm" />
        <select name="status" defaultValue={params.status ?? ''} aria-label="Status" className="h-9 rounded-md border border-border bg-card px-3 text-sm"><option value="">Any status</option>{APPROVAL_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <Button type="submit">Search</Button>
      </form>
      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load activities.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr>
            <th scope="col" className="px-4 py-2 font-medium">Activity</th>{!isStudent && <th scope="col" className="px-4 py-2 font-medium">Student</th>}<th scope="col" className="px-4 py-2 font-medium">Achievement</th><th scope="col" className="px-4 py-2 font-medium">Verification</th><th scope="col" className="px-4 py-2 font-medium">Approval</th><th scope="col" className="px-4 py-2 font-medium">Evidence</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{params.q || params.status ? 'No activities match the search.' : 'No activities yet.'}</td></tr> : rows.map((r) => (
              <tr key={r.student_activity_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2"><Link href={`/activities/${r.student_activity_id}`} className="text-primary underline-offset-4 hover:underline">{r.activity_title}</Link><div className="text-xs text-muted-foreground">{r.type_name}{r.start_date ? ` · ${r.start_date}` : ''}</div></td>
                {!isStudent && <td className="px-4 py-2">{r.student_name}<div className="text-xs text-muted-foreground">{r.student_number}</div></td>}
                <td className="px-4 py-2">{label(r.achievement_type)}</td><td className="px-4 py-2">{label(r.verification_status)}</td><td className="px-4 py-2">{label(r.approval_status)}</td><td className="px-4 py-2">{Number(r.evidence_count)}</td>
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
          <CardHeader><CardTitle>Summary by type</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left"><tr><th scope="col" className="py-2 pr-4 font-medium">Type</th><th scope="col" className="py-2 pr-4 font-medium">Status</th><th scope="col" className="py-2 pr-4 font-medium">Activities</th><th scope="col" className="py-2 font-medium">With an award</th></tr></thead>
              <tbody>{report.map((r) => <tr key={`${r.type_name}-${r.approval_status}`} className="border-b border-border last:border-0"><td className="py-2 pr-4">{r.type_name}</td><td className="py-2 pr-4">{label(r.approval_status)}</td><td className="py-2 pr-4">{r.activities}</td><td className="py-2">{r.winners}</td></tr>)}</tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
