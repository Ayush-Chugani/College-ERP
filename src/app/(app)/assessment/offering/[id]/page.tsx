import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCourseSheet, getOfferingInfo, listComponents, listEvents, parseAsmId } from '@/features/assessment-data';
import { ComponentManager, CourseResultSheet, EventManager } from '@/features/assessment-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Course assessment' };

export default async function OfferingAssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseAsmId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const info = await getOfferingInfo(supabase, id);
  if (!info) notFound(); // missing or not permitted: same response
  const [components, events, sheet] = await Promise.all([
    can(ctx, 'ASSESSMENT.ALL.READ') ? listComponents(supabase, id) : Promise.resolve([]),
    can(ctx, 'ASSESSMENT.ALL.READ') ? listEvents(supabase, id) : Promise.resolve([]),
    can(ctx, 'RESULT.ALL.READ') ? getCourseSheet(supabase, id) : Promise.resolve([]),
  ]);
  const canAsm = can(ctx, 'ASSESSMENT.ALL.CREATE');

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{info.course_code} — {info.course_title}</h1>
          <p className="text-sm text-muted-foreground">
            {info.offering_code} · {info.programme_name} · {info.semester_name} · {info.term_name} · {info.credits} credits
            {info.internal_max_marks !== null || info.external_max_marks !== null ? ` · internal max ${info.internal_max_marks ?? '—'}, external max ${info.external_max_marks ?? '—'}, passing ${info.passing_marks ?? '—'}` : ''}
          </p>
        </div>
        <Link href={`/results/term/${info.programme_term_offering_id}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Term results</Link>
      </div>

      {can(ctx, 'ASSESSMENT.ALL.READ') && (
        <>
          <Card><CardHeader><CardTitle>Components</CardTitle></CardHeader><CardContent><ComponentManager offeringId={id} components={components} canManage={canAsm} /></CardContent></Card>
          <Card><CardHeader><CardTitle>Events</CardTitle></CardHeader><CardContent><EventManager offeringId={id} components={components} events={events} canManage={canAsm} /></CardContent></Card>
        </>
      )}
      {can(ctx, 'RESULT.ALL.READ') && (
        <Card>
          <CardHeader><CardTitle>Course results</CardTitle></CardHeader>
          <CardContent>
            <CourseResultSheet
              key={`${id}-${sheet.map((r) => `${r.course_registration_id}:${r.result_status}:${r.total_marks}`).join('|')}`}
              rows={sheet}
              internalMax={info.internal_max_marks}
              externalMax={info.external_max_marks}
              canRecord={can(ctx, 'RESULT.ALL.CREATE')}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
