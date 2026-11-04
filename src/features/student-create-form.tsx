'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { buildRegistration } from '@/features/student-payloads';
import { PersonalFields } from '@/features/student-form-shared';
import type { StudentLookups } from '@/features/students-lookups';
import { createClient } from '@/lib/supabase/client';
import { enrolmentProblems, studentCreateSchema, type StudentCreateInput, type StudentCreateValues } from '@/lib/validation';

export function StudentCreateForm({ lookups }: { lookups: StudentLookups }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<StudentCreateInput, unknown, StudentCreateValues>({ resolver: zodResolver(studentCreateSchema) });

  const programmeId = Number(watch('programme_id')) || undefined;
  const schemes = useMemo(() => lookups.schemes.filter((s) => s.programmeId === programmeId), [lookups.schemes, programmeId]);

  async function onSubmit(values: StudentCreateValues) {
    const problems = enrolmentProblems(values);
    const keys = Object.keys(problems) as (keyof typeof problems)[];
    if (keys.length) {
      keys.forEach((k) => setError(k, { message: problems[k] }));
      return;
    }
    const { student, enrolment } = buildRegistration(values);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('student_register', { p_student: student, p_enrolment: enrolment });
    if (error) {
      if (error.code === '23505') setError('student_number', { message: 'This student number or email is already registered.' });
      else if (error.code === '42501')
        toast.error(enrolment ? 'You are not allowed to register students in that programme.' : 'Select a programme: only global administrators can register a student without an enrolment.');
      else if (error.code === '22023' || error.code === '45000') toast.error(error.message);
      else toast.error('Could not register the student.');
      return;
    }
    toast.success('Student registered.');
    router.push(`/students/${data as number}`);
    router.refresh();
  }

  const noProgrammes = lookups.programmes.length === 0;
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8" noValidate>
      <PersonalFields register={register} errors={errors} lookups={lookups} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">First programme enrolment</legend>
        <p className="text-sm text-muted-foreground sm:col-span-2">
          Staff can register students only into programmes within their scope, so choose a programme. Leave this section empty only if you hold a global
          administrator role.
        </p>
        <SelectField
          id="programme_id"
          label="Programme"
          options={lookups.programmes}
          emptyHint={noProgrammes ? 'No programmes are visible to you.' : undefined}
          {...register('programme_id')}
          error={errors.programme_id?.message as string | undefined}
        />
        <SelectField
          id="curriculum_scheme_id"
          label="Curriculum scheme"
          options={schemes}
          emptyHint={programmeId ? 'This programme has no curriculum scheme yet.' : 'Select a programme first.'}
          {...register('curriculum_scheme_id')}
          error={errors.curriculum_scheme_id?.message as string | undefined}
        />
        <SelectField
          id="admission_academic_year_id"
          label="Admission academic year"
          options={lookups.academicYears}
          emptyHint="No academic years exist yet."
          {...register('admission_academic_year_id')}
          error={errors.admission_academic_year_id?.message as string | undefined}
        />
        <SelectField
          id="admission_semester_id"
          label="Admission semester"
          options={lookups.semesters}
          emptyHint="No semesters exist yet."
          {...register('admission_semester_id')}
          error={errors.admission_semester_id?.message as string | undefined}
        />
        <TextField id="admission_date" type="date" label="Admission date" {...register('admission_date')} error={errors.admission_date?.message as string | undefined} />
      </fieldset>

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Registering…' : 'Register student'}
        </Button>
        <Link href="/students" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
          Cancel
        </Link>
      </div>
    </form>
  );
}
