'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BUCKET, checkFile, formatSize, ownerStorageKey } from '@/lib/document-validation';
import { createClient } from '@/lib/supabase/client';

export type AttachmentFile = { file_id: number; name: string; mime: string; size: number };
const msg = (e: { code?: string; message: string }, fb: string) => (['22023', '23505', '42501', '45000'].includes(e.code ?? '') ? e.message : fb);

/** Files of an announcement (migration 059): list and open for the audience, add and remove for the author while it is a draft. */
export function AnnouncementAttachments({ announcementId, files, canEdit }: { announcementId: number; files: AttachmentFile[]; canEdit: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const supabase = createClient();
  async function open(f: AttachmentFile) {
    setBusy(true);
    const info = await supabase.rpc('announcement_attachment_download_info', { p_id: announcementId, p_file_id: f.file_id });
    if (info.error) { setBusy(false); return void toast.error(msg(info.error, 'The file could not be opened.')); }
    const signed = await supabase.storage.from(BUCKET).createSignedUrl((info.data as { storage_key: string }).storage_key, 60);
    setBusy(false);
    if (signed.error || !signed.data) return void toast.error('The file could not be opened.');
    window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer');
  }
  async function upload() {
    const file = ref.current?.files?.[0];
    if (!file) return void toast.error('Choose a file.');
    const problem = checkFile(file);
    if (problem) return void toast.error(problem);
    setBusy(true);
    const key = ownerStorageKey('announcement', announcementId, file.name, crypto.randomUUID());
    const up = await supabase.storage.from(BUCKET).upload(key, file, { contentType: file.type, upsert: false });
    if (up.error) { setBusy(false); return void toast.error('The file could not be uploaded.'); }
    let checksum: string | null = null;
    try { checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join(''); } catch { /* optional */ }
    const { error } = await supabase.rpc('announcement_attachment_register', { p_id: announcementId, p_storage_key: key, p_file_name: file.name, p_mime_type: file.type, p_size: file.size, p_checksum: checksum });
    if (error) { await supabase.storage.from(BUCKET).remove([key]); setBusy(false); return void toast.error(msg(error, 'The file could not be attached.')); }
    setBusy(false);
    toast.success('File attached.');
    if (ref.current) ref.current.value = '';
    router.refresh();
  }
  async function remove(f: AttachmentFile) {
    if (!window.confirm(`Remove ${f.name}?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('announcement_attachment_remove', { p_id: announcementId, p_file_id: f.file_id });
    if (error) { setBusy(false); return void toast.error(msg(error, 'The file could not be removed.')); }
    await supabase.storage.from(BUCKET).remove([data as string]);
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="space-y-3">
      {files.length === 0 ? <p className="text-sm text-muted-foreground">No attachments.</p> : (
        <ul className="divide-y divide-border text-sm">
          {files.map((f) => (
            <li key={f.file_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{f.name} <span className="text-muted-foreground">({formatSize(f.size)})</span></span>
              <span className="flex gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => open(f)}>Open</Button>{canEdit && <Button type="button" variant="outline" disabled={busy} onClick={() => remove(f)}>Remove</Button>}</span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div><label htmlFor="an-f" className="text-sm font-medium">Add a file (PDF, JPEG or PNG, up to 10 MB, at most 10)</label><input id="an-f" ref={ref} type="file" accept="application/pdf,image/jpeg,image/png" className="block text-sm" /></div>
          <Button type="button" disabled={busy} onClick={upload}>Attach</Button>
        </div>
      )}
    </div>
  );
}
