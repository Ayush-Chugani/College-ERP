import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadEmployeeLookups } from '@/features/employee-data';
import { EmployeeCreateForm } from '@/features/employee-create-form';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Register employee' };

export default async function NewEmployeePage() {
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'EMPLOYEE.ALL.CREATE')) notFound();
  const lookups = await loadEmployeeLookups(supabase);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Register employee</h1>
      <EmployeeCreateForm lookups={lookups} />
    </div>
  );
}
