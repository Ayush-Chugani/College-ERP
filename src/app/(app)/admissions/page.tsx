import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ADMISSION_PAGE_SIZE, listApplications, loadAdmissionLookups } from '@/features/admission-data';
import { APPLICATION_STATUSES, applicationListParams, type ApplicationListParams } from '@/lib/admission-validation';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Admissions' };

function href(p: ApplicationListParams, patch: Partial<ApplicationListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.status) sp.set('status', n.status);
  if (n.programme) sp.set('programme', String(n.programme));
  if (n.year) sp.set('year', String(n.year));
  if (n.page > 1) sp.set('page', String(n.page));
  return `/admissions?${sp.toString()}`;
}

export default async function AdmissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('ADMISSION')) notFound();
  const params = applicationListParams.parse(await searchParams);
  const [{ rows, total, error }, lookups] = await Promise.all([listApplications(supabase, params), loadAdmissionLookups(supabase)]);
  const pages = Math.max(1, Math.ceil(total / ADMISSION_PAGE_SIZE));
  const sel = 'h-9 rounded-md border border-border bg-card px-3 text-sm';
  const filtered = !!(params.q || params.status || params.programme || params.year);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Admissions</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} application{total === 1 ? '' : 's'} in programmes you can see ·{' '}
            <Link href="/admissions/categories" className="text-primary underline-offset-4 hover:underline">Admission categories</Link>
          </p>
        </div>
        {can(ctx, 'ADMISSION.ALL.CREATE') && (
          <Link href="/admissions/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            New application
          </Link>
        )}
      </div>

      <form method="get" action="/admissions" className="flex flex-wrap gap-2" role="search">
        <Input name="q" defaultValue={params.q} placeholder="Search number or applicant" aria-label="Search applications" className="w-56" />
        <select name="status" defaultValue={params.status ?? ''} aria-label="Status" className={sel}>
          <option value="">Any status</option>
          {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="programme" defaultValue={params.programme ?? ''} aria-label="Programme" className={sel}>
          <option value="">All programmes</option>
          {lookups.programmes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select name="year" defaultValue={params.year ?? ''} aria-label="Academic year" className={sel}>
          <option value="">All years</option>
          {lookups.years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
        </select>
        <Button type="submit">Filter</Button>
      </form>

      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load applications.</p>}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Number</th>
              <th scope="col" className="px-4 py-2 font-medium">Applicant</th>
              <th scope="col" className="px-4 py-2 font-medium">Programme</th>
              <th scope="col" className="px-4 py-2 font-medium">Date</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">{filtered ? 'No applications match the filters.' : 'No applications yet.'}</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.application_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2"><Link href={`/admissions/${r.application_id}`} className="text-primary underline-offset-4 hover:underline">{r.application_number}</Link></td>
                  <td className="px-4 py-2">{r.applicant_name ?? '—'}</td>
                  <td className="px-4 py-2">{r.programme_name ?? `#${r.programme_id}`}</td>
                  <td className="px-4 py-2">{r.application_date}</td>
                  <td className="px-4 py-2">{r.application_status}</td>
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
