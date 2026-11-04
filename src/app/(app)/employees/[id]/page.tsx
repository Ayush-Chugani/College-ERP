import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmployeeAssignForm } from '@/features/employee-assign-form';
import { getAssignments, getEmployee, loadEmployeeLookups, parseEmployeeId } from '@/features/employee-data';
import { EmployeeStatusControl } from '@/features/employee-status-control';
import type { Option } from '@/features/students-lookups';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Employee' };

const label = (opts: Option[], id: number | null) => (id == null ? '—' : (opts.find((o) => o.id === id)?.label ?? `#${id}`));

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = parseEmployeeId(raw);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const emp = await getEmployee(supabase, id);
  if (!emp) notFound(); // missing or not visible to this user: same response
  const [assignments, lookups] = await Promise.all([getAssignments(supabase, id), loadEmployeeLookups(supabase)]);
  const canEdit = can(ctx, 'EMPLOYEE.ALL.UPDATE');

  const rows: [string, string][] = [
    ['Employee number', emp.employee_number],
    ['Institution', label(lookups.institutions, emp.institution_id)],
    ['Full name', [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' ')],
    ['Employment source', label(lookups.sources, emp.employment_source_id)],
    ['Employment type', emp.employment_type],
    ['Joining date', emp.joining_date],
    ['Date of birth', emp.date_of_birth ?? '—'],
    ['Gender', label(lookups.genders, emp.gender_id)],
    ['Blood group', label(lookups.bloodGroups, emp.blood_group_id)],
    ['Religion', label(lookups.religions, emp.religion_id)],
    ['Social category', label(lookups.socialCategories, emp.social_category_id)],
    ['Nationality', label(lookups.countries, emp.nationality_country_id)],
    ['Email', emp.primary_email ?? '—'],
    ['Phone', emp.primary_phone ?? '—'],
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{emp.display_name}</h1>
          <p className="text-sm text-muted-foreground">
            Status: <span className="font-medium text-foreground">{emp.employment_status}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <Link href={`/employees/${id}/edit`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Edit
            </Link>
          )}
          <Link href={`/employees/${id}/records`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
            Records
          </Link>
          <Link href={`/employees/${id}/hr`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
            HR records
          </Link>
          <Link href="/employees" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
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
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Identity numbers and bank details are handled separately and are not shown here.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assignment recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {assignments.map((a) => (
                <li key={a.employee_assignment_id}>
                  <span className="font-medium">{a.designation_name ?? `Designation #${a.designation_id}`}</span>{' '}
                  <span className="text-muted-foreground">
                    · {a.campus_name ?? `Campus #${a.campus_id}`}
                    {a.department_name ? ` · ${a.department_name}` : ''} · {a.start_date} → {a.end_date ?? 'present'}
                    {a.is_primary ? ' · primary' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Add assignment</CardTitle>
            </CardHeader>
            <CardContent>
              <EmployeeAssignForm employeeId={id} institutionId={emp.institution_id} lookups={lookups} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Employment status</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">Employee records are never deleted. Change the status instead; the change is audited.</p>
              <EmployeeStatusControl employeeId={id} current={emp.employment_status} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
