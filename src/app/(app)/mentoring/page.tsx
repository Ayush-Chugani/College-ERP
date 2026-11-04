import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { listAssignments, MENTOR_PAGE_SIZE } from '@/features/mentoring-data';
import { AssignForm } from '@/features/mentoring-forms';
import { can } from '@/lib/context';
import { assignmentListParams, ASSIGNMENT_STATUSES, type AssignmentListParams } from '@/lib/mentoring-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Mentoring' };

function href(p: AssignmentListParams, patch: Partial<AssignmentListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.status) sp.set('status', n.status);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/mentoring?${sp.toString()}`;
}

export default async function MentoringPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('MENTORING')) notFound();
  const params = assignmentListParams.parse(await searchParams);
  const { rows, total, error } = await listAssignments(supabase, params);
  const pages = Math.max(1, Math.ceil(total / MENTOR_PAGE_SIZE));
  const sel = 'h-9 rounded-md border border-border bg-card px-3 text-sm';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Mentoring</h1>
        <p className="text-sm text-muted-foreground">{total.toLocaleString()} mentor assignment{total === 1 ? '' : 's'} you can see. Session notes are confidential and shown only as their level allows.</p>
      </div>
      <form method="get" action="/mentoring" className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={params.q ?? ''} aria-label="Search" placeholder="Student number, student or mentor name" maxLength={100} className="h-9 w-72 rounded-md border border-border bg-card px-3 text-sm" />
        <select name="status" defaultValue={params.status ?? ''} aria-label="Status" className={sel}><option value="">Any status</option>{ASSIGNMENT_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}</select>
        <Button type="submit">Search</Button>
      </form>
      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load assignments.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr>
            <th scope="col" className="px-4 py-2 font-medium">Student</th><th scope="col" className="px-4 py-2 font-medium">Mentor</th><th scope="col" className="px-4 py-2 font-medium">Period</th>
            <th scope="col" className="px-4 py-2 font-medium">Status</th><th scope="col" className="px-4 py-2 text-right font-medium">Sessions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">{params.q || params.status ? 'No assignments match the search.' : 'No mentor assignments yet.'}</td></tr>
            ) : rows.map((r) => (
              <tr key={r.mentor_assignment_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2"><Link href={`/mentoring/${r.mentor_assignment_id}`} className="text-primary underline-offset-4 hover:underline">{r.student_name}</Link><div className="text-xs text-muted-foreground">{r.student_number}</div></td>
                <td className="px-4 py-2">{r.mentor_name}{r.is_mine ? ' (you)' : ''}</td>
                <td className="px-4 py-2 whitespace-nowrap">{r.start_date}{r.end_date ? ` → ${r.end_date}` : ' →'}</td>
                <td className="px-4 py-2">{r.assignment_status}</td><td className="px-4 py-2 text-right tabular-nums">{r.session_count}</td>
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
      {can(ctx, 'MENTORING.ALL.ASSIGN') && <AssignForm />}
    </div>
  );
}
