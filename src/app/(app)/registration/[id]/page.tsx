import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getOffering, getRoster, listCourseOfferings, listSections, parseRegId } from '@/features/registration-data';
import { listTeachingSectionsForOffering } from '@/features/attendance-data';
import { TeachingSectionManager } from '@/features/attendance-forms';
import { CourseOfferingManager, RegisterStudentForm, SectionManager, StatusControl } from '@/features/registration-forms';
import { can } from '@/lib/context';
import { OFFERING_STATUSES } from '@/lib/registration-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Offering' };

export default async function OfferingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseRegId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const offering = await getOffering(supabase, id);
  if (!offering) notFound(); // missing or not visible: same response
  const [{ sections, batches }, courseOfferings, roster, teaching] = await Promise.all([listSections(supabase, id), listCourseOfferings(supabase, id), getRoster(supabase, id), listTeachingSectionsForOffering(supabase, id)]);
  const canUpdate = can(ctx, 'REGISTRATION.ALL.UPDATE');
  const canCreate = can(ctx, 'REGISTRATION.ALL.CREATE');
  const closed = offering.status === 'COMPLETED' || offering.status === 'CANCELLED';
  const secName = new Map(sections.map((s) => [s.class_section_id, s.section_code]));

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{offering.programme_name ?? `Programme #${offering.programme_id}`}</h1>
          <p className="text-sm text-muted-foreground">{offering.term_name} · {offering.semester_name} · <span className="font-medium text-foreground">{offering.status}</span></p>
        </div>
        <Link href="/registration" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Back to offerings</Link>
      </div>

      {canUpdate && (
        <Card>
          <CardHeader><CardTitle>Offering status</CardTitle></CardHeader>
          <CardContent><StatusControl table="programme_term_offering" id={id} current={offering.status} options={OFFERING_STATUSES} label="Change status" /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Sections and batches</CardTitle></CardHeader>
        <CardContent><SectionManager offeringId={id} sections={sections} batches={batches} canManage={canCreate} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Course offerings</CardTitle></CardHeader>
        <CardContent><CourseOfferingManager offeringId={id} offerings={courseOfferings} canManage={canUpdate} canGenerate={can(ctx, 'TEACHING.ALL.CREATE') && !closed} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Teaching sections (attendance)</CardTitle></CardHeader>
        <CardContent><TeachingSectionManager offeringId={id} courseOfferings={courseOfferings} sections={sections} batches={batches} teaching={teaching} canManage={can(ctx, 'TEACHING.ALL.CREATE')} /></CardContent>
      </Card>

      <Card className="overflow-x-auto">
        <CardHeader><CardTitle>Registered students ({roster.length})</CardTitle></CardHeader>
        <CardContent>
          {roster.length === 0 ? <p className="text-sm text-muted-foreground">No students registered for this offering yet.</p> : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left"><tr>
                <th scope="col" className="py-2 pr-4 font-medium">Student</th><th scope="col" className="py-2 pr-4 font-medium">Roll</th>
                <th scope="col" className="py-2 pr-4 font-medium">Section</th><th scope="col" className="py-2 pr-4 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.term_registration_id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4"><Link href={`/registration/term/${r.term_registration_id}`} className="text-primary underline-offset-4 hover:underline">{r.student_number} — {r.display_name}</Link></td>
                    <td className="py-2 pr-4">{r.roll_number ?? '—'}</td>
                    <td className="py-2 pr-4">{r.class_section_id ? (secName.get(r.class_section_id) ?? `#${r.class_section_id}`) : '—'}</td>
                    <td className="py-2 pr-4">{r.registration_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {canCreate && !closed && (
        <Card>
          <CardHeader><CardTitle>Register a student for this term</CardTitle></CardHeader>
          <CardContent><RegisterStudentForm offeringId={id} sections={sections} batches={batches} /></CardContent>
        </Card>
      )}
    </div>
  );
}
