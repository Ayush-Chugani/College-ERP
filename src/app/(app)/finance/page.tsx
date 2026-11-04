import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FIN_PAGE_SIZE, listAccounts } from '@/features/finance-data';
import { OpenAccountForm } from '@/features/finance-forms';
import { can } from '@/lib/context';
import { accountListParams, ACCOUNT_STATUSES, money, type AccountListParams } from '@/lib/finance-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Fees' };

function href(p: AccountListParams, patch: Partial<AccountListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.status) sp.set('status', n.status);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/finance?${sp.toString()}`;
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('FEES')) notFound();
  const params = accountListParams.parse(await searchParams);
  const { rows, total, error } = await listAccounts(supabase, params);
  const pages = Math.max(1, Math.ceil(total / FIN_PAGE_SIZE));
  const sel = 'h-9 rounded-md border border-border bg-card px-3 text-sm';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Fees</h1>
        <p className="text-sm text-muted-foreground">{total.toLocaleString()} student account{total === 1 ? '' : 's'} you can see. Amounts are in rupees.</p>
      </div>
      <form method="get" action="/finance" className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={params.q ?? ''} aria-label="Search accounts" placeholder="Student number, name or account number" maxLength={100} className="h-9 w-72 rounded-md border border-border bg-card px-3 text-sm" />
        <select name="status" defaultValue={params.status ?? ''} aria-label="Account status" className={sel}><option value="">Any status</option>{ACCOUNT_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}</select>
        <Button type="submit">Search</Button>
      </form>
      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load accounts.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr>
            <th scope="col" className="px-4 py-2 font-medium">Student</th><th scope="col" className="px-4 py-2 font-medium">Account</th><th scope="col" className="px-4 py-2 font-medium">Status</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Payable</th><th scope="col" className="px-4 py-2 text-right font-medium">Paid</th><th scope="col" className="px-4 py-2 text-right font-medium">Balance</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{params.q || params.status ? 'No accounts match the search.' : 'No student accounts yet.'}</td></tr>
            ) : rows.map((r) => (
              <tr key={r.student_account_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2"><Link href={`/finance/account/${r.student_account_id}`} className="text-primary underline-offset-4 hover:underline">{r.display_name}</Link><div className="text-xs text-muted-foreground">{r.student_number}</div></td>
                <td className="px-4 py-2">{r.account_number}</td><td className="px-4 py-2">{r.account_status}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(r.total_payable)}</td><td className="px-4 py-2 text-right tabular-nums">{money(r.total_paid)}</td><td className="px-4 py-2 text-right tabular-nums">{money(r.total_balance)}</td>
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
      {can(ctx, 'FEES.FEE_ASSESSMENT.CREATE') && <OpenAccountForm />}
    </div>
  );
}
