'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { EmployeeLookups } from '@/features/employee-data';
import { buildAssignArgs } from '@/features/employee-payloads';
import { assignSchema, type AssignInput, type AssignValues } from '@/lib/employee-validation';
import { createClient } from '@/lib/supabase/client';

export function EmployeeAssignForm({ employeeId, institutionId, lookups }: { employeeId: number; institutionId: number; lookups: EmployeeLookups }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AssignInput, unknown, AssignValues>({ resolver: zodResolver(assignSchema), defaultValues: { is_primary: true, end_current: false } });

  const campusId = Number(watch('campus_id')) || undefined;
  const campuses = useMemo(() => lookups.campuses.filter((c) => c.institutionId === institutionId), [lookups.campuses, institutionId]);
  const departments = useMemo(() => lookups.departments.filter((d) => d.campusId === campusId), [lookups.departments, campusId]);

  async function onSubmit(values: AssignValues) {
    const supabase = createClient();
    const { error } = await supabase.rpc('employee_assign', buildAssignArgs(employeeId, values));
    if (error) {
      if (error.code === '42501') toast.error('You are not allowed to change assignments for this employee or campus/department.');
      else if (error.code === '45000' || error.code === '22023') toast.error(error.message);
      else if (error.code === '23505') toast.error('The employee already has a conflicting current primary assignment.');
      else toast.error('Could not add the assignment.');
      return;
    }
    toast.success('Assignment added.');
    reset({ is_primary: true, end_current: false });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <SelectField id="a_campus" label="Campus *" options={campuses} emptyHint="No campus is available for this institution." {...register('campus_id')} error={errors.campus_id?.message as string | undefined} />
      <SelectField
        id="a_department"
        label="Department"
        options={departments}
        emptyHint={campusId ? 'This campus has no department yet.' : 'Select a campus first.'}
        {...register('department_id')}
        error={errors.department_id?.message as string | undefined}
      />
      <SelectField id="a_designation" label="Designation *" options={lookups.designations} emptyHint="No designations configured." {...register('designation_id')} error={errors.designation_id?.message as string | undefined} />
      <TextField id="a_start" type="date" label="Start date *" {...register('start_date')} error={errors.start_date?.message as string | undefined} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...register('is_primary')} /> Primary assignment
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...register('end_current')} /> End the current primary assignment the day before
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Adding…' : 'Add assignment'}
        </Button>
      </div>
    </form>
  );
}
