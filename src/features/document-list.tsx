import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DocumentActions } from '@/features/document-forms';
import type { DocRow } from '@/features/document-data';
import { formatSize, label } from '@/lib/document-validation';

export function DocumentList({ rows, canReview, canDelete, error }: { rows: DocRow[]; canReview: boolean; canDelete: boolean; error: string | null }) {
  return (
    <Card className="overflow-x-auto">
      <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
      <CardContent>
        {error && <p role="alert" className="mb-2 text-sm text-destructive">Could not load the documents.</p>}
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No documents have been uploaded.</p> : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left"><tr>
              <th scope="col" className="py-2 pr-4 font-medium">Document</th><th scope="col" className="py-2 pr-4 font-medium">Status</th><th scope="col" className="py-2 pr-4 font-medium">Dates</th><th scope="col" className="py-2 font-medium">Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.student_document_id} className="border-b border-border align-top last:border-0">
                  <td className="py-2 pr-4"><div className="font-medium">{d.document_type}</div><div className="text-xs text-muted-foreground">{d.original_file_name} · {formatSize(d.file_size_bytes)}{d.document_number ? ` · No. ${d.document_number}` : ''}</div></td>
                  <td className="py-2 pr-4"><span className="font-medium">{label(d.effective_status)}</span>{d.remarks && <div className="text-xs text-muted-foreground">{d.remarks}</div>}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">Uploaded {new Date(d.uploaded_at).toLocaleDateString()}{d.issue_date ? <><br />Issued {d.issue_date}</> : null}{d.expiry_date ? <><br />Expires {d.expiry_date}</> : null}</td>
                  <td className="py-2"><DocumentActions doc={d} canReview={canReview} canDelete={canDelete} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
