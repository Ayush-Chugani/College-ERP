'use client';

import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { SelectField, TextField } from '@/components/form-fields';
import { FieldError, Label } from '@/components/ui/input';
import type { EmployeeLookups } from '@/features/employee-data';
import { EMPLOYMENT_TYPES, type EmployeeCreateInput } from '@/lib/employee-validation';

export type Reg = UseFormRegister<EmployeeCreateInput>;
export type Err = FieldErrors<EmployeeCreateInput>;
const msg = (e: Err, k: keyof EmployeeCreateInput) => (e[k]?.message as string | undefined) ?? undefined;
const NONE = 'No options have been configured yet (an administrator maintains these lists).';

/** Employment + personal fields shared by the register and edit forms. */
export function EmployeeFields({ register, errors, lookups }: { register: Reg; errors: Err; lookups: EmployeeLookups }) {
  return (
    <>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Employment</legend>
        <TextField id="employee_number" label="Employee number *" maxLength={30} {...register('employee_number')} error={msg(errors, 'employee_number')} />
        <TextField id="joining_date" type="date" label="Joining date *" {...register('joining_date')} error={msg(errors, 'joining_date')} />
        <SelectField id="employment_source_id" label="Employment source *" options={lookups.sources} emptyHint={NONE} {...register('employment_source_id')} error={msg(errors, 'employment_source_id')} />
        <div>
          <Label htmlFor="employment_type">Employment type *</Label>
          <select id="employment_type" aria-invalid={!!errors.employment_type} className="flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm" {...register('employment_type')}>
            <option value="">— select —</option>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <FieldError message={msg(errors, 'employment_type')} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Personal details</legend>
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
      </fieldset>
    </>
  );
}
