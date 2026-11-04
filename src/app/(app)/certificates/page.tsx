import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RequestForm, RequestList, type CertRow } from '@/features/certificates';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Certificates' };

export default async function CertificatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  const isStudent = ctx.student_id !== null;
  if (!isStudent && !ctx.readable_modules.includes('DOCUMENT')) notFound();
  const sp = await searchParams;
  const status = sp.status && /^[A-Z_]{4,20}$/.test(sp.status) ? sp.status : null;
  const [list, types] = await Promise.all([
    supabase.rpc('cert_request_list', { p_student_id: null, p_status: status }),
    supabase.from('certificate_type').select('certificate_type_id, certificate_name').eq('is_active', true).order('certificate_name'),
  ]);
  const rows = (list.data ?? []) as CertRow[];
  const typeOpts = ((types.data ?? []) as { certificate_type_id: number; certificate_name: string }[]).map((t) => ({ id: t.certificate_type_id, label: t.certificate_name }));
  const canRequest = isStudent || can(ctx, 'DOCUMENT.ALL.CREATE');
  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Certificates</h1>
        <p className="text-sm text-muted-foreground">{isStudent ? 'Request a certificate and download it once the office has issued it.' : 'Requests you can see. Approve, reject and issue them here.'}</p>
      </div>
      <form method="get" action="/certificates" className="flex gap-2" role="search">
        <select name="status" defaultValue={status ?? ''} aria-label="Status" className="h-9 rounded-md border border-border bg-card px-3 text-sm"><option value="">Any status</option>{['SUBMITTED', 'APPROVED', 'ISSUED', 'REJECTED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select>
        <button type="submit" className="h-9 rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Filter</button>
      </form>
      {canRequest && <Card><CardHeader><CardTitle>New request</CardTitle></CardHeader><CardContent><RequestForm types={typeOpts} studentId={ctx.student_id} /></CardContent></Card>}
      <Card><CardHeader><CardTitle>Requests</CardTitle></CardHeader><CardContent><RequestList rows={rows} /></CardContent></Card>
    </div>
  );
}
