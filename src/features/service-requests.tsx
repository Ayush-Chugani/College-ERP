'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { label } from '@/lib/document-validation';
import { createClient } from '@/lib/supabase/client';

export type ServiceRow = {
  service_request_id: number; request_number: string; request_kind: string; student_id: number; student_number: string; student_name: string; term_name: string | null; planned_date: string | null; detail: string | null;
  request_status: string; decision_remarks: string | null; reference_number: string | null; created_at: string; can_decide: boolean; can_cancel: boolean; hold_blocked: boolean;
};
const KINDS: Record<string, string> = { HALL_TICKET: 'Hall ticket', HOSTEL_CHECKOUT: 'Hostel check-out', GRADUATION: 'Graduation' };
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const msg = (e: { code?: string; message: string }, fb: string) => (['22023', '42501', '45000'].includes(e.code ?? '') ? e.message : fb);

export function ServiceRequestForm({ terms, studentId }: { terms: { id: number; label: string }[]; studentId: number | null }) {
  const router = useRouter();
  const [f, setF] = useState({ kind: 'HALL_TICKET', term: '', date: '', detail: '', student: '' });
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { error } = await createClient().rpc('svc_request_create', { p_kind: f.kind, p_term_id: f.kind === 'HALL_TICKET' && f.term ? Number(f.term) : null, p_planned_date: f.kind === 'HOSTEL_CHECKOUT' && f.date ? f.date : null, p_detail: f.detail || null, p_student_id: studentId ?? (f.student ? Number(f.student) : null) });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'The request could not be sent.'));
    toast.success('Request sent.');
    setF({ ...f, detail: '' });
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-48"><label htmlFor="sr-k" className="text-sm font-medium">Request *</label><select id="sr-k" className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      {studentId === null && <div className="w-32"><label htmlFor="sr-s" className="text-sm font-medium">Student id *</label><input id="sr-s" inputMode="numeric" className={sel} value={f.student} onChange={(e) => setF({ ...f, student: e.target.value })} /></div>}
      {f.kind === 'HALL_TICKET' && <div className="w-56"><label htmlFor="sr-t" className="text-sm font-medium">Term *</label><select id="sr-t" className={sel} value={f.term} onChange={(e) => setF({ ...f, term: e.target.value })}><option value="">Select…</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>}
      {f.kind === 'HOSTEL_CHECKOUT' && <div className="w-44"><label htmlFor="sr-d" className="text-sm font-medium">Check-out date *</label><input id="sr-d" type="date" className={sel} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>}
      <div className="w-72 max-w-full"><label htmlFor="sr-n" className="text-sm font-medium">Note</label><input id="sr-n" maxLength={500} className={sel} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></div>
      <Button type="button" disabled={busy} onClick={go}>Send request</Button>
    </div>
  );
}

export function ServiceRequestList({ rows }: { rows: ServiceRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rej, setRej] = useState<{ id: number; text: string } | null>(null);
  const supabase = createClient();
  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { toast.error(msg(error, 'The change could not be saved.')); return false; }
    toast.success(ok);
    router.refresh();
    return true;
  }
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No requests.</p>;
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((r) => (
        <li key={r.service_request_id} className="space-y-2 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><span className="font-medium">{r.request_number}</span> · {KINDS[r.request_kind]} · {r.student_name} ({r.student_number}) · <span className="font-medium">{label(r.request_status)}</span>
              <span className="text-muted-foreground">{r.term_name ? ` · ${r.term_name}` : ''}{r.planned_date ? ` · on ${r.planned_date}` : ''}{r.reference_number ? ` · no. ${r.reference_number}` : ''}{r.decision_remarks ? ` · ${r.decision_remarks}` : ''}{r.hold_blocked && ['SUBMITTED', 'APPROVED'].includes(r.request_status) ? ' · blocked by a fee hold' : ''}</span></span>
            <span className="flex flex-wrap gap-2">
              {r.can_decide && r.request_status === 'SUBMITTED' && <><Button type="button" variant="outline" disabled={busy} onClick={() => run('svc_request_decide', { p_id: r.service_request_id, p_action: 'APPROVE', p_remarks: null }, 'Approved.')}>Approve</Button><Button type="button" variant="outline" onClick={() => setRej({ id: r.service_request_id, text: '' })}>Reject…</Button></>}
              {r.can_decide && r.request_status === 'APPROVED' && <Button type="button" disabled={busy} onClick={() => run('svc_request_decide', { p_id: r.service_request_id, p_action: 'COMPLETE', p_remarks: null }, 'Completed.')}>{r.request_kind === 'HALL_TICKET' ? 'Issue hall ticket' : 'Complete'}</Button>}
              {r.can_cancel && <Button type="button" variant="outline" disabled={busy} onClick={() => run('svc_request_cancel', { p_id: r.service_request_id }, 'Cancelled.')}>Cancel</Button>}
            </span>
          </div>
          {rej?.id === r.service_request_id && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted p-2">
              <div className="w-80 max-w-full"><label htmlFor="sr-rj" className="text-sm font-medium">Reason *</label><input id="sr-rj" maxLength={500} className={sel} value={rej.text} onChange={(e) => setRej({ ...rej, text: e.target.value })} /></div>
              <Button type="button" disabled={busy || !rej.text.trim()} onClick={async () => { if (await run('svc_request_decide', { p_id: r.service_request_id, p_action: 'REJECT', p_remarks: rej.text }, 'Rejected.')) setRej(null); }}>Reject</Button>
              <Button type="button" variant="outline" onClick={() => setRej(null)}>Cancel</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
