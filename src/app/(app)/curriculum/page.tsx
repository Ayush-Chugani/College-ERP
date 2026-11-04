import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { listProgrammes, listSchemes, SCHEME_PAGE_SIZE } from '@/features/academic-data';
import { SCHEME_STATUSES, schemeListParams, type SchemeListParams } from '@/lib/academic-validation';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Curriculum schemes' };

function href(p: SchemeListParams, patch: Partial<SchemeListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.programme) sp.set('programme', String(n.programme));
  if (n.status) sp.set('status', n.status);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/curriculum?${sp.toString()}`;
}

export default async function CurriculumPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('CURRICULUM')) notFound();
  const params = schemeListParams.parse(await searchParams);
  const [{ rows, total, error }, programmes] = await Promise.all([listSchemes(supabase, params), listProgrammes(supabase)]);
  const pages = Math.max(1, Math.ceil(total / SCHEME_PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Curriculum schemes</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} scheme{total === 1 ? '' : 's'} you are allowed to view
          </p>
        </div>
        {can(ctx, 'CURRICULUM.ALL.CREATE') && (
          <Link href="/curriculum/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            New scheme
          </Link>
        )}
      </div>

      <form method="get" action="/curriculum" className="flex flex-wrap gap-2" role="search">
        <Input name="q" defaultValue={params.q} placeholder="Search code or name" aria-label="Search schemes" className="w-56" />
        <select name="programme" defaultValue={params.programme ?? ''} aria-label="Programme" className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          <option value="">All programmes</option>
          {programmes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={params.status ?? ''} aria-label="Status" className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          <option value="">Any status</option>
          {SCHEME_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button type="submit">Filter</Button>
      </form>

      {error && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">
          Could not load schemes.
        </p>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Code</th>
              <th scope="col" className="px-4 py-2 font-medium">Name</th>
              <th scope="col" className="px-4 py-2 font-medium">Programme</th>
              <th scope="col" className="px-4 py-2 font-medium">Regulation</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {params.q || params.programme || params.status ? 'No schemes match the filters.' : 'No curriculum schemes yet.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.curriculum_scheme_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/curriculum/${r.curriculum_scheme_id}`} className="text-primary underline-offset-4 hover:underline">
                      {r.scheme_code}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.scheme_name}</td>
                  <td className="px-4 py-2">{r.programme_name ?? `#${r.programme_id}`}</td>
                  <td className="px-4 py-2">{r.regulation_year}</td>
                  <td className="px-4 py-2">{r.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
        <span>
          Page {Math.min(params.page, pages)} of {pages}
        </span>
        <div className="flex gap-2">
          {params.page > 1 && (
            <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={href(params, { page: params.page - 1 })}>
              Previous
            </Link>
          )}
          {params.page < pages && (
            <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={href(params, { page: params.page + 1 })}>
              Next
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}
