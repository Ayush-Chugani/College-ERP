'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { DeleteButton } from '@/features/academic-forms';
import type { AdmissionLookups, Opt } from '@/features/admission-data';
import {
  admissionCategorySchema,
  admitSchema,
  applicantEditSchema,
  applicationEditSchema,
  applySchema,
  nullable,
  type AdmissionCategoryInput,
  type AdmissionCategoryValues,
  type AdmitInput,
  type AdmitValues,
  type ApplicantEditInput,
  type ApplicantEditValues,
  type ApplicationEditInput,
  type ApplicationEditValues,
  type ApplyInput,
  type ApplyValues,
} from '@/lib/admission-validation';
import { createClient } from '@/lib/supabase/client';

type RpcError = { code?: string; message: string };

/** Map an RPC failure to a user-facing message. Business-rule messages come from the database and are safe to show. */
function rpcMessage(e: RpcError, fallback: string): string {
  if (e.code === '42501') return 'You are not allowed to do that for this programme or application.';
  if (e.code === '23505') return e.message;
  if (e.code === '22023' || e.code === '45000') return e.message;
  if (e.code === '23503') return 'A selected option does not exist (check the programme, scheme, year and semester).';
  return fallback;
}

const NONE = 'Not configured yet (an administrator maintains this list).';

function Area({ id, label, error, ...rest }: { id: string; label: string; error?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="sm:col-span-2">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <textarea id={id} rows={3} maxLength={2000} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm" {...rest} />
      {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function ApplyForm({ lookups }: { lookups: AdmissionLookups }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ApplyInput, unknown, ApplyValues>({
    resolver: zodResolver(applySchema),
    defaultValues: { application_date: today },
  });
  const e = errors as Record<string, { message?: string } | undefined>;

  async function onSubmit(v: ApplyValues) {
    const applicant = {
      first_name: v.first_name, middle_name: v.middle_name, last_name: v.last_name, date_of_birth: v.date_of_birth, gender_id: v.gender_id,
      primary_email: v.primary_email, primary_phone: v.primary_phone, nationality_country_id: v.nationality_country_id, social_category_id: v.social_category_id,
    };
    const application = {
      application_number: v.application_number, programme_id: v.programme_id, academic_year_id: v.academic_year_id,
      admission_category_id: v.admission_category_id, application_date: v.application_date, remarks: v.remarks,
    };
    const { data, error } = await createClient().rpc('admission_apply', { p_applicant: applicant, p_application: application });
    if (error) return void toast.error(rpcMessage(error, 'Could not register the application.'));
    toast.success('Application registered as a draft.');
    router.push(`/admissions/${data as number}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8" noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Application</legend>
        <TextField id="application_number" label="Application number *" maxLength={30} {...register('application_number')} error={e.application_number?.message} />
        <TextField id="application_date" type="date" label="Application date *" {...register('application_date')} error={e.application_date?.message} />
        <SelectField id="programme_id" label="Programme *" options={lookups.programmes} emptyHint="No programmes are visible to you." {...register('programme_id')} error={e.programme_id?.message} />
        <SelectField id="academic_year_id" label="Academic year *" options={lookups.years} emptyHint="No academic years exist yet." {...register('academic_year_id')} error={e.academic_year_id?.message} />
        <SelectField id="admission_category_id" label="Admission category" options={lookups.categories} emptyHint={NONE} {...register('admission_category_id')} error={e.admission_category_id?.message} />
        <Area id="remarks" label="Remarks" {...register('remarks')} error={e.remarks?.message} />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Applicant</legend>
        <TextField id="first_name" label="First name *" maxLength={100} autoComplete="off" {...register('first_name')} error={e.first_name?.message} />
        <TextField id="middle_name" label="Middle name" maxLength={100} {...register('middle_name')} error={e.middle_name?.message} />
        <TextField id="last_name" label="Last name" maxLength={100} {...register('last_name')} error={e.last_name?.message} />
        <TextField id="date_of_birth" type="date" label="Date of birth" {...register('date_of_birth')} error={e.date_of_birth?.message} />
        <SelectField id="gender_id" label="Gender" options={lookups.genders} emptyHint={NONE} {...register('gender_id')} error={e.gender_id?.message} />
        <SelectField id="nationality_country_id" label="Nationality" options={lookups.countries} emptyHint={NONE} {...register('nationality_country_id')} error={e.nationality_country_id?.message} />
        <SelectField id="social_category_id" label="Social category" options={lookups.socialCategories} emptyHint={NONE} {...register('social_category_id')} error={e.social_category_id?.message} />
        <TextField id="primary_email" type="email" label="Email" autoComplete="off" {...register('primary_email')} error={e.primary_email?.message} />
        <TextField id="primary_phone" type="tel" label="Phone" maxLength={25} {...register('primary_phone')} error={e.primary_phone?.message} />
      </fieldset>
      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Register application'}</Button>
        <Link href="/admissions" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Cancel</Link>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function ApplicantEditForm({ applicantId, defaults, lookups }: { applicantId: number; defaults: ApplicantEditInput; lookups: AdmissionLookups }) {
  const router = useRouter();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ApplicantEditInput, unknown, ApplicantEditValues>({ resolver: zodResolver(applicantEditSchema), defaultValues: defaults });
  const e = errors as Record<string, { message?: string } | undefined>;

  async function onSubmit(v: ApplicantEditValues) {
    // every field is sent; blank optional fields are sent as null so they are actually cleared
    const p = {
      first_name: v.first_name, middle_name: nullable(v.middle_name), last_name: nullable(v.last_name), date_of_birth: nullable(v.date_of_birth), gender_id: nullable(v.gender_id),
      primary_email: nullable(v.primary_email), primary_phone: nullable(v.primary_phone), nationality_country_id: nullable(v.nationality_country_id), social_category_id: nullable(v.social_category_id),
    };
    const { error } = await createClient().rpc('admission_update_applicant', { p_applicant_id: applicantId, p });
    if (error) return void toast.error(rpcMessage(error, 'Could not save the applicant.'));
    toast.success('Applicant updated.');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <TextField id="a_first" label="First name *" maxLength={100} {...register('first_name')} error={e.first_name?.message} />
      <TextField id="a_middle" label="Middle name" maxLength={100} {...register('middle_name')} error={e.middle_name?.message} />
      <TextField id="a_last" label="Last name" maxLength={100} {...register('last_name')} error={e.last_name?.message} />
      <TextField id="a_dob" type="date" label="Date of birth" {...register('date_of_birth')} error={e.date_of_birth?.message} />
      <SelectField id="a_gender" label="Gender" options={lookups.genders} emptyHint={NONE} {...register('gender_id')} error={e.gender_id?.message} />
      <SelectField id="a_nat" label="Nationality" options={lookups.countries} emptyHint={NONE} {...register('nationality_country_id')} error={e.nationality_country_id?.message} />
      <SelectField id="a_cat" label="Social category" options={lookups.socialCategories} emptyHint={NONE} {...register('social_category_id')} error={e.social_category_id?.message} />
      <TextField id="a_email" type="email" label="Email" {...register('primary_email')} error={e.primary_email?.message} />
      <TextField id="a_phone" type="tel" label="Phone" maxLength={25} {...register('primary_phone')} error={e.primary_phone?.message} />
      <div className="sm:col-span-2"><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save applicant'}</Button></div>
    </form>
  );
}

export function ApplicationEditForm({ applicationId, defaults, categories }: { applicationId: number; defaults: ApplicationEditInput; categories: Opt[] }) {
  const router = useRouter();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ApplicationEditInput, unknown, ApplicationEditValues>({ resolver: zodResolver(applicationEditSchema), defaultValues: defaults });
  async function onSubmit(v: ApplicationEditValues) {
    const { error } = await createClient().rpc('admission_update_application', { p_application_id: applicationId, p: { admission_category_id: nullable(v.admission_category_id), remarks: nullable(v.remarks) } });
    if (error) return void toast.error(rpcMessage(error, 'Could not save the application.'));
    toast.success('Application updated.');
    router.refresh();
  }
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <SelectField id="e_cat" label="Admission category" options={categories} emptyHint={NONE} {...register('admission_category_id')} error={errors.admission_category_id?.message as string | undefined} />
      <Area id="e_remarks" label="Remarks" {...register('remarks')} error={errors.remarks?.message as string | undefined} />
      <div className="sm:col-span-2"><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save application'}</Button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------
const SEVERE = ['REJECTED', 'CANCELLED', 'INELIGIBLE'];

/** Status buttons: only the transitions this user may request (the database re-checks them). Each needs a confirmation. */
export function StatusActions({ applicationId, current, next }: { applicationId: number; current: string; next: string[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  async function apply() {
    if (!target) return;
    setBusy(true);
    const { error } = await createClient().rpc('admission_set_status', { p_application_id: applicationId, p_new_status: target, p_remarks: remarks.trim() || null });
    setBusy(false);
    if (error) return void toast.error(rpcMessage(error, 'The status could not be changed.'));
    toast.success(`Status changed to ${target}.`);
    setTarget(null);
    setRemarks('');
    router.refresh();
  }

  if (next.length === 0) return <p className="text-sm text-muted-foreground">No further status changes are available to you for a {current} application.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {next.map((s) => (
          <Button key={s} type="button" variant={s === target ? 'default' : 'outline'} onClick={() => setTarget(s)}>
            Mark {s.replace('_', ' ').toLowerCase()}
          </Button>
        ))}
      </div>
      {target && (
        <div role="alertdialog" aria-label="Confirm status change" className="space-y-2 rounded-md border border-border bg-muted p-3 text-sm">
          <p>Change status from <strong>{current}</strong> to <strong>{target}</strong>? This is recorded in the audit log.</p>
          <label htmlFor="status_remarks" className="block text-sm font-medium">Remarks (optional)</label>
          <textarea id="status_remarks" rows={2} maxLength={2000} value={remarks} onChange={(ev) => setRemarks(ev.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <Button type="button" variant={SEVERE.includes(target) ? 'destructive' : 'default'} disabled={busy} onClick={apply}>{busy ? 'Applying…' : 'Confirm'}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setTarget(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AdmitForm({ applicationId, programmeId, lookups }: { applicationId: number; programmeId: number; lookups: AdmissionLookups }) {
  const router = useRouter();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AdmitInput, unknown, AdmitValues>({ resolver: zodResolver(admitSchema) });
  const schemes = useMemo(() => lookups.schemes.filter((s) => s.programmeId === programmeId), [lookups.schemes, programmeId]);
  const e = errors as Record<string, { message?: string } | undefined>;

  async function onSubmit(v: AdmitValues) {
    const { data, error } = await createClient().rpc('admission_admit', {
      p_application_id: applicationId,
      p_student: { student_number: v.student_number },
      p_enrolment: { curriculum_scheme_id: v.curriculum_scheme_id, admission_academic_year_id: v.admission_academic_year_id, admission_semester_id: v.admission_semester_id, admission_date: v.admission_date },
    });
    if (error) return void toast.error(rpcMessage(error, 'Could not admit the applicant.'));
    toast.success('Applicant admitted and student record created.');
    router.push(`/students/${data as number}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <p className="text-sm text-muted-foreground sm:col-span-2">Creates the student record from the applicant&apos;s details and enrols them in this programme, in one step. If anything fails nothing is saved.</p>
      <TextField id="student_number" label="Student number *" maxLength={30} {...register('student_number')} error={e.student_number?.message} />
      <SelectField id="scheme" label="Curriculum scheme *" options={schemes} emptyHint="This programme has no curriculum scheme yet." {...register('curriculum_scheme_id')} error={e.curriculum_scheme_id?.message} />
      <SelectField id="adm_year" label="Admission academic year *" options={lookups.years} emptyHint="No academic years exist yet." {...register('admission_academic_year_id')} error={e.admission_academic_year_id?.message} />
      <SelectField id="adm_sem" label="Admission semester *" options={lookups.semesters} emptyHint="No semesters exist yet." {...register('admission_semester_id')} error={e.admission_semester_id?.message} />
      <TextField id="adm_date" type="date" label="Admission date" hint="Defaults to today if left blank." {...register('admission_date')} error={e.admission_date?.message} />
      <div className="sm:col-span-2"><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Admitting…' : 'Admit and create student'}</Button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------
type CategoryItem = { admission_category_id: number; category_code: string; category_name: string; description: string | null; is_active: boolean };

export function AdmissionCategoryManager({ categories, canManage }: { categories: CategoryItem[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const add = useForm<AdmissionCategoryInput, unknown, AdmissionCategoryValues>({ resolver: zodResolver(admissionCategorySchema), defaultValues: { is_active: true } });
  const edit = useForm<AdmissionCategoryInput, unknown, AdmissionCategoryValues>({ resolver: zodResolver(admissionCategorySchema) });
  const fail = (e: RpcError) => toast.error(e.code === '23505' ? 'That code or name already exists.' : e.code === '42501' ? 'You are not allowed to change categories.' : 'Could not save the category.');

  async function create(v: AdmissionCategoryValues) {
    const { error } = await createClient().from('admission_category').insert({ ...v, description: nullable(v.description) });
    if (error) return void fail(error);
    toast.success('Category added.');
    add.reset({ category_code: '', category_name: '', description: '', is_active: true });
    router.refresh();
  }
  async function save(id: number, v: AdmissionCategoryValues) {
    const { data, error } = await createClient().from('admission_category').update({ ...v, description: nullable(v.description) }).eq('admission_category_id', id).select('admission_category_id');
    if (error) return void fail(error);
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success('Category updated.');
    setEditing(null);
    router.refresh();
  }
  const fields = (f: typeof add, p: string) => (
    <>
      <TextField id={`${p}code`} label="Code *" className="w-32" maxLength={30} {...f.register('category_code')} error={f.formState.errors.category_code?.message} />
      <TextField id={`${p}name`} label="Name *" className="w-56" maxLength={100} {...f.register('category_name')} error={f.formState.errors.category_name?.message} />
      <TextField id={`${p}desc`} label="Description" className="w-64" maxLength={500} {...f.register('description')} error={f.formState.errors.description?.message} />
      <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" {...f.register('is_active')} /> Active</label>
    </>
  );

  return (
    <div className="space-y-4">
      {categories.length === 0 ? <p className="text-sm text-muted-foreground">No admission categories defined yet.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {categories.map((c) => (
            <li key={c.admission_category_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              {editing === c.admission_category_id ? (
                <form onSubmit={edit.handleSubmit((v) => save(c.admission_category_id, v))} className="flex flex-wrap items-start gap-3" noValidate>
                  {fields(edit, `e${c.admission_category_id}`)}
                  <div className="flex gap-2 pt-6"><Button type="submit">Save</Button><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div>
                </form>
              ) : (
                <>
                  <span><span className="font-medium">{c.category_name}</span> <span className="text-muted-foreground">({c.category_code}){c.is_active ? '' : ' · inactive'}{c.description ? ` · ${c.description}` : ''}</span></span>
                  {canManage && (
                    <span className="flex items-start gap-2">
                      <Button type="button" variant="outline" onClick={() => { edit.reset({ category_code: c.category_code, category_name: c.category_name, description: c.description ?? '', is_active: c.is_active }); setEditing(c.admission_category_id); }}>Edit</Button>
                      <DeleteButton table="admission_category" id={c.admission_category_id} label="category" />
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={add.handleSubmit(create)} className="flex flex-wrap items-start gap-3" noValidate>
          {fields(add, 'new')}
          <div className="pt-6"><Button type="submit" disabled={add.formState.isSubmitting}>Add category</Button></div>
        </form>
      )}
    </div>
  );
}
