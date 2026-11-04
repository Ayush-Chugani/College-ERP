import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getEmployee, loadEmployeeLookups, parseEmployeeId } from '@/features/employee-data';
import { EmployeeEditForm } from '@/features/employee-edit-form';
import { can } from '@/lib/context';
import type { EmployeeEditInput } from '@/lib/employee-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Edit employee' };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = parseEmployeeId(raw);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'EMPLOYEE.ALL.UPDATE')) notFound();
  const e = await getEmployee(supabase, id);
  if (!e) notFound();
  const lookups = await loadEmployeeLookups(supabase);
  const str = (v: string | number | null) => (v == null ? '' : String(v));
  const defaults: EmployeeEditInput = {
    employee_number: e.employee_number,
    first_name: e.first_name,
    middle_name: str(e.middle_name),
    last_name: str(e.last_name),
    display_name: e.display_name,
    date_of_birth: str(e.date_of_birth),
    gender_id: str(e.gender_id),
    blood_group_id: str(e.blood_group_id),
    religion_id: str(e.religion_id),
    social_category_id: str(e.social_category_id),
    nationality_country_id: str(e.nationality_country_id),
    primary_email: str(e.primary_email),
    primary_phone: str(e.primary_phone),
    employment_source_id: String(e.employment_source_id),
    employment_type: e.employment_type as EmployeeEditInput['employment_type'],
    joining_date: e.joining_date,
  };
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Edit {e.display_name}</h1>
      <EmployeeEditForm employeeId={id} defaults={defaults} lookups={lookups} />
    </div>
  );
}
