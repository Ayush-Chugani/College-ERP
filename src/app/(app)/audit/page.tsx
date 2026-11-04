import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AUDIT_PAGE_SIZE, auditModules, listAudit } from '@/features/iam-data';
import { can } from '@/lib/context';
import { auditParams, type AuditParams } from '@/lib/iam-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Audit log' };

function href(p: AuditParams, patch: Partial<AuditParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  for (const k of ['module', 'action', 'q', 'from', 'to'] as const) if (n[k]) sp.set(k, n[k]);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/audit?${sp.toString()}`;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'AUDIT.ALL.READ')) notFound();
  const params = auditParams.parse(await searchParams);
  const [{ rows, total, error }, modules] = await Promise.all([listAudit(supabase, params), auditModules(supabase)]);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const field = 'h-9 rounded-md border border-border bg-card px-3 text-sm';
  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">Audit log</h1><p className="text-sm text-muted-foreground">Recorded changes, newest first. Reads are not logged.</p></div><Link href="/audit/logins" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Sign-in log</Link></div>
      <form method="get" action="/audit" className="flex flex-wrap items-end gap-2" role="search">
        <select name="module" defaultValue={params.module ?? ''} aria-label="Module" className={field}><option value="">Any module</option>{modules.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        <select name="action" defaultValue={params.action ?? ''} aria-label="Action" className={field}><option value="">Any action</option>{['INSERT', 'UPDATE', 'DELETE', 'ACCOUNT_STATUS'].map((a) => <option key={a} value={a}>{a}</option>)}</select>
        <input name="q" defaultValue={params.q ?? ''} aria-label="Search" placeholder="Table, record id, user" maxLength={100} className={`${field} w-56`} />
        <label className="text-xs">From <input type="date" name="from" defaultValue={params.from ?? ''} className={field} /></label>
        <label className="text-xs">To <input type="date" name="to" defaultValue={params.to ?? ''} className={field} /></label>
        <Button type="submit">Filter</Button>
      </form>
      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load the audit log.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left"><tr>
            <th scope="col" className="px-4 py-2 font-medium">When</th><th scope="col" className="px-4 py-2 font-medium">User</th><th scope="col" className="px-4 py-2 font-medium">Module</th><th scope="col" className="px-4 py-2 font-medium">Action</th><th scope="col" className="px-4 py-2 font-medium">Record</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No entries match.</td></tr> : rows.map((r) => (
              <tr key={r.activity_audit_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 whitespace-nowrap"><Link href={`/audit/${r.activity_audit_id}`} className="text-primary underline-offset-4 hover:underline">{new Date(r.activity_at).toLocaleString()}</Link></td>
                <td className="px-4 py-2">{r.username ?? 'system'}</td><td className="px-4 py-2">{r.module_code}</td><td className="px-4 py-2">{r.action_code}</td>
                <td className="px-4 py-2">{r.entity_name ?? '—'}{r.entity_id ? ` #${r.entity_id}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
        <span>Page {Math.min(params.page, pages)} of {pages} · {total} entries</span>
        <div className="flex gap-2">
          {params.page > 1 && <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={href(params, { page: params.page - 1 })}>Previous</Link>}
          {params.page < pages && <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={href(params, { page: params.page + 1 })}>Next</Link>}
        </div>
      </nav>
    </div>
  );
}
