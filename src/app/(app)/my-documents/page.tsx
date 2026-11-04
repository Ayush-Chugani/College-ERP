import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listDocuments, listDocumentTypes } from '@/features/document-data';
import { UploadForm } from '@/features/document-forms';
import { DocumentList } from '@/features/document-list';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'My documents' };

export default async function MyDocumentsPage() {
  const { supabase, ctx } = await requireContext();
  if (ctx.student_id === null) notFound();
  const [docs, types] = await Promise.all([listDocuments(supabase, ctx.student_id), listDocumentTypes(supabase)]);
  return (
    <div className="max-w-5xl space-y-6">
      <div><h1 className="text-xl font-semibold">My documents</h1><p className="text-sm text-muted-foreground">Upload certificates and identity proofs. The office checks each one; only you and authorised staff can open them.</p></div>
      <DocumentList rows={docs.rows} canReview={false} canDelete error={docs.error} />
      <Card><CardHeader><CardTitle>Upload a document</CardTitle></CardHeader><CardContent><UploadForm studentId={ctx.student_id} types={types} /></CardContent></Card>
    </div>
  );
}
