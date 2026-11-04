import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listStructures, loadLookups, STRUCTURE_PAGE } from '@/features/fee-structure-data';
import { StructureForm } from '@/features/fee-structures';
import { can } from '@/lib/context';
import { money } from '@/lib/finance-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Fee structures' };
const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED'];

export default async function StructuresPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('FEES') || !can(ctx, 'FEES.FEE_STRUCTURE.READ')) notFound();
  const sp = await searchParams;
  const q = sp.q?.slice(0, 60) || null;
  const status = sp.status && STATUSES.includes(sp.status) ? sp.status : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, error } = await listStructures(supabase, q, status, page);
  const lookups = can(ctx, 'FEES.FEE_STRUCTURE.CREATE') ? await loadLookups(supabase) : null;
  const pages = Math.max(1, Math.ceil(total / STRUCTURE_PAGE));
  const qs = (p: number) => `/finance/structures?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;
  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Fee structures</h1><p className="text-sm text-muted-foreground">{total} structure{total === 1 ? '' : 's'} you can see. A structure is drafted, submitted and approved by a second person.</p></div>
        <Link href="/finance" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Accounts</Link>
      </div>
      <form method="get" action="/finance/structures" className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q ?? ''} aria-label="Search" placeholder="Code or name" maxLength={60} className="h-9 w-64 rounded-md border border-border bg-card px-3 text-sm" />
        <select name="status" defaultValue={status ?? ''} aria-label="Status" className="h-9 rounded-md border border-border bg-card px-3 text-sm"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select>
        <button type="submit" className="h-9 rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Search</button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">Could not load fee structures.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr><th scope="col" className="px-3 py-2 font-medium">Code</th><th scope="col" className="px-3 py-2 font-medium">Name</th><th scope="col" className="px-3 py-2 font-medium">Scope</th><th scope="col" className="px-3 py-2 font-medium">Year</th><th scope="col" className="px-3 py-2 font-medium">Status</th><th scope="col" className="px-3 py-2 text-right font-medium">Items</th><th scope="col" className="px-3 py-2 text-right font-medium">Total</th></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No fee structures.</td></tr> : rows.map((r) => (
            <tr key={r.fee_structure_id} className="border-b border-border last:border-0">
              <td className="px-3 py-2"><Link href={`/finance/structures/${r.fee_structure_id}`} className="text-primary underline-offset-4 hover:underline">{r.structure_code}</Link></td><td className="px-3 py-2">{r.structure_name}</td>
              <td className="px-3 py-2">{r.programme_name ?? `${r.institution_name} (all programmes)`}</td><td className="px-3 py-2">{r.year_code}</td><td className="px-3 py-2">{r.approval_status.charAt(0) + r.approval_status.slice(1).toLowerCase()}</td>
              <td className="px-3 py-2 text-right">{r.item_count}</td><td className="px-3 py-2 text-right tabular-nums">{money(r.total_amount)}</td>
            </tr>))}</tbody>
        </table>
      </Card>
      <div className="flex items-center gap-3 text-sm">{page > 1 && <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={qs(page - 1)}>Previous</Link>}<span>Page {page} of {pages}</span>{page < pages && <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={qs(page + 1)}>Next</Link>}</div>
      {lookups && <Card><CardHeader><CardTitle>New fee structure</CardTitle></CardHeader><CardContent><StructureForm lookups={lookups} /></CardContent></Card>}
    </div>
  );
}
