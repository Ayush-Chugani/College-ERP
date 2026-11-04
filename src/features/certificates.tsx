'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BUCKET, label, ownerStorageKey } from '@/lib/document-validation';
import { createClient } from '@/lib/supabase/client';

export type CertRow = {
  certificate_request_id: number; request_number: string; student_id: number; student_number: string; student_name: string; certificate_name: string; purpose: string | null; request_status: string;
  requested_at: string; issued_at: string | null; certificate_number: string | null; has_file: boolean; can_approve: boolean; can_issue: boolean; can_cancel: boolean;
};
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const msg = (e: { code?: string; message: string }, fb: string) => (['22023', '23505', '42501', '45000'].includes(e.code ?? '') ? e.message : fb);

export function RequestForm({ types, studentId }: { types: { id: number; label: string }[]; studentId: number | null }) {
  const router = useRouter();
  const [f, setF] = useState({ type: '', purpose: '', student: '' });
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { error } = await createClient().rpc('cert_request_create', { p_type_id: Number(f.type), p_purpose: f.purpose, p_student_id: studentId ?? (f.student ? Number(f.student) : null) });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'The request could not be sent.'));
    toast.success('Request sent.');
    setF({ ...f, purpose: '' });
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-56"><label htmlFor="cr-t" className="text-sm font-medium">Certificate *</label><select id="cr-t" className={sel} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Select…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
      {studentId === null && <div className="w-36"><label htmlFor="cr-s" className="text-sm font-medium">Student id *</label><input id="cr-s" inputMode="numeric" className={sel} value={f.student} onChange={(e) => setF({ ...f, student: e.target.value })} /></div>}
      <div className="w-80 max-w-full"><label htmlFor="cr-p" className="text-sm font-medium">Purpose *</label><input id="cr-p" maxLength={500} className={sel} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></div>
      <Button type="button" disabled={busy || !f.type || f.purpose.trim().length < 3} onClick={go}>Send request</Button>
    </div>
  );
}

export function RequestList({ rows }: { rows: CertRow[] }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [act, setAct] = useState<{ id: number; mode: 'reject' | 'issue'; text: string; number: string } | null>(null);
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
  async function issue(r: CertRow) {
    const file = ref.current?.files?.[0];
    if (!act || !file) return void toast.error('Choose the signed PDF.');
    if (file.type !== 'application/pdf' || !/\.pdf$/i.test(file.name)) return void toast.error('The certificate must be a PDF file.');
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) return void toast.error('The file must be between 1 byte and 10 MB.');
    setBusy(true);
    const key = ownerStorageKey('student', r.student_id, file.name, crypto.randomUUID());
    const up = await supabase.storage.from(BUCKET).upload(key, file, { contentType: 'application/pdf', upsert: false });
    if (up.error) { setBusy(false); return void toast.error('The file could not be uploaded.'); }
    let checksum: string | null = null;
    try { checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join(''); } catch { /* optional */ }
    const { error } = await supabase.rpc('cert_request_issue', { p_id: r.certificate_request_id, p_certificate_number: act.number, p_storage_key: key, p_file_name: file.name, p_size: file.size, p_checksum: checksum });
    if (error) { await supabase.storage.from(BUCKET).remove([key]); setBusy(false); return void toast.error(msg(error, 'The certificate could not be issued.')); }
    setBusy(false);
    toast.success('Certificate issued.');
    setAct(null);
    router.refresh();
  }
  async function open(r: CertRow) {
    setBusy(true);
    const info = await supabase.rpc('cert_request_download_info', { p_id: r.certificate_request_id });
    if (info.error) { setBusy(false); return void toast.error(msg(info.error, 'The certificate could not be opened.')); }
    const signed = await supabase.storage.from(BUCKET).createSignedUrl((info.data as { storage_key: string }).storage_key, 60);
    setBusy(false);
    if (signed.error || !signed.data) return void toast.error('The certificate could not be opened.');
    window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer');
  }
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No requests.</p>;
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((r) => (
        <li key={r.certificate_request_id} className="space-y-2 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><span className="font-medium">{r.request_number}</span> · {r.certificate_name} · {r.student_name} ({r.student_number}) · <span className="font-medium">{label(r.request_status)}</span><span className="text-muted-foreground"> · {r.purpose} · {r.requested_at.slice(0, 10)}{r.certificate_number ? ` · no. ${r.certificate_number}` : ''}</span></span>
            <span className="flex flex-wrap gap-2">
              {r.request_status === 'ISSUED' && r.has_file && <Button type="button" variant="outline" disabled={busy} onClick={() => open(r)}>Open certificate</Button>}
              {r.can_approve && <><Button type="button" variant="outline" disabled={busy} onClick={() => run('cert_request_decide', { p_id: r.certificate_request_id, p_approve: true, p_remarks: null }, 'Approved.')}>Approve</Button><Button type="button" variant="outline" onClick={() => setAct({ id: r.certificate_request_id, mode: 'reject', text: '', number: '' })}>Reject…</Button></>}
              {r.can_issue && <Button type="button" variant="outline" onClick={() => setAct({ id: r.certificate_request_id, mode: 'issue', text: '', number: '' })}>Issue…</Button>}
              {r.can_cancel && <Button type="button" variant="outline" disabled={busy} onClick={() => run('cert_request_cancel', { p_id: r.certificate_request_id }, 'Cancelled.')}>Cancel</Button>}
            </span>
          </div>
          {act?.id === r.certificate_request_id && act.mode === 'reject' && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted p-2">
              <div className="w-80 max-w-full"><label htmlFor="cr-rj" className="text-sm font-medium">Reason *</label><input id="cr-rj" maxLength={500} className={sel} value={act.text} onChange={(e) => setAct({ ...act, text: e.target.value })} /></div>
              <Button type="button" disabled={busy} onClick={async () => { if (await run('cert_request_decide', { p_id: r.certificate_request_id, p_approve: false, p_remarks: act.text }, 'Rejected.')) setAct(null); }}>Reject</Button>
              <Button type="button" variant="outline" onClick={() => setAct(null)}>Cancel</Button>
            </div>
          )}
          {act?.id === r.certificate_request_id && act.mode === 'issue' && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted p-2">
              <div className="w-56"><label htmlFor="cr-no" className="text-sm font-medium">Certificate number *</label><input id="cr-no" maxLength={50} className={sel} value={act.number} onChange={(e) => setAct({ ...act, number: e.target.value })} /></div>
              <div><label htmlFor="cr-f" className="text-sm font-medium">Signed PDF *</label><input id="cr-f" ref={ref} type="file" accept="application/pdf" className="block text-sm" /></div>
              <Button type="button" disabled={busy || !act.number.trim()} onClick={() => issue(r)}>Issue</Button>
              <Button type="button" variant="outline" onClick={() => setAct(null)}>Cancel</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
