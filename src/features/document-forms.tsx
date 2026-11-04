'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { DocRow, Opt } from '@/features/document-data';
import { BUCKET, checkFile, reviewSchema, storageKey, uploadSchema, type ReviewInput, type ReviewValues, type UploadInput, type UploadValues } from '@/lib/document-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023' || e.code === '23505') return e.message;
  if (e.code === '42501') return /Not authorised/.test(e.message) ? e.message : 'You are not allowed to do that.';
  return fallback;
}
async function sha256Hex(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null; // insecure context or very old browser: the checksum is optional
  }
}

export function UploadForm({ studentId, types }: { studentId: number; types: Opt[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const form = useForm<UploadInput, unknown, UploadValues>({ resolver: zodResolver(uploadSchema), defaultValues: { document_number: '', issue_date: '', expiry_date: '' } });
  const e = form.formState.errors;

  async function submit(v: UploadValues) {
    const file = fileRef.current?.files?.[0];
    if (!file) return void setFileError('Choose a file');
    const problem = checkFile(file);
    if (problem) return void setFileError(problem);
    setFileError(undefined);
    const supabase = createClient();
    const key = storageKey(studentId, file.name, crypto.randomUUID());
    const up = await supabase.storage.from(BUCKET).upload(key, file, { contentType: file.type, upsert: false });
    if (up.error) return void toast.error('The file could not be uploaded.');
    const { error } = await supabase.rpc('student_document_register', {
      p_student_id: studentId, p_document_type_id: v.document_type_id, p_storage_key: key, p_file_name: file.name, p_mime_type: file.type, p_size: file.size, p_checksum: await sha256Hex(file),
      p_document_number: v.document_number ?? null, p_issue_date: v.issue_date ?? null, p_expiry_date: v.expiry_date ?? null,
    });
    if (error) {
      await supabase.storage.from(BUCKET).remove([key]); // unregistered object: allowed by the orphan rule
      return void toast.error(dbMessage(error, 'The document could not be saved.'));
    }
    toast.success('Document uploaded. It will be checked by the office.');
    form.reset();
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();
  }
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-3" noValidate aria-label="Upload a document">
      <div className="flex flex-wrap items-start gap-3">
        <SelectField id="du-type" label="Document type *" className="w-64" options={types} {...form.register('document_type_id')} error={e.document_type_id?.message} />
        <TextField id="du-num" label="Document number" className="w-52" maxLength={100} {...form.register('document_number')} error={e.document_number?.message} />
        <TextField id="du-issue" type="date" label="Issue date" className="w-44" {...form.register('issue_date')} error={e.issue_date?.message} />
        <TextField id="du-exp" type="date" label="Expiry date" className="w-44" {...form.register('expiry_date')} error={e.expiry_date?.message} />
      </div>
      <div>
        <label htmlFor="du-file" className="text-sm font-medium">File * (PDF, JPEG or PNG, up to 10 MB)</label>
        <input id="du-file" ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" onChange={() => setFileError(undefined)} className="block text-sm" aria-invalid={!!fileError} />
        {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
      </div>
      <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Uploading…' : 'Upload'}</Button>
    </form>
  );
}

export function DocumentActions({ doc, canReview, canDelete }: { doc: DocRow; canReview: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = useForm<ReviewInput, unknown, ReviewValues>({ resolver: zodResolver(reviewSchema), defaultValues: { decision: 'VERIFIED', remarks: '' } });
  const e = form.formState.errors;
  const pending = doc.verification_status === 'PENDING';
  const supabase = createClient();

  async function download() {
    setBusy(true);
    const info = await supabase.rpc('student_document_download_info', { p_id: doc.student_document_id });
    if (info.error) { setBusy(false); return void toast.error(dbMessage(info.error, 'The document could not be opened.')); }
    const { storage_key } = info.data as { storage_key: string };
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(storage_key, 60);
    setBusy(false);
    if (signed.error || !signed.data) return void toast.error('The document could not be opened.');
    window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer');
  }
  async function review(v: ReviewValues) {
    setBusy(true);
    const { error } = await supabase.rpc('student_document_review', { p_id: doc.student_document_id, p_decision: v.decision, p_remarks: v.remarks ?? null });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The review could not be saved.'));
    toast.success('Review saved.');
    setReviewing(false);
    router.refresh();
  }
  async function remove() {
    setBusy(true);
    const { data, error } = await supabase.rpc('student_document_delete', { p_id: doc.student_document_id });
    if (error) { setBusy(false); return void toast.error(dbMessage(error, 'The document could not be deleted.')); }
    await supabase.storage.from(BUCKET).remove([data as string]);
    setBusy(false);
    toast.success('Document deleted.');
    router.refresh();
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={download}>Open</Button>
        {canReview && pending && !reviewing && <Button type="button" disabled={busy} onClick={() => setReviewing(true)}>Review…</Button>}
        {canDelete && doc.verification_status !== 'VERIFIED' && (confirmDelete
          ? <span className="inline-flex items-center gap-2 text-xs">Delete? <Button type="button" disabled={busy} onClick={remove}>Yes</Button><Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>No</Button></span>
          : <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${doc.original_file_name}`}>Delete</Button>)}
      </div>
      {reviewing && (
        <form onSubmit={form.handleSubmit(review)} className="space-y-2 rounded-md border border-border bg-muted p-3" noValidate aria-label="Review the document">
          <select aria-label="Decision" className="flex h-9 w-48 rounded-md border border-border bg-card px-3 text-sm" {...form.register('decision')}><option value="VERIFIED">Verify</option><option value="REJECTED">Reject</option></select>
          <input aria-label="Remarks" placeholder="Remarks (required to reject)" maxLength={500} className="flex h-9 w-full max-w-md rounded-md border border-border bg-card px-3 text-sm" {...form.register('remarks')} />
          {e.remarks?.message && <p role="alert" className="text-sm text-destructive">{e.remarks.message}</p>}
          <div className="flex gap-2"><Button type="submit" disabled={busy}>Save review</Button><Button type="button" variant="outline" onClick={() => setReviewing(false)}>Cancel</Button></div>
        </form>
      )}
    </div>
  );
}
