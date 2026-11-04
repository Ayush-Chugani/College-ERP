'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { Evidence, Opt } from '@/features/activity-data';
import { evidenceSchema, type EvidenceInput, type EvidenceValues } from '@/lib/activity-validation';
import { BUCKET, checkFile, ownerStorageKey } from '@/lib/document-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023' || e.code === '23505') return e.message;
  if (e.code === '42501') return /Not authorised/.test(e.message) ? e.message : 'You are not allowed to do that.';
  return fallback;
}
async function sha256Hex(file: File): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export type EvidenceOwner = { activityId: number; ownerId: number; ownerKind: 'student' | 'employee'; canEdit: boolean; evidence: Evidence[] };

/** Evidence list and upload for a student activity (student_activity_evidence_*) or a staff record (staff_evidence_*). */
export function EvidencePanel({ a, documentTypes, evidenceTypes }: { a: EvidenceOwner; documentTypes: Opt[]; evidenceTypes: Opt[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const form = useForm<EvidenceInput, unknown, EvidenceValues>({ resolver: zodResolver(evidenceSchema), defaultValues: { title: '', issue_date: '', issuing_authority: '', certificate_number: '' } });
  const e = form.formState.errors;
  const supabase = createClient();
  const fn = (op: string) => (a.ownerKind === 'student' ? `student_activity_evidence_${op}` : `staff_evidence_${op}`);

  async function upload(file: File) {
    const key = ownerStorageKey(a.ownerKind, a.ownerId, file.name, crypto.randomUUID());
    const up = await supabase.storage.from(BUCKET).upload(key, file, { contentType: file.type, upsert: false });
    return up.error ? null : key;
  }
  async function add(v: EvidenceValues) {
    const file = fileRef.current?.files?.[0];
    if (!file) return void setFileError('Choose a file');
    const problem = checkFile(file);
    if (problem) return void setFileError(problem);
    setFileError(undefined);
    const key = await upload(file);
    if (!key) return void toast.error('The file could not be uploaded.');
    const { error } = await supabase.rpc(fn('add'), {
      p_activity_id: a.activityId, p_document_type_id: v.document_type_id, p_evidence_type_id: v.evidence_type_id ?? null, p_title: v.title, p_issue_date: v.issue_date ?? null,
      p_issuing_authority: v.issuing_authority ?? null, p_certificate_number: v.certificate_number ?? null, p_storage_key: key, p_file_name: file.name, p_mime: file.type, p_size: file.size, p_checksum: await sha256Hex(file),
    });
    if (error) { await supabase.storage.from(BUCKET).remove([key]); return void toast.error(dbMessage(error, 'The evidence could not be saved.')); }
    toast.success('Evidence added.');
    form.reset();
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();
  }
  async function open(ev: Evidence) {
    setBusy(true);
    const info = await supabase.rpc(fn('download_info'), { p_evidence_id: ev.evidence_id });
    if (info.error) { setBusy(false); return void toast.error(dbMessage(info.error, 'The file could not be opened.')); }
    const signed = await supabase.storage.from(BUCKET).createSignedUrl((info.data as { storage_key: string }).storage_key, 60);
    setBusy(false);
    if (signed.error || !signed.data) return void toast.error('The file could not be opened.');
    window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer');
  }
  async function replace(ev: Evidence, file: File | undefined) {
    if (!file) return;
    const problem = checkFile(file);
    if (problem) return void toast.error(problem);
    setBusy(true);
    const key = await upload(file);
    if (!key) { setBusy(false); return void toast.error('The file could not be uploaded.'); }
    const { error } = await supabase.rpc(fn('replace'), { p_evidence_id: ev.evidence_id, p_reason: null, p_storage_key: key, p_file_name: file.name, p_mime: file.type, p_size: file.size, p_checksum: await sha256Hex(file) });
    setBusy(false);
    if (error) { await supabase.storage.from(BUCKET).remove([key]); return void toast.error(dbMessage(error, 'The file could not be replaced.')); }
    toast.success('New version saved.');
    router.refresh();
  }
  async function remove(ev: Evidence) {
    const { error } = await supabase.rpc(fn('delete'), { p_evidence_id: ev.evidence_id, p_reason: null });
    if (error) return void toast.error(dbMessage(error, 'The evidence could not be removed.'));
    router.refresh();
  }
  return (
    <div className="space-y-4">
      {a.evidence.length === 0 ? <p className="text-sm text-muted-foreground">No evidence uploaded.</p> : (
        <ul className="divide-y divide-border text-sm">
          {a.evidence.map((ev) => (
            <li key={ev.evidence_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{ev.title}</span><span className="text-muted-foreground"> · {ev.evidence_type ?? 'Evidence'} · {ev.file_name} · version {ev.version}{ev.certificate_number ? ` · No. ${ev.certificate_number}` : ''}</span></span>
              <span className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => open(ev)}>Open</Button>
                {a.canEdit && <><label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border bg-card px-3 text-sm hover:bg-muted">Replace<input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png" aria-label={`Replace ${ev.title}`} onChange={(x) => replace(ev, x.target.files?.[0])} /></label>
                  <Button type="button" variant="outline" onClick={() => remove(ev)} aria-label={`Remove ${ev.title}`}>Remove</Button></>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {a.canEdit && (
        <form onSubmit={form.handleSubmit(add)} className="space-y-3" noValidate aria-label="Add evidence">
          <div className="flex flex-wrap items-start gap-3">
            <SelectField id="ev-dt" label="Document type *" className="w-56" options={documentTypes} {...form.register('document_type_id')} error={e.document_type_id?.message} />
            <SelectField id="ev-et" label="Evidence type" className="w-56" options={evidenceTypes} {...form.register('evidence_type_id')} error={e.evidence_type_id?.message} />
            <TextField id="ev-t" label="Title *" className="w-72" maxLength={500} {...form.register('title')} error={e.title?.message} />
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <TextField id="ev-i" type="date" label="Issue date" className="w-44" {...form.register('issue_date')} error={e.issue_date?.message} />
            <TextField id="ev-a" label="Issued by" className="w-64" maxLength={300} {...form.register('issuing_authority')} />
            <TextField id="ev-c" label="Certificate number" className="w-52" maxLength={150} {...form.register('certificate_number')} />
          </div>
          <div><label htmlFor="ev-f" className="text-sm font-medium">File * (PDF, JPEG or PNG, up to 10 MB)</label>
            <input id="ev-f" ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" onChange={() => setFileError(undefined)} className="block text-sm" aria-invalid={!!fileError} />
            {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}</div>
          <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Uploading…' : 'Add evidence'}</Button>
        </form>
      )}
    </div>
  );
}
