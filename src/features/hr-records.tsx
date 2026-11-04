'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BUCKET, checkFile, formatSize, label, ownerStorageKey } from '@/lib/document-validation';
import { DocumentSharing } from '@/features/hr-extras';
import { createClient } from '@/lib/supabase/client';

export type Masked = { id: number; masked: string; name?: string; status: string; remarks: string | null; purpose?: string | null; issue_date?: string | null };
export type BankRow = { id: number; holder: string; bank: string; branch: string | null; masked: string; type: string; ifsc: string; upi: string | null; is_primary: boolean; is_salary: boolean; account_status: string; status: string; remarks: string | null };
export type Sensitive = {
  pan: Masked | null; aadhaar: Masked | null; bank: BankRow[];
  can: { owner: boolean; edit_pan: boolean; edit_aadhaar: boolean; edit_bank: boolean; verify_pan: boolean; verify_aadhaar: boolean; verify_bank: boolean; reveal_pan: boolean; reveal_aadhaar: boolean; reveal_bank: boolean; delete_pan: boolean; delete_aadhaar: boolean; delete_bank: boolean };
};
export type HrDoc = {
  employee_document_id: number; category: string; document_title: string; original_file_name: string; mime_type: string; file_size_bytes: number; document_number: string | null; issue_date: string | null; expiry_date: string | null;
  verification_status: string; effective_status: string; approval_status: string; verification_remarks: string | null; uploaded_at: string; confidentiality_level: string;
};
type Opt = { id: number; label: string };

const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const Field = ({ id, label: l, w = 'w-48', children }: { id: string; label: string; w?: string; children: React.ReactNode }) => <div className={w}><label htmlFor={id} className="text-sm font-medium">{l}</label>{children}</div>;
function msg(e: { code?: string; message: string }, fallback: string) {
  return ['22023', '45000', '42501', '23505'].includes(e.code ?? '') ? e.message : fallback;
}
function useRpc() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function rpc(fn: string, args: Record<string, unknown>, ok: string | null, fallback: string): Promise<{ data: unknown } | null> {
    setBusy(true);
    const { data, error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) { toast.error(msg(error, fallback)); return null; }
    if (ok) { toast.success(ok); router.refresh(); }
    return { data };
  }
  return { rpc, busy };
}

function Status({ s }: { s: string }) {
  return <span className="font-medium">{label(s)}</span>;
}

/** Review / reveal / delete controls shared by the three kinds. */
function Controls({ kind, id, status, canVerify, canReveal, canDelete, owner }: { kind: 'PAN' | 'AADHAAR' | 'BANK_ACCOUNT'; id: number; status: string; canVerify: boolean; canReveal: boolean; canDelete: boolean; owner: boolean }) {
  const { rpc, busy } = useRpc();
  const [mode, setMode] = useState<null | 'reject' | 'reveal'>(null);
  const [text, setText] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  async function reveal() {
    const r = await rpc('emp_sensitive_reveal', { p_kind: kind, p_id: id, p_purpose: text || null }, null, 'The number could not be shown.');
    if (r) { setShown(String(r.data)); setMode(null); setText(''); setTimeout(() => setShown(null), 15000); }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canVerify && status === 'PENDING' && <><Button type="button" variant="outline" disabled={busy} onClick={() => rpc('emp_sensitive_review', { p_kind: kind, p_id: id, p_decision: 'VERIFIED', p_remarks: null }, 'Verified.', 'The review could not be saved.')}>Verify</Button><Button type="button" variant="outline" onClick={() => setMode('reject')}>Reject…</Button></>}
        {canReveal && <Button type="button" variant="outline" onClick={() => setMode('reveal')}>Show full number…</Button>}
        {canDelete && <Button type="button" variant="outline" disabled={busy} onClick={() => { if (window.confirm('Delete this record?')) void rpc('emp_sensitive_delete', { p_kind: kind, p_id: id }, 'Deleted.', 'The record could not be deleted.'); }}>Delete</Button>}
      </div>
      {mode && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted p-2">
          <Field id={`ct-${kind}-${id}`} label={mode === 'reject' ? 'Reason *' : owner ? 'Purpose (optional for you)' : 'Purpose * (logged)'} w="w-72"><input id={`ct-${kind}-${id}`} maxLength={500} className={sel} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <Button type="button" disabled={busy} onClick={async () => { if (mode === 'reject') { const r = await rpc('emp_sensitive_review', { p_kind: kind, p_id: id, p_decision: 'REJECTED', p_remarks: text }, 'Rejected.', 'The review could not be saved.'); if (r) { setMode(null); setText(''); } } else await reveal(); }}>Confirm</Button>
          <Button type="button" variant="outline" onClick={() => { setMode(null); setText(''); }}>Cancel</Button>
        </div>
      )}
      {shown && <p role="status" className="rounded-md border border-border bg-card p-2 font-mono text-sm">{shown} <span className="text-xs text-muted-foreground">(hidden again in 15 seconds; this view was logged)</span></p>}
    </div>
  );
}

export function IdentityPanel({ employeeId, data }: { employeeId: number; data: Sensitive }) {
  const { rpc, busy } = useRpc();
  const c = data.can;
  const [pan, setPan] = useState({ number: '', name: data.pan?.name ?? '' });
  const [aad, setAad] = useState({ number: '', name: data.aadhaar?.name ?? '', purpose: data.aadhaar?.purpose ?? '' });
  const emptyBank = { id: null as number | null, holder: '', bank: '', branch: '', number: '', confirm: '', ifsc: '', type: 'SAVINGS', upi: '', primary: false, salary: false };
  const [bank, setBank] = useState(emptyBank);
  const [editBank, setEditBank] = useState(false);
  const lock = (status: string | undefined, canEdit: boolean) => canEdit && (!c.owner || !status || ['PENDING', 'REJECTED', 'PENDING_VERIFICATION'].includes(status) || c.verify_pan || c.verify_aadhaar || c.verify_bank);
  return (
    <div className="space-y-6">
      <section aria-labelledby="h-pan" className="space-y-2">
        <h3 id="h-pan" className="font-medium">PAN</h3>
        {data.pan ? <p className="text-sm"><span className="font-mono">{data.pan.masked}</span> · {data.pan.name} · <Status s={data.pan.status} />{data.pan.remarks ? <span className="text-muted-foreground"> · {data.pan.remarks}</span> : null}</p> : <p className="text-sm text-muted-foreground">No PAN on record.</p>}
        {data.pan && <Controls kind="PAN" id={data.pan.id} status={data.pan.status} canVerify={c.verify_pan} canReveal={c.reveal_pan} canDelete={c.delete_pan || (c.owner && data.pan.status !== 'VERIFIED')} owner={c.owner} />}
        {lock(data.pan?.status, c.edit_pan) && (
          <div className="flex flex-wrap items-end gap-3">
            <Field id="pn-n" label={data.pan ? 'New PAN' : 'PAN *'} w="w-44"><input id="pn-n" maxLength={10} autoComplete="off" className={`${sel} uppercase`} value={pan.number} onChange={(e) => setPan({ ...pan, number: e.target.value })} /></Field>
            <Field id="pn-m" label="Name as on the card *" w="w-64"><input id="pn-m" maxLength={200} className={sel} value={pan.name} onChange={(e) => setPan({ ...pan, name: e.target.value })} /></Field>
            <Button type="button" disabled={busy || !pan.number} onClick={async () => { if (await rpc('emp_pan_save', { p_employee_id: employeeId, p_pan: pan.number, p_name: pan.name, p_issue_date: null, p_remarks: null }, 'PAN saved.', 'The PAN could not be saved.')) setPan({ ...pan, number: '' }); }}>{data.pan ? 'Replace PAN' : 'Save PAN'}</Button>
          </div>
        )}
      </section>

      <section aria-labelledby="h-aad" className="space-y-2">
        <h3 id="h-aad" className="font-medium">Aadhaar</h3>
        {data.aadhaar ? <p className="text-sm"><span className="font-mono">{data.aadhaar.masked}</span> · {data.aadhaar.name} · <Status s={data.aadhaar.status} /><span className="text-muted-foreground"> · collected for: {data.aadhaar.purpose}</span></p> : <p className="text-sm text-muted-foreground">No Aadhaar number on record.</p>}
        {data.aadhaar && <Controls kind="AADHAAR" id={data.aadhaar.id} status={data.aadhaar.status} canVerify={c.verify_aadhaar} canReveal={c.reveal_aadhaar} canDelete={c.delete_aadhaar || (c.owner && data.aadhaar.status !== 'VERIFIED')} owner={c.owner} />}
        {lock(data.aadhaar?.status, c.edit_aadhaar) && (
          <div className="flex flex-wrap items-end gap-3">
            <Field id="aa-n" label={data.aadhaar ? 'New Aadhaar number' : 'Aadhaar number *'} w="w-52"><input id="aa-n" inputMode="numeric" maxLength={14} autoComplete="off" className={sel} value={aad.number} onChange={(e) => setAad({ ...aad, number: e.target.value })} /></Field>
            <Field id="aa-m" label="Name as on the card *" w="w-56"><input id="aa-m" maxLength={200} className={sel} value={aad.name} onChange={(e) => setAad({ ...aad, name: e.target.value })} /></Field>
            <Field id="aa-p" label="Why it is collected *" w="w-64"><input id="aa-p" maxLength={500} className={sel} value={aad.purpose} onChange={(e) => setAad({ ...aad, purpose: e.target.value })} /></Field>
            <Button type="button" disabled={busy || !aad.number} onClick={async () => { if (await rpc('emp_aadhaar_save', { p_employee_id: employeeId, p_aadhaar: aad.number, p_name: aad.name, p_purpose: aad.purpose, p_remarks: null }, 'Aadhaar saved.', 'The Aadhaar number could not be saved.')) setAad({ ...aad, number: '' }); }}>{data.aadhaar ? 'Replace' : 'Save'}</Button>
          </div>
        )}
      </section>

      <section aria-labelledby="h-bank" className="space-y-3">
        <h3 id="h-bank" className="font-medium">Bank accounts</h3>
        {data.bank.length === 0 ? <p className="text-sm text-muted-foreground">No bank account on record.</p> : (
          <ul className="divide-y divide-border text-sm">
            {data.bank.map((b) => (
              <li key={b.id} className="space-y-2 py-2">
                <p>{b.holder} · {b.bank}{b.branch ? `, ${b.branch}` : ''} · <span className="font-mono">{b.masked}</span> · {b.ifsc} · {label(b.type)}{b.is_primary ? ' · primary' : ''}{b.is_salary ? ' · salary' : ''} · <Status s={b.status} />{b.remarks ? <span className="text-muted-foreground"> · {b.remarks}</span> : null}</p>
                <div className="flex flex-wrap gap-2">
                  {c.edit_bank && (!c.owner || ['PENDING', 'REJECTED'].includes(b.status) || c.verify_bank) && <Button type="button" variant="outline" onClick={() => { setBank({ id: b.id, holder: b.holder, bank: b.bank, branch: b.branch ?? '', number: '', confirm: '', ifsc: b.ifsc, type: b.type, upi: b.upi ?? '', primary: b.is_primary, salary: b.is_salary }); setEditBank(true); }}>Edit</Button>}
                </div>
                <Controls kind="BANK_ACCOUNT" id={b.id} status={b.status} canVerify={c.verify_bank} canReveal={c.reveal_bank} canDelete={c.delete_bank || (c.owner && b.status !== 'VERIFIED')} owner={c.owner} />
              </li>
            ))}
          </ul>
        )}
        {c.edit_bank && (editBank || data.bank.length === 0) && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm font-medium">{bank.id ? 'Edit the account (leave the number blank to keep it)' : 'Add an account'}</p>
            <div className="flex flex-wrap items-end gap-3">
              <Field id="bk-h" label="Account holder *" w="w-52"><input id="bk-h" maxLength={200} className={sel} value={bank.holder} onChange={(e) => setBank({ ...bank, holder: e.target.value })} /></Field>
              <Field id="bk-b" label="Bank *" w="w-48"><input id="bk-b" maxLength={200} className={sel} value={bank.bank} onChange={(e) => setBank({ ...bank, bank: e.target.value })} /></Field>
              <Field id="bk-r" label="Branch" w="w-44"><input id="bk-r" maxLength={200} className={sel} value={bank.branch} onChange={(e) => setBank({ ...bank, branch: e.target.value })} /></Field>
              <Field id="bk-i" label="IFSC *" w="w-36"><input id="bk-i" maxLength={11} className={`${sel} uppercase`} value={bank.ifsc} onChange={(e) => setBank({ ...bank, ifsc: e.target.value })} /></Field>
              <Field id="bk-t" label="Type" w="w-32"><select id="bk-t" className={sel} value={bank.type} onChange={(e) => setBank({ ...bank, type: e.target.value })}>{['SAVINGS', 'CURRENT', 'SALARY', 'NRE', 'NRO', 'OTHER'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></Field>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field id="bk-n" label={bank.id ? 'New account number' : 'Account number *'} w="w-52"><input id="bk-n" inputMode="numeric" maxLength={18} autoComplete="off" className={sel} value={bank.number} onChange={(e) => setBank({ ...bank, number: e.target.value })} /></Field>
              <Field id="bk-c" label="Re-enter the number" w="w-52"><input id="bk-c" inputMode="numeric" maxLength={18} autoComplete="off" className={sel} value={bank.confirm} onChange={(e) => setBank({ ...bank, confirm: e.target.value })} onPaste={(e) => e.preventDefault()} /></Field>
              <Field id="bk-u" label="UPI id" w="w-44"><input id="bk-u" maxLength={150} className={sel} value={bank.upi} onChange={(e) => setBank({ ...bank, upi: e.target.value })} /></Field>
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={bank.primary} onChange={(e) => setBank({ ...bank, primary: e.target.checked })} /> Primary</label>
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={bank.salary} onChange={(e) => setBank({ ...bank, salary: e.target.checked })} /> Salary account</label>
            </div>
            <div className="flex gap-2">
              <Button type="button" disabled={busy} onClick={async () => { if (await rpc('emp_bank_save', { p_employee_id: employeeId, p_account_id: bank.id, p_holder: bank.holder, p_bank: bank.bank, p_branch: bank.branch || null, p_account_number: bank.number || null, p_account_confirm: bank.confirm || null, p_ifsc: bank.ifsc, p_type: bank.type, p_upi: bank.upi || null, p_is_primary: bank.primary, p_is_salary: bank.salary }, 'Bank account saved.', 'The bank account could not be saved.')) { setBank(emptyBank); setEditBank(false); } }}>{bank.id ? 'Save changes' : 'Add account'}</Button>
              {(bank.id || data.bank.length > 0) && <Button type="button" variant="outline" onClick={() => { setBank(emptyBank); setEditBank(false); }}>Cancel</Button>}
            </div>
          </div>
        )}
        {c.edit_bank && !editBank && data.bank.length > 0 && <Button type="button" variant="outline" onClick={() => { setBank(emptyBank); setEditBank(true); }}>Add another account</Button>}
      </section>
    </div>
  );
}

export function HrDocuments({ employeeId, docs, categories, types, canReview, canDelete, canUpload, canShare, ownerId }: { employeeId: number; docs: HrDoc[]; categories: Opt[]; types: Opt[]; canReview: boolean; canDelete: boolean; canUpload: boolean; canShare: boolean; ownerId: number | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ category: '', type: '', title: '', number: '', issue: '', expiry: '' });
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ id: number; reason: string } | null>(null);
  const supabase = createClient();
  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return void toast.error('Choose a file.');
    const problem = checkFile(file);
    if (problem) return void toast.error(problem);
    if (!f.category || !f.type || !f.title.trim()) return void toast.error('Choose a category and a document type, and give the document a title.');
    setBusy(true);
    const key = ownerStorageKey('employee', employeeId, file.name, crypto.randomUUID());
    const up = await supabase.storage.from(BUCKET).upload(key, file, { contentType: file.type, upsert: false });
    if (up.error) { setBusy(false); return void toast.error('The file could not be uploaded.'); }
    let checksum: string | null = null;
    try { checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join(''); } catch { /* optional */ }
    const { error } = await supabase.rpc('employee_document_register', { p_employee_id: employeeId, p_category_id: Number(f.category), p_document_type_id: Number(f.type), p_title: f.title, p_storage_key: key, p_file_name: file.name, p_mime_type: file.type, p_size: file.size, p_checksum: checksum, p_document_number: f.number || null, p_issue_date: f.issue || null, p_expiry_date: f.expiry || null });
    if (error) { await supabase.storage.from(BUCKET).remove([key]); setBusy(false); return void toast.error(msg(error, 'The document could not be saved.')); }
    setBusy(false);
    toast.success('Document uploaded.');
    setF({ ...f, title: '', number: '', issue: '', expiry: '' });
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();
  }
  async function open(id: number) {
    setBusy(true);
    const info = await supabase.rpc('employee_document_download_info', { p_id: id });
    if (info.error) { setBusy(false); return void toast.error(msg(info.error, 'The document could not be opened.')); }
    const signed = await supabase.storage.from(BUCKET).createSignedUrl((info.data as { storage_key: string }).storage_key, 60);
    setBusy(false);
    if (signed.error || !signed.data) return void toast.error('The document could not be opened.');
    window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer');
  }
  async function decide(id: number, decision: 'VERIFIED' | 'REJECTED', remarks: string | null) {
    setBusy(true);
    const { error } = await supabase.rpc('employee_document_review', { p_id: id, p_decision: decision, p_remarks: remarks });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'The review could not be saved.'));
    toast.success('Review saved.');
    setReview(null);
    router.refresh();
  }
  async function remove(id: number) {
    if (!window.confirm('Delete this document?')) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('employee_document_delete', { p_id: id });
    if (error) { setBusy(false); return void toast.error(msg(error, 'The document could not be deleted.')); }
    await supabase.storage.from(BUCKET).remove([data as string]);
    setBusy(false);
    toast.success('Document deleted.');
    router.refresh();
  }
  return (
    <div className="space-y-4">
      {docs.length === 0 ? <p className="text-sm text-muted-foreground">No documents.</p> : (
        <ul className="divide-y divide-border text-sm">
          {docs.map((d) => (
            <li key={d.employee_document_id} className="space-y-2 py-2">
              <p><span className="font-medium">{d.document_title}</span> · {d.category} · {d.original_file_name} ({formatSize(d.file_size_bytes)}) · <span className="font-medium">{label(d.effective_status)}</span>{d.approval_status !== 'NOT_REQUIRED' ? ` · approval ${label(d.approval_status)}` : ''}<span className="text-muted-foreground">{d.expiry_date ? ` · expires ${d.expiry_date}` : ''}{d.verification_remarks ? ` · ${d.verification_remarks}` : ''}</span></p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => open(d.employee_document_id)}>Open</Button>
                {canReview && d.verification_status === 'PENDING' && <><Button type="button" variant="outline" disabled={busy} onClick={() => decide(d.employee_document_id, 'VERIFIED', null)}>Verify</Button><Button type="button" variant="outline" onClick={() => setReview({ id: d.employee_document_id, reason: '' })}>Reject…</Button></>}
                {canShare && ownerId !== employeeId && <DocumentSharing documentId={d.employee_document_id} />}
                {(canDelete || ownerId === employeeId) && d.verification_status !== 'VERIFIED' && <Button type="button" variant="outline" disabled={busy} onClick={() => remove(d.employee_document_id)}>Delete</Button>}
              </div>
              {review?.id === d.employee_document_id && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted p-2">
                  <Field id="hd-rr" label="Reason *" w="w-72"><input id="hd-rr" maxLength={500} className={sel} value={review.reason} onChange={(e) => setReview({ ...review, reason: e.target.value })} /></Field>
                  <Button type="button" disabled={busy} onClick={() => decide(d.employee_document_id, 'REJECTED', review.reason)}>Reject</Button>
                  <Button type="button" variant="outline" onClick={() => setReview(null)}>Cancel</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field id="hd-c" label="Category *" w="w-56"><select id="hd-c" className={sel} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Select…</option>{categories.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
            <Field id="hd-t" label="Document type *" w="w-56"><select id="hd-t" className={sel} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Select…</option>{types.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
            <Field id="hd-n" label="Title *" w="w-64"><input id="hd-n" maxLength={250} className={sel} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field id="hd-d" label="Document number" w="w-44"><input id="hd-d" maxLength={100} className={sel} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
            <Field id="hd-i" label="Issue date" w="w-40"><input id="hd-i" type="date" className={sel} value={f.issue} onChange={(e) => setF({ ...f, issue: e.target.value })} /></Field>
            <Field id="hd-e" label="Expiry date" w="w-40"><input id="hd-e" type="date" className={sel} value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></Field>
          </div>
          <div><label htmlFor="hd-f" className="text-sm font-medium">File * (PDF, JPEG or PNG, up to 10 MB)</label><input id="hd-f" ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="block text-sm" /></div>
          <Button type="button" disabled={busy} onClick={upload}>{busy ? 'Working…' : 'Upload'}</Button>
        </div>
      )}
    </div>
  );
}
