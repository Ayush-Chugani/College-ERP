import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { listOfferings, loadRegLookups, REG_PAGE_SIZE } from '@/features/registration-data';
import { can } from '@/lib/context';
import { OFFERING_STATUSES, offeringListParams, type OfferingListParams } from '@/lib/registration-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Registration' };

function href(p: OfferingListParams, patch: Partial<OfferingListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.term) sp.set('term', String(n.term));
  if (n.programme) sp.set('programme', String(n.programme));
  if (n.status) sp.set('status', n.status);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/registration?${sp.toString()}`;
}

export default async function RegistrationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('REGISTRATION')) notFound();
  const params = offeringListParams.parse(await searchParams);
  const [{ rows, total, error }, lookups] = await Promise.all([listOfferings(supabase, params), loadRegLookups(supabase)]);
  const pages = Math.max(1, Math.ceil(total / REG_PAGE_SIZE));
  const sel = 'h-9 rounded-md border border-border bg-card px-3 text-sm';
  const filtered = !!(params.term || params.programme || params.status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Registration</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} programme-term offering{total === 1 ? '' : 's'} you can see</p>
        </div>
        {can(ctx, 'REGISTRATION.ALL.CREATE') && (
          <Link href="/registration/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">New offering</Link>
        )}
      </div>

      <form method="get" action="/registration" className="flex flex-wrap gap-2" role="search">
        <select name="term" defaultValue={params.term ?? ''} aria-label="Term" className={sel}>
          <option value="">All terms</option>
          {lookups.terms.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
        </select>
        <select name="programme" defaultValue={params.programme ?? ''} aria-label="Programme" className={sel}>
          <option value="">All programmes</option>
          {lookups.programmes.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
        </select>
        <select name="status" defaultValue={params.status ?? ''} aria-label="Status" className={sel}>
          <option value="">Any status</option>
          {OFFERING_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <Button type="submit">Filter</Button>
      </form>

      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load offerings.</p>}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Term</th>
              <th scope="col" className="px-4 py-2 font-medium">Programme</th>
              <th scope="col" className="px-4 py-2 font-medium">Semester</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">{filtered ? 'No offerings match the filters.' : 'No offerings yet.'}</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.programme_term_offering_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2"><Link href={`/registration/${r.programme_term_offering_id}`} className="text-primary underline-offset-4 hover:underline">{r.term_name ?? `#${r.academic_term_id}`}</Link></td>
                  <td className="px-4 py-2">{r.programme_name ?? `#${r.programme_id}`}</td>
                  <td className="px-4 py-2">{r.semester_name ?? `#${r.semester_id}`}</td>
                  <td className="px-4 py-2">{r.status}</td>
                </tr>
              ))
            )}
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
