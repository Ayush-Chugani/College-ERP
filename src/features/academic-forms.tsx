'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import {
  nul,
  schemeSchema,
  semesterSchema,
  SCHEME_STATUSES,
  termSchema,
  TERM_STATUSES,
  TERM_TYPES,
  yearSchema,
  YEAR_STATUSES,
  type SchemeInput,
  type SchemeValues,
  type SemesterInput,
  type SemesterValues,
  type TermInput,
  type TermValues,
  type YearInput,
  type YearValues,
} from '@/lib/academic-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };

/** Friendly message for a failed write. Row-level security failures are reported as "not allowed", never silently ignored. */
function writeError(e: DbError, noun: string): string {
  if (e.code === '23505') return `That ${noun} code or number already exists.`;
  if (e.code === '23514') return 'The values break a database rule (check the dates and options).';
  if (e.code === '23503') return `This ${noun} is in use by other records and cannot be removed or changed that way.`;
  if (e.code === '42501') return `You are not allowed to change ${noun}s here.`;
  return `Could not save the ${noun}.`;
}

function StatusSelect({ id, label, values, ...rest }: { id: string; label: string; values: readonly string[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className="flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm" {...rest}>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}

function FormButtons({ busy, cancelHref, label }: { busy: boolean; cancelHref: string; label: string }) {
  return (
    <div className="flex gap-3">
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : label}
      </Button>
      <Link href={cancelHref} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
        Cancel
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
export type DeletableTable = 'academic_year' | 'academic_term' | 'semester' | 'curriculum_scheme' | 'university' | 'campus' | 'department' | 'programme' | 'course_category' | 'course_catalog' | 'curriculum_course' | 'admission_category' | 'class_section' | 'class_batch' | 'course_offering' | 'student_course_registration' | 'faculty_course_assignment' | 'course_offering_section' | 'class_session' | 'attendance_status' | 'assessment_component' | 'assessment_event' | 'grade_scale' | 'grade_rule';
const PK: Record<DeletableTable, string> = { academic_year: 'academic_year_id', academic_term: 'academic_term_id', semester: 'semester_id', curriculum_scheme: 'curriculum_scheme_id',
  university: 'university_id', campus: 'campus_id', department: 'department_id', programme: 'programme_id',
  course_category: 'course_category_id', course_catalog: 'course_id', curriculum_course: 'curriculum_course_id', admission_category: 'admission_category_id',
  class_section: 'class_section_id', class_batch: 'class_batch_id', course_offering: 'course_offering_id', student_course_registration: 'course_registration_id',
  faculty_course_assignment: 'faculty_assignment_id', course_offering_section: 'course_offering_section_id', class_session: 'class_session_id', attendance_status: 'attendance_status_id',
  assessment_component: 'assessment_component_id', assessment_event: 'assessment_event_id', grade_scale: 'grade_scale_id', grade_rule: 'grade_rule_id',
};

/** Delete with explicit confirmation. The database refuses rows that are still referenced (foreign keys) or not permitted (RLS). */
export function DeleteButton({ table, id, label, redirectTo }: { table: DeletableTable; id: number; label: string; redirectTo?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const { data, error } = await createClient().from(table).delete().eq(PK[table], id).select(PK[table]);
    setBusy(false);
    if (error) return void toast.error(writeError(error, label));
    if (!data || data.length === 0) return void toast.error(`This ${label} was not found, or you are not allowed to delete it.`);
    toast.success(`${label[0]?.toUpperCase()}${label.slice(1)} deleted.`);
    setConfirming(false);
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }

  if (!confirming)
    return (
      <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
        Delete {label}…
      </Button>
    );
  return (
    <div role="alertdialog" aria-label={`Confirm delete ${label}`} className="rounded-md border border-border bg-muted p-3 text-sm">
      <p className="mb-2">Delete this {label} permanently? This cannot be undone and is recorded in the audit log. It will be refused if other records use it.</p>
      <div className="flex gap-2">
        <Button type="button" variant="destructive" disabled={busy} onClick={remove}>
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function YearForm({ id, defaults }: { id?: number; defaults?: YearInput }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<YearInput, unknown, YearValues>({ resolver: zodResolver(yearSchema), defaultValues: defaults ?? { status: 'PLANNED' } });

  async function onSubmit(v: YearValues) {
    const supabase = createClient();
    const q = id ? supabase.from('academic_year').update(v).eq('academic_year_id', id) : supabase.from('academic_year').insert(v);
    const { data, error } = await q.select('academic_year_id');
    if (error) return void toast.error(writeError(error, 'academic year'));
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success(id ? 'Academic year updated.' : 'Academic year created.');
    router.push(`/calendar/years/${(data[0] as { academic_year_id: number }).academic_year_id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <TextField id="year_code" label="Year code *" hint="e.g. 2025-26" maxLength={9} {...register('year_code')} error={errors.year_code?.message} />
      <StatusSelect id="status" label="Status" values={YEAR_STATUSES} {...register('status')} />
      <TextField id="start_date" type="date" label="Start date *" {...register('start_date')} error={errors.start_date?.message} />
      <TextField id="end_date" type="date" label="End date *" {...register('end_date')} error={errors.end_date?.message} />
      <div className="sm:col-span-2">
        <FormButtons busy={isSubmitting} cancelHref={id ? `/calendar/years/${id}` : '/calendar'} label={id ? 'Save changes' : 'Create academic year'} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function TermForm({ yearId, id, defaults }: { yearId: number; id?: number; defaults?: TermInput }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TermInput, unknown, TermValues>({ resolver: zodResolver(termSchema), defaultValues: defaults ?? { status: 'PLANNED' } });

  async function onSubmit(v: TermValues) {
    const row = { ...v, registration_start_date: nul(v.registration_start_date), registration_end_date: nul(v.registration_end_date) };
    const supabase = createClient();
    const q = id ? supabase.from('academic_term').update(row).eq('academic_term_id', id) : supabase.from('academic_term').insert({ ...row, academic_year_id: yearId });
    const { data, error } = await q.select('academic_term_id');
    if (error) return void toast.error(writeError(error, 'term'));
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success(id ? 'Term updated.' : 'Term added.');
    if (id) router.push(`/calendar/years/${yearId}`);
    else reset({ status: 'PLANNED' });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <TextField id="term_code" label="Term code *" maxLength={20} {...register('term_code')} error={errors.term_code?.message} />
      <TextField id="term_name" label="Term name *" maxLength={100} {...register('term_name')} error={errors.term_name?.message} />
      <div>
        <Label htmlFor="term_type">Term type *</Label>
        <select id="term_type" aria-invalid={!!errors.term_type} className="flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm" {...register('term_type')}>
          <option value="">— select —</option>
          {TERM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {errors.term_type && (
          <p role="alert" className="mt-1 text-sm text-destructive">
            {errors.term_type.message}
          </p>
        )}
      </div>
      <StatusSelect id="term_status" label="Status" values={TERM_STATUSES} {...register('status')} />
      <TextField id="t_start" type="date" label="Start date *" {...register('start_date')} error={errors.start_date?.message} />
      <TextField id="t_end" type="date" label="End date *" {...register('end_date')} error={errors.end_date?.message} />
      <TextField id="t_rstart" type="date" label="Registration opens" {...register('registration_start_date')} error={errors.registration_start_date?.message} />
      <TextField id="t_rend" type="date" label="Registration closes" {...register('registration_end_date')} error={errors.registration_end_date?.message} />
      <div className="sm:col-span-2">
        <FormButtons busy={isSubmitting} cancelHref={`/calendar/years/${yearId}`} label={id ? 'Save changes' : 'Add term'} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export type SemesterItem = { semester_id: number; semester_number: number; semester_name: string };

/** Semesters are a short list: add, rename and delete in place. */
export function SemesterManager({ semesters, canManage }: { semesters: SemesterItem[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const create = useForm<SemesterInput, unknown, SemesterValues>({ resolver: zodResolver(semesterSchema) });
  const edit = useForm<SemesterInput, unknown, SemesterValues>({ resolver: zodResolver(semesterSchema) });

  async function add(v: SemesterValues) {
    const { error } = await createClient().from('semester').insert(v);
    if (error) return void toast.error(error.code === '23505' ? 'That semester number or name already exists.' : writeError(error, 'semester'));
    toast.success('Semester added.');
    create.reset({ semester_number: '', semester_name: '' });
    router.refresh();
  }
  async function save(id: number, v: SemesterValues) {
    const { data, error } = await createClient().from('semester').update(v).eq('semester_id', id).select('semester_id');
    if (error) return void toast.error(error.code === '23505' ? 'That semester number or name already exists.' : writeError(error, 'semester'));
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success('Semester updated.');
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {semesters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No semesters defined yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {semesters.map((s) => (
            <li key={s.semester_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              {editing === s.semester_id ? (
                <form onSubmit={edit.handleSubmit((v) => save(s.semester_id, v))} className="flex flex-wrap items-start gap-2" noValidate>
                  <TextField id={`n${s.semester_id}`} label="No." className="w-24" {...edit.register('semester_number')} error={edit.formState.errors.semester_number?.message} />
                  <TextField id={`m${s.semester_id}`} label="Name" className="w-56" {...edit.register('semester_name')} error={edit.formState.errors.semester_name?.message} />
                  <div className="flex gap-2 pt-6">
                    <Button type="submit">Save</Button>
                    <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <span>
                    <span className="font-medium">{s.semester_number}.</span> {s.semester_name}
                  </span>
                  {canManage && (
                    <span className="flex items-start gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          edit.reset({ semester_number: String(s.semester_number), semester_name: s.semester_name });
                          setEditing(s.semester_id);
                        }}
                      >
                        Edit
                      </Button>
                      <DeleteButton table="semester" id={s.semester_id} label="semester" />
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={create.handleSubmit(add)} className="flex flex-wrap items-start gap-2" noValidate>
          <TextField id="new_sem_no" label="Number *" className="w-24" {...create.register('semester_number')} error={create.formState.errors.semester_number?.message} />
          <TextField id="new_sem_name" label="Name *" className="w-56" maxLength={50} {...create.register('semester_name')} error={create.formState.errors.semester_name?.message} />
          <div className="pt-6">
            <Button type="submit" disabled={create.formState.isSubmitting}>
              Add semester
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function SchemeForm({ id, defaults, programmes }: { id?: number; defaults?: SchemeInput; programmes: { id: number; label: string }[] }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SchemeInput, unknown, SchemeValues>({ resolver: zodResolver(schemeSchema), defaultValues: defaults ?? { status: 'DRAFT' } });

  async function onSubmit(v: SchemeValues) {
    const row = { ...v, total_credits: nul(v.total_credits), effective_to: nul(v.effective_to) };
    const supabase = createClient();
    const q = id ? supabase.from('curriculum_scheme').update(row).eq('curriculum_scheme_id', id) : supabase.from('curriculum_scheme').insert(row);
    const { data, error } = await q.select('curriculum_scheme_id');
    if (error) return void toast.error(writeError(error, 'curriculum scheme'));
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success(id ? 'Scheme updated.' : 'Scheme created.');
    router.push(`/curriculum/${(data[0] as { curriculum_scheme_id: number }).curriculum_scheme_id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <SelectField
        id="programme_id"
        label="Programme *"
        options={programmes}
        emptyHint="No programmes are visible to you. Programmes must exist before a curriculum scheme can be created."
        {...register('programme_id')}
        error={errors.programme_id?.message}
      />
      <StatusSelect id="scheme_status" label="Status" values={SCHEME_STATUSES} {...register('status')} />
      <TextField id="scheme_code" label="Scheme code *" maxLength={30} {...register('scheme_code')} error={errors.scheme_code?.message} />
      <TextField id="scheme_name" label="Scheme name *" maxLength={150} {...register('scheme_name')} error={errors.scheme_name?.message} />
      <TextField id="regulation_year" inputMode="numeric" label="Regulation year *" hint="e.g. 2024" {...register('regulation_year')} error={errors.regulation_year?.message} />
      <TextField id="total_credits" inputMode="decimal" label="Total credits" {...register('total_credits')} error={errors.total_credits?.message} />
      <TextField id="effective_from" type="date" label="Effective from *" {...register('effective_from')} error={errors.effective_from?.message} />
      <TextField id="effective_to" type="date" label="Effective to" {...register('effective_to')} error={errors.effective_to?.message} />
      <div className="sm:col-span-2">
        <FormButtons busy={isSubmitting} cancelHref={id ? `/curriculum/${id}` : '/curriculum'} label={id ? 'Save changes' : 'Create scheme'} />
      </div>
    </form>
  );
}
