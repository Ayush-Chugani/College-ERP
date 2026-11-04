import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { loginAuditParams, type LoginAuditParams } from '@/lib/account-validation';
import { can } from '@/lib/context';
import { endOfDay } from '@/lib/iam-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Sign-in log' };
const PAGE = 25;

type Row = { login_audit_id: number; login_at: string; logout_at: string | null; username_attempted: string; username: string | null; was_successful: boolean; failure_reason: string | null; ip_address: string | null; total_count: number };

function href(p: LoginAuditParams, patch: Partial<LoginAuditParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  for (const k of ['q', 'result', 'from', 'to'] as const) if (n[k]) sp.set(k, n[k]);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/audit/logins?${sp.toString()}`;
}

export default async function LoginLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'AUDIT.ALL.READ')) notFound();
  const p = loginAuditParams.parse(await searchParams);
  const { data, error } = await supabase.rpc('login_audit_list', {
    p_search: p.q ?? null, p_success: p.result === undefined ? null : p.result === 'ok', p_from: p.from ? `${p.from}T00:00:00Z` : null, p_to: p.to ? endOfDay(p.to) : null, p_limit: PAGE, p_offset: (p.page - 1) * PAGE,
  });
  const rows = (data ?? []) as Row[];
  const total = rows[0] ? Number(rows[0].total_count) : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const field = 'h-9 rounded-md border border-border bg-card px-3 text-sm';
  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Sign-in log</h1><p className="text-sm text-muted-foreground">Successful and failed sign-ins, newest first. Failed attempts are capped per name and hour.</p></div>
        <Link href="/audit" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Audit log</Link>
      </div>
      <form method="get" action="/audit/logins" className="flex flex-wrap items-end gap-2" role="search">
        <input name="q" defaultValue={p.q ?? ''} aria-label="Search" placeholder="Email, username, address" maxLength={100} className={`${field} w-60`} />
        <select name="result" defaultValue={p.result ?? ''} aria-label="Result" className={field}><option value="">Any result</option><option value="ok">Successful</option><option value="failed">Failed</option></select>
        <label className="text-xs">From <input type="date" name="from" defaultValue={p.from ?? ''} className={field} /></label>
        <label className="text-xs">To <input type="date" name="to" defaultValue={p.to ?? ''} className={field} /></label>
        <Button type="submit">Filter</Button>
      </form>
      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load the log.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr>
            <th scope="col" className="px-4 py-2 font-medium">When</th><th scope="col" className="px-4 py-2 font-medium">Name used</th><th scope="col" className="px-4 py-2 font-medium">Result</th><th scope="col" className="px-4 py-2 font-medium">Address</th><th scope="col" className="px-4 py-2 font-medium">Signed out</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No entries match.</td></tr> : rows.map((r) => (
              <tr key={r.login_audit_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 whitespace-nowrap">{new Date(r.login_at).toLocaleString()}</td>
                <td className="px-4 py-2">{r.username_attempted}{r.username && r.username !== r.username_attempted ? <span className="text-muted-foreground"> ({r.username})</span> : null}</td>
                <td className={`px-4 py-2 ${r.was_successful ? '' : 'text-destructive'}`}>{r.was_successful ? 'Successful' : `Failed${r.failure_reason ? ` · ${r.failure_reason.toLowerCase().replace(/_/g, ' ')}` : ''}`}</td>
                <td className="px-4 py-2">{r.ip_address ?? '—'}</td><td className="px-4 py-2 whitespace-nowrap">{r.logout_at ? new Date(r.logout_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
        <span>Page {Math.min(p.page, pages)} of {pages} · {total} entries</span>
        <div className="flex gap-2">
          {p.page > 1 && <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={href(p, { page: p.page - 1 })}>Previous</Link>}
          {p.page < pages && <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={href(p, { page: p.page + 1 })}>Next</Link>}
        </div>
      </nav>
    </div>
  );
}
