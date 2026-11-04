'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, type UseFormRegister } from 'react-hook-form';
import { toast } from 'sonner';
import { TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { EmployeeLookups } from '@/features/employee-data';
import { EmployeeFields } from '@/features/employee-fields';
import { buildEmployeeUpdate } from '@/features/employee-payloads';
import { employeeEditSchema, type EmployeeCreateInput, type EmployeeEditInput, type EmployeeEditValues } from '@/lib/employee-validation';
import { createClient } from '@/lib/supabase/client';

export function EmployeeEditForm({ employeeId, defaults, lookups }: { employeeId: number; defaults: EmployeeEditInput; lookups: EmployeeLookups }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeEditInput, unknown, EmployeeEditValues>({ resolver: zodResolver(employeeEditSchema), defaultValues: defaults });

  async function onSubmit(values: EmployeeEditValues) {
    const supabase = createClient();
    // RLS decides whether this row is updatable; zero returned rows means "not found or not permitted".
    const { data, error } = await supabase.from('employee').update(buildEmployeeUpdate(values)).eq('employee_id', employeeId).select('employee_id');
    if (error) {
      if (error.code === '23505') setError('primary_email', { message: 'This employee number or email is already in use.' });
      else toast.error('Could not save the changes.');
      return;
    }
    if (!data || data.length === 0) {
      toast.error('This record was not found, or you are not allowed to change it.');
      return;
    }
    toast.success('Changes saved.');
    router.push(`/employees/${employeeId}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <EmployeeFields register={register as unknown as UseFormRegister<EmployeeCreateInput>} errors={errors as never} lookups={lookups} />
      <TextField
        id="display_name"
        label="Display name *"
        maxLength={250}
        hint="Shown in lists and reports. Edit only if it should differ from the full name."
        {...register('display_name')}
        error={errors.display_name?.message}
      />
      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </Button>
        <Link href={`/employees/${employeeId}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
          Cancel
        </Link>
      </div>
    </form>
  );
}
