'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { UseFormRegister } from 'react-hook-form';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { buildStudentUpdate } from '@/features/student-payloads';
import { PersonalFields } from '@/features/student-form-shared';
import type { StudentLookups } from '@/features/students-lookups';
import { createClient } from '@/lib/supabase/client';
import { studentEditSchema, type StudentCreateInput, type StudentEditInput, type StudentEditValues } from '@/lib/validation';

export function StudentEditForm({ studentId, defaults, lookups }: { studentId: number; defaults: StudentEditInput; lookups: StudentLookups }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<StudentEditInput, unknown, StudentEditValues>({ resolver: zodResolver(studentEditSchema), defaultValues: defaults });

  async function onSubmit(values: StudentEditValues) {
    const supabase = createClient();
    // RLS decides whether this row is updatable; zero returned rows means "not found or not permitted".
    const { data, error } = await supabase.from('student').update(buildStudentUpdate(values)).eq('student_id', studentId).select('student_id');
    if (error) {
      if (error.code === '23505') setError('primary_email', { message: 'This student number or email is already in use.' });
      else toast.error('Could not save the changes.');
      return;
    }
    if (!data || data.length === 0) {
      toast.error('This record was not found, or you are not allowed to change it.');
      return;
    }
    toast.success('Changes saved.');
    router.push(`/students/${studentId}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <PersonalFields register={register as unknown as UseFormRegister<StudentCreateInput>} errors={errors as never} lookups={lookups} />
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
        <Link href={`/students/${studentId}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
          Cancel
        </Link>
      </div>
    </form>
  );
}
