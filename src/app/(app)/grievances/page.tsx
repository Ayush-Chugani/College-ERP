import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMyGrievances, GRV_PAGE_SIZE, listCategories, listDepartments, listGrievances } from '@/features/grievance-data';
import { CategoryManager, SubmitForm } from '@/features/grievance-forms';
import { can } from '@/lib/context';
import { label, listParams, PRIORITIES, STATUSES, type ListParams } from '@/lib/grievance-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Grievances' };

function href(p: ListParams, patch: Partial<ListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.status) sp.set('status', n.status);
  if (n.priority) sp.set('priority', n.priority);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/grievances?${sp.toString()}`;
}

export default async function GrievancesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  const isStudent = ctx.student_id !== null;
  const staff = ctx.readable_modules.includes('GRIEVANCE');
  if (!isStudent && !staff) notFound();
  const params = listParams.parse(await searchParams);
  const [mine, staffList, categories, departments] = await Promise.all([
    isStudent ? getMyGrievances(supabase) : Promise.resolve([]),
    staff ? listGrievances(supabase, params) : Promise.resolve({ rows: [], total: 0, error: null as string | null }),
    listCategories(supabase, !staff || isStudent),
    isStudent ? listDepartments(supabase) : Promise.resolve([]),
  ]);
  const pages = Math.max(1, Math.ceil(staffList.total / GRV_PAGE_SIZE));
  const sel = 'h-9 rounded-md border border-border bg-card px-3 text-sm';

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Grievances</h1>
        <p className="text-sm text-muted-foreground">{isStudent ? 'Raise a problem and follow how it is handled.' : 'Grievances you can see and handle.'}</p>
      </div>

      {isStudent && (
        <>
          <Card>
            <CardHeader><CardTitle>My grievances</CardTitle></CardHeader>
            <CardContent>
              {mine.length === 0 ? <p className="text-sm text-muted-foreground">You have not submitted any grievance.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {mine.map((g) => (
                    <li key={g.grievance_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span><Link href={`/grievances/${g.grievance_id}`} className="font-medium text-primary underline-offset-4 hover:underline">{g.subject}</Link> <span className="text-muted-foreground">· {g.grievance_number} · {g.category_name} · {new Date(g.submitted_at).toLocaleDateString()}</span></span>
                      <span className="font-medium">{label(g.status)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Submit a grievance</CardTitle></CardHeader>
            <CardContent><SubmitForm categories={categories.map((c) => ({ id: c.grievance_category_id, label: c.category_name }))} departments={departments} /></CardContent>
          </Card>
        </>
      )}

      {staff && (
        <>
          <form method="get" action="/grievances" className="flex flex-wrap gap-2" role="search">
            <input name="q" defaultValue={params.q ?? ''} aria-label="Search" placeholder="Number, subject, student" maxLength={100} className="h-9 w-72 rounded-md border border-border bg-card px-3 text-sm" />
            <select name="status" defaultValue={params.status ?? ''} aria-label="Status" className={sel}><option value="">Any status</option>{STATUSES.map((s) => (<option key={s} value={s}>{label(s)}</option>))}</select>
            <select name="priority" defaultValue={params.priority ?? ''} aria-label="Priority" className={sel}><option value="">Any priority</option>{PRIORITIES.map((s) => (<option key={s} value={s}>{label(s)}</option>))}</select>
            <Button type="submit">Search</Button>
          </form>
          {staffList.error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load grievances.</p>}
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted text-left"><tr>
                <th scope="col" className="px-4 py-2 font-medium">Grievance</th><th scope="col" className="px-4 py-2 font-medium">Student</th><th scope="col" className="px-4 py-2 font-medium">Category</th>
                <th scope="col" className="px-4 py-2 font-medium">Priority</th><th scope="col" className="px-4 py-2 font-medium">Status</th><th scope="col" className="px-4 py-2 font-medium">Submitted</th>
              </tr></thead>
              <tbody>
                {staffList.rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{params.q || params.status || params.priority ? 'No grievances match the search.' : 'No grievances yet.'}</td></tr>
                ) : staffList.rows.map((g) => (
                  <tr key={g.grievance_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2"><Link href={`/grievances/${g.grievance_id}`} className="text-primary underline-offset-4 hover:underline">{g.subject}</Link><div className="text-xs text-muted-foreground">{g.grievance_number}</div></td>
                    <td className="px-4 py-2">{g.student_name}<div className="text-xs text-muted-foreground">{g.student_number}</div></td>
                    <td className="px-4 py-2">{g.category_name}</td><td className="px-4 py-2">{label(g.priority)}</td><td className="px-4 py-2">{label(g.status)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{new Date(g.submitted_at).toLocaleDateString()}</td>
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
          <Card>
            <CardHeader><CardTitle>Categories</CardTitle></CardHeader>
            <CardContent><CategoryManager categories={categories} canManage={can(ctx, 'GRIEVANCE.ALL.CONFIGURE')} /></CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
