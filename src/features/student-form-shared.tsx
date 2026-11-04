'use client';

import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { SelectField, TextField } from '@/components/form-fields';
import type { StudentLookups } from '@/features/students-lookups';
import type { StudentCreateInput } from '@/lib/validation';

type Reg = UseFormRegister<StudentCreateInput>;
type Err = FieldErrors<StudentCreateInput>;

const msg = (e: Err, k: keyof StudentCreateInput) => (e[k]?.message as string | undefined) ?? undefined;
const NONE = 'No options have been configured yet (an administrator maintains these lists).';

/** Personal-details fields shared by the create and edit forms. */
export function PersonalFields({ register, errors, lookups }: { register: Reg; errors: Err; lookups: StudentLookups }) {
  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-semibold">Personal details</legend>
      <TextField id="student_number" label="Student number *" maxLength={30} {...register('student_number')} error={msg(errors, 'student_number')} />
      <TextField id="first_name" label="First name *" maxLength={100} autoComplete="off" {...register('first_name')} error={msg(errors, 'first_name')} />
      <TextField id="middle_name" label="Middle name" maxLength={100} {...register('middle_name')} error={msg(errors, 'middle_name')} />
      <TextField id="last_name" label="Last name" maxLength={100} {...register('last_name')} error={msg(errors, 'last_name')} />
      <TextField id="date_of_birth" type="date" label="Date of birth" {...register('date_of_birth')} error={msg(errors, 'date_of_birth')} />
      <SelectField id="gender_id" label="Gender" options={lookups.genders} emptyHint={NONE} {...register('gender_id')} error={msg(errors, 'gender_id')} />
      <SelectField id="blood_group_id" label="Blood group" options={lookups.bloodGroups} emptyHint={NONE} {...register('blood_group_id')} error={msg(errors, 'blood_group_id')} />
      <SelectField id="religion_id" label="Religion" options={lookups.religions} emptyHint={NONE} {...register('religion_id')} error={msg(errors, 'religion_id')} />
      <SelectField id="social_category_id" label="Social category" options={lookups.socialCategories} emptyHint={NONE} {...register('social_category_id')} error={msg(errors, 'social_category_id')} />
      <SelectField id="nationality_country_id" label="Nationality" options={lookups.countries} emptyHint={NONE} {...register('nationality_country_id')} error={msg(errors, 'nationality_country_id')} />
      <TextField id="primary_email" type="email" label="Email" autoComplete="off" {...register('primary_email')} error={msg(errors, 'primary_email')} />
      <TextField id="primary_phone" type="tel" label="Phone" maxLength={25} {...register('primary_phone')} error={msg(errors, 'primary_phone')} />
      <div className="sm:col-span-2">
        <label htmlFor="notes" className="mb-1 block text-sm font-medium">
          Notes
        </label>
        <textarea
          id="notes"
          rows={3}
          maxLength={2000}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          {...register('notes')}
        />
        {msg(errors, 'notes') && (
          <p role="alert" className="mt-1 text-sm text-destructive">
            {msg(errors, 'notes')}
          </p>
        )}
      </div>
    </fieldset>
  );
}
