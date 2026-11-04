import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ASM_PAGE_SIZE, listAssessmentOfferings } from '@/features/assessment-data';
import { loadRegLookups } from '@/features/registration-data';
import { offeringListParams, type AssessmentListParams } from '@/lib/assessment-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Assessment' };

function href(p: AssessmentListParams, patch: Partial<AssessmentListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.term) sp.set('term', String(n.term));
  if (n.programme) sp.set('programme', String(n.programme));
  if (n.page > 1) sp.set('page', String(n.page));
  return `/assessment?${sp.toString()}`;
}

export default async function AssessmentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('ASSESSMENT') && !ctx.readable_modules.includes('RESULT')) notFound();
  const params = offeringListParams.parse(await searchParams);
  const [{ rows, total, error }, lookups] = await Promise.all([listAssessmentOfferings(supabase, params), loadRegLookups(supabase)]);
  const pages = Math.max(1, Math.ceil(total / ASM_PAGE_SIZE));
  const sel = 'h-9 rounded-md border border-border bg-card px-3 text-sm';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Assessment &amp; results</h1>
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString()} course offering{total === 1 ? '' : 's'} you can see · <Link href="/results/grades" className="text-primary underline-offset-4 hover:underline">Grade scales</Link>
        </p>
      </div>
      <form method="get" action="/assessment" className="flex flex-wrap gap-2" role="search">
        <select name="term" defaultValue={params.term ?? ''} aria-label="Term" className={sel}><option value="">All terms</option>{lookups.terms.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}</select>
        <select name="programme" defaultValue={params.programme ?? ''} aria-label="Programme" className={sel}><option value="">All programmes</option>{lookups.programmes.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}</select>
        <Button type="submit">Filter</Button>
      </form>
      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load course offerings.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr>
            <th scope="col" className="px-4 py-2 font-medium">Course</th><th scope="col" className="px-4 py-2 font-medium">Offering</th><th scope="col" className="px-4 py-2 font-medium">Term</th>
            <th scope="col" className="px-4 py-2 font-medium">Programme</th><th scope="col" className="px-4 py-2 font-medium">Semester</th><th scope="col" className="px-4 py-2 font-medium">Term results</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{params.term || params.programme ? 'No course offerings match the filters.' : 'No course offerings yet.'}</td></tr>
            ) : rows.map((r) => (
              <tr key={r.course_offering_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2"><Link href={`/assessment/offering/${r.course_offering_id}`} className="text-primary underline-offset-4 hover:underline">{r.course_code} — {r.course_title}</Link></td>
                <td className="px-4 py-2">{r.offering_code}</td><td className="px-4 py-2">{r.term_name}</td><td className="px-4 py-2">{r.programme_name}</td><td className="px-4 py-2">{r.semester_name}</td>
                <td className="px-4 py-2"><Link href={`/results/term/${r.programme_term_offering_id}`} className="text-primary underline-offset-4 hover:underline">Open</Link></td>
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
