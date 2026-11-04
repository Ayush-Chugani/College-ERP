import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getOffering, getTermInfo, listCourseOfferings, listCourseRegistrations, parseRegId } from '@/features/registration-data';
import { CourseRegManager, StatusControl } from '@/features/registration-forms';
import { can } from '@/lib/context';
import { TERM_REG_NEXT } from '@/lib/registration-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Student registration' };

export default async function TermRegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseRegId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const info = await getTermInfo(supabase, id);
  if (!info) notFound(); // missing, or no REGISTRATION read access at its programme
  const [offering, regs, offerings] = await Promise.all([
    getOffering(supabase, info.programme_term_offering_id),
    listCourseRegistrations(supabase, id),
    listCourseOfferings(supabase, info.programme_term_offering_id),
  ]);
  const canUpdate = can(ctx, 'REGISTRATION.ALL.UPDATE');
  const closed = info.registration_status === 'CANCELLED' || info.registration_status === 'COMPLETED';
  const available = offerings.filter((o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').map((o) => ({ id: o.course_offering_id, label: `${o.code ?? o.offering_code} — ${o.title ?? ''}` }));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{info.display_name}</h1>
          <p className="text-sm text-muted-foreground">
            {info.student_number} · {offering?.term_name} · {offering?.semester_name} · <span className="font-medium text-foreground">{info.registration_status}</span>
          </p>
        </div>
        <Link href={`/registration/${info.programme_term_offering_id}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Back to offering</Link>
      </div>

      {canUpdate && (
        <Card>
          <CardHeader><CardTitle>Term registration status</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Approving needs the approval permission; reinstating a cancelled registration is refused if the section is full.</p>
            <StatusControl table="student_term_registration" id={id} current={info.registration_status} options={TERM_REG_NEXT[info.registration_status] ?? []} label="Change status" />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Registered courses</CardTitle></CardHeader>
        <CardContent>
          <CourseRegManager termRegId={id} regs={regs} available={available} canManage={canUpdate && !closed} />
          {closed && <p className="mt-3 text-sm text-muted-foreground">Courses cannot be added to a {info.registration_status.toLowerCase()} registration.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
