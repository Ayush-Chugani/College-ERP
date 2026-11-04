import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ServiceRequestForm, ServiceRequestList, type ServiceRow } from '@/features/service-requests';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Hall tickets, check-out and graduation' };
const KINDS = ['HALL_TICKET', 'HOSTEL_CHECKOUT', 'GRADUATION'];
const STATUSES = ['SUBMITTED', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED'];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  const isStudent = ctx.student_id !== null;
  if (!isStudent && !ctx.readable_modules.includes('DOCUMENT')) notFound();
  const sp = await searchParams;
  const kind = sp.kind && KINDS.includes(sp.kind) ? sp.kind : null;
  const status = sp.status && STATUSES.includes(sp.status) ? sp.status : null;
  const [list, terms] = await Promise.all([supabase.rpc('svc_request_list', { p_kind: kind, p_status: status }), isStudent ? supabase.rpc('svc_my_terms') : Promise.resolve({ data: [] })]);
  const rows = (list.data ?? []) as ServiceRow[];
  const termOpts = ((terms.data ?? []) as { academic_term_id: number; term_name: string }[]).map((t) => ({ id: t.academic_term_id, label: t.term_name }));
  const field = 'h-9 rounded-md border border-border bg-card px-3 text-sm';
  return (
    <div className="max-w-5xl space-y-4">
      <div><h1 className="text-xl font-semibold">Hall tickets, hostel check-out and graduation</h1><p className="text-sm text-muted-foreground">A fee hold of the matching kind blocks these until it is released by the fee office.</p></div>
      <form method="get" action="/requests" className="flex gap-2" role="search">
        <select name="kind" defaultValue={kind ?? ''} aria-label="Kind" className={field}><option value="">Any kind</option>{KINDS.map((k) => <option key={k} value={k}>{k.charAt(0) + k.slice(1).toLowerCase().replace('_', ' ')}</option>)}</select>
        <select name="status" defaultValue={status ?? ''} aria-label="Status" className={field}><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select>
        <button type="submit" className={`${field} hover:bg-muted`}>Filter</button>
      </form>
      {(isStudent || can(ctx, 'DOCUMENT.ALL.CREATE')) && <Card><CardHeader><CardTitle>New request</CardTitle></CardHeader><CardContent><ServiceRequestForm terms={termOpts} studentId={ctx.student_id} /></CardContent></Card>}
      <Card><CardHeader><CardTitle>Requests</CardTitle></CardHeader><CardContent><ServiceRequestList rows={rows} /></CardContent></Card>
    </div>
  );
}
