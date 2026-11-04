import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAnnouncement, listDepartments, listTypes, parseAnnId } from '@/features/announcement-data';
import { AnnouncementForm, StatusActions } from '@/features/announcement-forms';
import { EDITABLE, label } from '@/lib/announcement-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Announcement' };

export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseAnnId((await params).id);
  if (id === null) notFound();
  const { supabase } = await requireContext();
  const a = await getAnnouncement(supabase, id);
  if (!a) notFound(); // missing or not permitted: same response
  const editable = a.can_update && (EDITABLE as readonly string[]).includes(a.approval_status);
  const [types, departments] = editable ? await Promise.all([listTypes(supabase), listDepartments(supabase)]) : [[], []];
  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{a.title}</h1>
          <p className="text-sm text-muted-foreground">Audience {label(a.audience_type).toLowerCase()} · <span className="font-medium text-foreground">{label(a.approval_status)}</span></p>
        </div>
        <Link href="/announcements" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">All announcements</Link>
      </div>
      <Card><CardHeader><CardTitle>Actions</CardTitle></CardHeader><CardContent><StatusActions detail={a} /></CardContent></Card>
      {editable ? (
        <Card><CardHeader><CardTitle>Edit</CardTitle></CardHeader><CardContent><AnnouncementForm types={types} departments={departments} initial={a} /></CardContent></Card>
      ) : (
        <Card><CardHeader><CardTitle>Content</CardTitle></CardHeader><CardContent>
          <p className="whitespace-pre-wrap text-sm">{a.description}</p>
          <p className="mt-2 text-xs text-muted-foreground">From {new Date(a.publish_from).toLocaleString()}{a.publish_to ? ` until ${new Date(a.publish_to).toLocaleString()}` : ''}</p>
        </CardContent></Card>
      )}
    </div>
  );
}
