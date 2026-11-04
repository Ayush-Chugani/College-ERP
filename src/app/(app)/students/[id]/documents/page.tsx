import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listDocuments, listDocumentTypes } from '@/features/document-data';
import { UploadForm } from '@/features/document-forms';
import { DocumentList } from '@/features/document-list';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Student documents' };

export default async function StudentDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id;
  if (!/^\d{1,15}$/.test(raw) || Number(raw) <= 0) notFound();
  const id = Number(raw);
  const { supabase, ctx } = await requireContext();
  const { data: student } = await supabase.from('student').select('student_number, display_name').eq('student_id', id).maybeSingle();
  if (!student) notFound();
  const [docs, types] = await Promise.all([listDocuments(supabase, id), listDocumentTypes(supabase)]);
  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Documents</h1><p className="text-sm text-muted-foreground">{String(student.display_name)} · {String(student.student_number)}</p></div>
        <Link href={`/students/${id}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Student record</Link>
      </div>
      <DocumentList rows={docs.rows} canReview={can(ctx, 'DOCUMENT.ALL.VERIFY')} canDelete={can(ctx, 'DOCUMENT.ALL.DELETE')} error={docs.error} />
      {can(ctx, 'DOCUMENT.ALL.CREATE') && <Card><CardHeader><CardTitle>Upload on behalf of the student</CardTitle></CardHeader><CardContent><UploadForm studentId={id} types={types} /></CardContent></Card>}
    </div>
  );
}
