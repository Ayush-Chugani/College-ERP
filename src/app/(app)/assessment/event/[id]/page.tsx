import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getEvent, getMarkSheet, parseAsmId } from '@/features/assessment-data';
import { MarksSheet } from '@/features/assessment-forms';
import { StatusControl } from '@/features/registration-forms';
import { EVENT_STATUSES } from '@/lib/assessment-validation';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Assessment marks' };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseAsmId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const ev = await getEvent(supabase, id);
  if (!ev) notFound();
  const sheet = await getMarkSheet(supabase, id);
  const locked = ev.status === 'PUBLISHED' || ev.status === 'CANCELLED';

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{ev.event_title}</h1>
          <p className="text-sm text-muted-foreground">
            {ev.assessment_date}
            {ev.start_time ? ` · ${ev.start_time.slice(0, 5)}${ev.end_time ? `–${ev.end_time.slice(0, 5)}` : ''}` : ''} · max {ev.maximum_marks} · <span className="font-medium text-foreground">{ev.status}</span>
          </p>
        </div>
        <Link href={`/assessment/offering/${ev.course_offering_id}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Back to course</Link>
      </div>
      {can(ctx, 'ASSESSMENT.ALL.UPDATE') && (
        <Card><CardHeader><CardTitle>Event status</CardTitle></CardHeader><CardContent><StatusControl table="assessment_event" id={id} current={ev.status} options={EVENT_STATUSES} /></CardContent></Card>
      )}
      <Card>
        <CardHeader><CardTitle>Marks</CardTitle></CardHeader>
        <CardContent>
          <MarksSheet
            key={`${id}-${sheet.map((r) => `${r.course_registration_id}:${r.attendance_status}:${r.marks_obtained}:${r.reduced_marks}`).join('|')}`}
            eventId={id}
            maxMarks={ev.maximum_marks}
            reducedMax={ev.reduced_maximum_marks}
            rows={sheet}
            canEnter={can(ctx, 'ASSESSMENT.ALL.CREATE')}
            locked={locked}
          />
        </CardContent>
      </Card>
    </div>
  );
}
