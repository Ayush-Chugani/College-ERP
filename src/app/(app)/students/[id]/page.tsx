import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getEnrolments, getStudent, parseStudentId } from '@/features/student-detail';
import { StudentStatusControl } from '@/features/student-status-control';
import { loadStudentLookups, type Option } from '@/features/students-lookups';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Student' };

const label = (opts: Option[], id: number | null) => (id == null ? '—' : (opts.find((o) => o.id === id)?.label ?? `#${id}`));

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = parseStudentId(raw);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const student = await getStudent(supabase, id);
  if (!student) notFound(); // missing or not visible to this user: same response
  const [enrolments, lookups] = await Promise.all([getEnrolments(supabase, id), loadStudentLookups(supabase)]);
  const canEdit = can(ctx, 'STUDENT.ALL.UPDATE');

  const rows: [string, string][] = [
    ['Student number', student.student_number],
    ['University seat no.', student.university_seat_number ?? '—'],
    ['Full name', [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ')],
    ['Date of birth', student.date_of_birth ?? '—'],
    ['Gender', label(lookups.genders, student.gender_id)],
    ['Blood group', label(lookups.bloodGroups, student.blood_group_id)],
    ['Religion', label(lookups.religions, student.religion_id)],
    ['Social category', label(lookups.socialCategories, student.social_category_id)],
    ['Nationality', label(lookups.countries, student.nationality_country_id)],
    ['Email', student.primary_email ?? '—'],
    ['Phone', student.primary_phone ?? '—'],
    ['Admission date', student.admission_date ?? '—'],
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{student.display_name}</h1>
          <p className="text-sm text-muted-foreground">
            Status: <span className="font-medium text-foreground">{student.student_status}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <Link href={`/students/${id}/edit`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Edit
            </Link>
          )}
          <Link href="/students" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
            Back to list
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            {student.notes && (
              <div className="contents">
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="whitespace-pre-wrap">{student.notes}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Programme enrolments</CardTitle>
        </CardHeader>
        <CardContent>
          {enrolments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No programme enrolment recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {enrolments.map((e) => (
                <li key={e.enrolment_id}>
                  <span className="font-medium">{e.programme_name ?? `Programme #${e.programme_id}`}</span>{' '}
                  <span className="text-muted-foreground">
                    · admitted {e.admission_date} · {e.enrolment_status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Student records are never deleted. Deactivate a student by changing their status; the change is audited.</p>
            <StudentStatusControl studentId={id} current={student.student_status} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
