import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSession, getSheet, getTeachingSection, listCorrections, listStatuses, parseAttId } from '@/features/attendance-data';
import { CorrectionPanel, MarkingSheet, SessionStatus } from '@/features/attendance-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Mark attendance' };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseAttId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const session = await getSession(supabase, id);
  if (!session) notFound(); // missing or not visible: same response
  const [cos, sheet, statuses, corrections] = await Promise.all([
    getTeachingSection(supabase, session.course_offering_section_id),
    getSheet(supabase, id),
    listStatuses(supabase),
    listCorrections(supabase, id),
  ]);
  const canMark = can(ctx, 'ATTENDANCE.ALL.CREATE');
  const closed = session.session_status === 'CANCELLED' || session.session_status === 'RESCHEDULED';

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{session.session_date} · {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}</h1>
          <p className="text-sm text-muted-foreground">{cos?.course_label} · section {cos?.section_code} · {session.session_type} · <span className="font-medium text-foreground">{session.session_status}</span>{session.planned_topic ? ` · ${session.planned_topic}` : ''}</p>
        </div>
        <Link href={`/attendance/section/${session.course_offering_section_id}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Back to section</Link>
      </div>

      {can(ctx, 'ATTENDANCE.ALL.UPDATE') && (
        <Card>
          <CardHeader><CardTitle>Session status</CardTitle></CardHeader>
          <CardContent><SessionStatus sessionId={id} current={session.session_status} /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Attendance sheet</CardTitle></CardHeader>
        <CardContent><MarkingSheet key={`${id}-${sheet.length}-${sheet.filter((s) => s.attendance_status_id).length}`} sessionId={id} rows={sheet} statuses={statuses} canMark={canMark} closed={closed} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Corrections</CardTitle></CardHeader>
        <CardContent><CorrectionPanel sessionId={id} rows={sheet} statuses={statuses} corrections={corrections} canRequest={canMark} canDecide={can(ctx, 'ATTENDANCE.ALL.APPROVE')} /></CardContent>
      </Card>
    </div>
  );
}
