'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { EmployeeLookups } from '@/features/employee-data';
import { EmployeeFields } from '@/features/employee-fields';
import { buildEmployeeRegistration } from '@/features/employee-payloads';
import { createClient } from '@/lib/supabase/client';
import { assignmentProblems, employeeCreateSchema, type EmployeeCreateInput, type EmployeeCreateValues } from '@/lib/employee-validation';

export function EmployeeCreateForm({ lookups }: { lookups: EmployeeLookups }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeCreateInput, unknown, EmployeeCreateValues>({
    resolver: zodResolver(employeeCreateSchema),
    defaultValues: { institution_id: lookups.institutions.length === 1 ? String(lookups.institutions[0]?.id) : '' },
  });

  const institutionId = Number(watch('institution_id')) || undefined;
  const campusId = Number(watch('campus_id')) || undefined;
  const campuses = useMemo(() => lookups.campuses.filter((c) => c.institutionId === institutionId), [lookups.campuses, institutionId]);
  const departments = useMemo(() => lookups.departments.filter((d) => d.campusId === campusId), [lookups.departments, campusId]);

  async function onSubmit(values: EmployeeCreateValues) {
    const problems = assignmentProblems(values);
    const keys = Object.keys(problems) as (keyof typeof problems)[];
    if (keys.length) {
      keys.forEach((k) => setError(k, { message: problems[k] }));
      return;
    }
    const { employee, assignment } = buildEmployeeRegistration(values);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('employee_register', { p_employee: employee, p_assignment: assignment });
    if (error) {
      if (error.code === '23505') setError('employee_number', { message: 'This employee number or email is already registered.' });
      else if (error.code === '42501') toast.error('You are not allowed to register employees for that institution or department.');
      else if (error.code === '22023') toast.error(error.message);
      else toast.error('Could not register the employee.');
      return;
    }
    toast.success('Employee registered.');
    router.push(`/employees/${data as number}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8" noValidate>
      <SelectField
        id="institution_id"
        label="Institution *"
        options={lookups.institutions}
        emptyHint="No institutions are visible to you."
        {...register('institution_id')}
        error={errors.institution_id?.message as string | undefined}
      />
      <EmployeeFields register={register} errors={errors} lookups={lookups} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">First assignment (optional)</legend>
        <p className="text-sm text-muted-foreground sm:col-span-2">
          Staff with department or campus scope must add the employee to an assignment within that scope. Institution-level administrators may leave this empty.
        </p>
        <SelectField
          id="campus_id"
          label="Campus"
          options={campuses}
          emptyHint={institutionId ? 'This institution has no campus yet.' : 'Select an institution first.'}
          {...register('campus_id')}
          error={errors.campus_id?.message as string | undefined}
        />
        <SelectField
          id="department_id"
          label="Department"
          options={departments}
          emptyHint={campusId ? 'This campus has no department yet.' : 'Select a campus first.'}
          {...register('department_id')}
          error={errors.department_id?.message as string | undefined}
        />
        <SelectField
          id="designation_id"
          label="Designation"
          options={lookups.designations}
          emptyHint="No designations configured."
          {...register('designation_id')}
          error={errors.designation_id?.message as string | undefined}
        />
        <TextField id="start_date" type="date" label="Start date" hint="Defaults to the joining date." {...register('start_date')} error={errors.start_date?.message as string | undefined} />
      </fieldset>

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Registering…' : 'Register employee'}
        </Button>
        <Link href="/employees" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
          Cancel
        </Link>
      </div>
    </form>
  );
}
