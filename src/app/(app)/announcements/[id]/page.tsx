import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDetail, parseAnnId } from '@/features/communication-data';
import { AnnouncementAttachments, type AttachmentFile } from '@/features/attachments-panel';
import { WorkflowButtons } from '@/features/communication-forms';
import { audienceLabel, statusLabel } from '@/lib/communication-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Announcement' };

export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseAnnId((await params).id);
  if (id === null) notFound();
  const { supabase } = await requireContext();
  const a = await getDetail(supabase, id);
  if (!a) notFound(); // missing or not for this user: same response
  const att = ((await supabase.rpc('announcement_attachment_list', { p_id: id })).data ?? { files: [], can_edit: false }) as { files: AttachmentFile[]; can_edit: boolean };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{a.title}</h1>
          <p className="text-sm text-muted-foreground">{a.type_name} · {a.department_name ?? 'Institution'} · {new Date(a.publish_from).toLocaleString()}{a.publish_to ? ` to ${new Date(a.publish_to).toLocaleString()}` : ''}</p>
        </div>
        <Link href={a.managed ? '/announcements/manage' : '/announcements'} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Back</Link>
      </div>
      <Card><CardContent className="p-5"><p className="whitespace-pre-wrap text-sm">{a.description}</p></CardContent></Card>
      {(att.files.length > 0 || att.can_edit) && <Card><CardHeader><CardTitle>Attachments</CardTitle></CardHeader><CardContent><AnnouncementAttachments announcementId={id} files={att.files} canEdit={att.can_edit} /></CardContent></Card>}
      {a.managed && (
        <Card>
          <CardHeader><CardTitle>Status: {statusLabel(a.approval_status)}</CardTitle><p className="text-xs text-muted-foreground">Audience: {audienceLabel[a.audience_type] ?? a.audience_type}{a.is_mine ? ' · you are the author' : ''}</p></CardHeader>
          <CardContent className="space-y-3">
            {a.can_edit && <Link href={`/announcements/${id}/edit`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Edit</Link>}
            <WorkflowButtons id={id} canSubmit={a.can_submit} canDecide={a.can_decide} canArchive={a.can_archive} />
            {!a.can_edit && !a.can_decide && !a.can_archive && !a.can_submit && <p className="text-sm text-muted-foreground">No actions are available to you for this announcement.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
