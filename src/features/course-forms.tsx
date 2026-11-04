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
import { DeleteButton } from '@/features/academic-forms';
import type { CategoryRow, Opt, PrerequisiteRow, SchemeCourseRow } from '@/features/course-data';
import {
  categorySchema,
  courseEditSchema,
  courseSchema,
  COURSE_TYPES,
  prerequisiteSchema,
  schemeCourseEditSchema,
  schemeCourseSchema,
  type CategoryInput,
  type CategoryValues,
  type CourseEditInput,
  type CourseEditValues,
  type CourseInput,
  type CourseValues,
  type PrerequisiteInput,
  type PrerequisiteValues,
  type SchemeCourseEditInput,
  type SchemeCourseEditValues,
  type SchemeCourseInput,
  type SchemeCourseValues,
} from '@/lib/course-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };

function writeError(e: DbError, noun: string): string {
  if (e.code === '23505') return `That ${noun} already exists (codes and combinations must be unique).`;
  if (e.code === '23514') return 'The values break a database rule (check hours, credits, marks and dates).';
  if (e.code === '23503') return `This ${noun} is in use by other records.`;
  if (e.code === '22003') return 'A number is too large for its field.';
  if (e.code === '42501') return `You are not allowed to change ${noun}s here.`;
  return `Could not save the ${noun}.`;
}

const num = (v: number | undefined) => (v === undefined ? null : v);

function Check({ id, label, ...rest }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" {...rest} /> {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
type CourseFormProps =
  | { mode: 'create'; departments: Opt[]; categories: Opt[]; departmentId?: number }
  | { mode: 'edit'; id: number; categories: Opt[]; defaults: CourseEditInput };

export function CourseForm(props: CourseFormProps) {
  const router = useRouter();
  const create = props.mode === 'create';
  const form = useForm<CourseInput & CourseEditInput, unknown, CourseValues & CourseEditValues>({
    resolver: zodResolver(create ? courseSchema : courseEditSchema) as never,
    defaultValues: create
      ? ({ is_active: true, course_type: '', lecture_hours: '', tutorial_hours: '', practical_hours: '', self_study_hours: '', credits: '', owning_department_id: props.departmentId ? String(props.departmentId) : '' } as never)
      : (props.defaults as never),
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form;
  const e = errors as Record<string, { message?: string } | undefined>;

  async function onSubmit(v: CourseValues & CourseEditValues) {
    const row = {
      ...(create ? { owning_department_id: v.owning_department_id } : {}),
      course_category_id: v.course_category_id,
      course_code: v.course_code,
      course_title: v.course_title,
      short_title: v.short_title ?? null,
      course_type: v.course_type,
      lecture_hours: v.lecture_hours,
      tutorial_hours: v.tutorial_hours,
      practical_hours: v.practical_hours,
      self_study_hours: v.self_study_hours,
      credits: v.credits,
      effective_from: v.effective_from ?? null,
      effective_to: v.effective_to ?? null,
      is_active: v.is_active,
    };
    const supabase = createClient();
    const q = props.mode === 'create' ? supabase.from('course_catalog').insert(row) : supabase.from('course_catalog').update(row).eq('course_id', props.id);
    const { data, error } = await q.select('course_id');
    if (error) return void toast.error(writeError(error, 'course'));
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success(create ? 'Course created.' : 'Changes saved.');
    router.push(`/courses/${(data[0] as { course_id: number }).course_id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      {props.mode === 'create' && (
        <SelectField id="owning_department_id" label="Owning department *" options={props.departments} emptyHint="No departments are visible to you." {...register('owning_department_id')} error={e.owning_department_id?.message} />
      )}
      <SelectField id="course_category_id" label="Category *" options={props.categories} emptyHint="No course categories exist yet (a global administrator defines them)." {...register('course_category_id')} error={e.course_category_id?.message} />
      <TextField id="course_code" label="Course code *" maxLength={30} {...register('course_code')} error={e.course_code?.message} />
      <div>
        <Label htmlFor="course_type">Course type *</Label>
        <select id="course_type" aria-invalid={!!e.course_type} className="flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm" {...register('course_type')}>
          <option value="">— select —</option>
          {COURSE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {e.course_type && <p role="alert" className="mt-1 text-sm text-destructive">{e.course_type.message}</p>}
      </div>
      <TextField id="course_title" className="sm:col-span-2" label="Course title *" maxLength={200} {...register('course_title')} error={e.course_title?.message} />
      <TextField id="short_title" label="Short title" maxLength={80} {...register('short_title')} error={e.short_title?.message} />
      <TextField id="credits" inputMode="decimal" label="Credits" hint="Up to 999.9" {...register('credits')} error={e.credits?.message} />
      <TextField id="lecture_hours" inputMode="decimal" label="Lecture hours" {...register('lecture_hours')} error={e.lecture_hours?.message} />
      <TextField id="tutorial_hours" inputMode="decimal" label="Tutorial hours" {...register('tutorial_hours')} error={e.tutorial_hours?.message} />
      <TextField id="practical_hours" inputMode="decimal" label="Practical hours" {...register('practical_hours')} error={e.practical_hours?.message} />
      <TextField id="self_study_hours" inputMode="decimal" label="Self-study hours" {...register('self_study_hours')} error={e.self_study_hours?.message} />
      <TextField id="effective_from" type="date" label="Effective from" {...register('effective_from')} error={e.effective_from?.message} />
      <TextField id="effective_to" type="date" label="Effective to" {...register('effective_to')} error={e.effective_to?.message} />
      <Check id="is_active" label="Active" {...register('is_active')} />
      <div className="flex gap-3 sm:col-span-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : create ? 'Create course' : 'Save changes'}
        </Button>
        <Link href={props.mode === 'edit' ? `/courses/${props.id}` : '/courses'} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
          Cancel
        </Link>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function CategoryManager({ categories, canManage }: { categories: CategoryRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const add = useForm<CategoryInput, unknown, CategoryValues>({ resolver: zodResolver(categorySchema), defaultValues: { is_graded: true, contributes_to_gpa: true, is_active: true } });
  const edit = useForm<CategoryInput, unknown, CategoryValues>({ resolver: zodResolver(categorySchema) });

  async function create(v: CategoryValues) {
    const { error } = await createClient().from('course_category').insert(v);
    if (error) return void toast.error(writeError(error, 'category'));
    toast.success('Category added.');
    add.reset({ category_code: '', category_name: '', is_graded: true, contributes_to_gpa: true, is_active: true });
    router.refresh();
  }
  async function save(id: number, v: CategoryValues) {
    const { data, error } = await createClient().from('course_category').update(v).eq('course_category_id', id).select('course_category_id');
    if (error) return void toast.error(writeError(error, 'category'));
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success('Category updated.');
    setEditing(null);
    router.refresh();
  }

  const fields = (f: typeof add, prefix: string) => (
    <>
      <TextField id={`${prefix}code`} label="Code *" className="w-32" maxLength={30} {...f.register('category_code')} error={f.formState.errors.category_code?.message} />
      <TextField id={`${prefix}name`} label="Name *" className="w-56" maxLength={100} {...f.register('category_name')} error={f.formState.errors.category_name?.message} />
      <div className="flex flex-col gap-1 pt-6">
        <Check id={`${prefix}graded`} label="Graded" {...f.register('is_graded')} />
        <Check id={`${prefix}gpa`} label="Counts toward GPA" {...f.register('contributes_to_gpa')} />
        <Check id={`${prefix}active`} label="Active" {...f.register('is_active')} />
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">No categories defined yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {categories.map((c) => (
            <li key={c.course_category_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              {editing === c.course_category_id ? (
                <form onSubmit={edit.handleSubmit((v) => save(c.course_category_id, v))} className="flex flex-wrap items-start gap-3" noValidate>
                  {fields(edit, `e${c.course_category_id}`)}
                  <div className="flex gap-2 pt-6">
                    <Button type="submit">Save</Button>
                    <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <>
                  <span>
                    <span className="font-medium">{c.category_name}</span> <span className="text-muted-foreground">({c.category_code}){c.is_graded ? '' : ' · ungraded'}{c.contributes_to_gpa ? '' : ' · no GPA'}{c.is_active ? '' : ' · inactive'}</span>
                  </span>
                  {canManage && (
                    <span className="flex items-start gap-2">
                      <Button type="button" variant="outline" onClick={() => { edit.reset({ category_code: c.category_code, category_name: c.category_name, is_graded: c.is_graded, contributes_to_gpa: c.contributes_to_gpa, is_active: c.is_active }); setEditing(c.course_category_id); }}>
                        Edit
                      </Button>
                      <DeleteButton table="course_category" id={c.course_category_id} label="category" />
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
          <div className="pt-6">
            <Button type="submit" disabled={add.formState.isSubmitting}>Add category</Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function PrerequisiteManager({ courseId, prerequisites, options, canManage }: { courseId: number; prerequisites: PrerequisiteRow[]; options: Opt[]; canManage: boolean }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<number | null>(null);
  const taken = new Set([courseId, ...prerequisites.map((p) => p.prerequisite_course_id)]);
  const available = options.filter((o) => !taken.has(o.id));
  const form = useForm<PrerequisiteInput, unknown, PrerequisiteValues>({ resolver: zodResolver(prerequisiteSchema) });

  async function add(v: PrerequisiteValues) {
    const { error } = await createClient().from('course_prerequisite').insert({ course_id: courseId, prerequisite_course_id: v.prerequisite_course_id, minimum_grade: v.minimum_grade ?? null });
    if (error) return void toast.error(error.code === '23514' ? 'A course cannot be its own prerequisite.' : writeError(error, 'prerequisite'));
    toast.success('Prerequisite added.');
    form.reset({ prerequisite_course_id: '', minimum_grade: '' });
    router.refresh();
  }
  async function remove(pid: number) {
    const { data, error } = await createClient().from('course_prerequisite').delete().eq('course_id', courseId).eq('prerequisite_course_id', pid).select('course_id');
    if (error) return void toast.error(writeError(error, 'prerequisite'));
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to remove it.');
    toast.success('Prerequisite removed.');
    setRemoving(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {prerequisites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No prerequisites.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
          {prerequisites.map((p) => (
            <li key={p.prerequisite_course_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span>
                <Link href={`/courses/${p.prerequisite_course_id}`} className="text-primary underline-offset-4 hover:underline">{p.code ?? `#${p.prerequisite_course_id}`}</Link> {p.title}
                {p.minimum_grade ? <span className="text-muted-foreground"> · minimum grade {p.minimum_grade}</span> : null}
              </span>
              {canManage &&
                (removing === p.prerequisite_course_id ? (
                  <span role="alertdialog" aria-label="Confirm remove prerequisite" className="flex gap-2">
                    <Button type="button" variant="destructive" onClick={() => remove(p.prerequisite_course_id)}>Confirm remove</Button>
                    <Button type="button" variant="outline" onClick={() => setRemoving(null)}>Cancel</Button>
                  </span>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setRemoving(p.prerequisite_course_id)}>Remove…</Button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={form.handleSubmit(add)} className="flex flex-wrap items-start gap-3" noValidate>
          <SelectField id="prereq_course" label="Add prerequisite *" className="w-80" options={available} emptyHint="No other active course is available." {...form.register('prerequisite_course_id')} error={form.formState.errors.prerequisite_course_id?.message} />
          <TextField id="prereq_grade" label="Minimum grade" className="w-32" maxLength={5} {...form.register('minimum_grade')} error={form.formState.errors.minimum_grade?.message} />
          <div className="pt-6">
            <Button type="submit" disabled={form.formState.isSubmitting}>Add</Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function SchemeCourses({
  schemeId,
  rows,
  semesters,
  courses,
  categories,
  canManage,
}: {
  schemeId: number;
  rows: SchemeCourseRow[];
  semesters: Opt[];
  courses: (Opt & { categoryId: number })[];
  categories: Opt[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const add = useForm<SchemeCourseInput, unknown, SchemeCourseValues>({
    resolver: zodResolver(schemeCourseSchema),
    defaultValues: { is_mandatory: true, internal_max_marks: '', external_max_marks: '' },
  });
  const edit = useForm<SchemeCourseEditInput, unknown, SchemeCourseEditValues>({ resolver: zodResolver(schemeCourseEditSchema) });
  const semName = new Map(semesters.map((s) => [s.id, s.label]));
  const bySemester = new Map<number, SchemeCourseRow[]>();
  rows.forEach((r) => bySemester.set(r.semester_id, [...(bySemester.get(r.semester_id) ?? []), r]));

  async function create(v: SchemeCourseValues) {
    const course = courses.find((c) => c.id === v.course_id);
    const row = {
      curriculum_scheme_id: schemeId,
      semester_id: v.semester_id,
      course_id: v.course_id,
      course_category_id: v.course_category_id ?? course?.categoryId,
      is_mandatory: v.is_mandatory,
      elective_group_code: v.elective_group_code ?? null,
      display_order: num(v.display_order),
      internal_max_marks: v.internal_max_marks,
      external_max_marks: v.external_max_marks,
      passing_marks: num(v.passing_marks),
      exam_duration_minutes: num(v.exam_duration_minutes),
    };
    const { error } = await createClient().from('curriculum_course').insert(row);
    if (error) return void toast.error(error.code === '23505' ? 'That course is already in this semester of the scheme.' : writeError(error, 'scheme course'));
    toast.success('Course added to the scheme.');
    add.reset({ is_mandatory: true, internal_max_marks: '', external_max_marks: '', course_id: '', semester_id: '' });
    router.refresh();
  }
  async function save(id: number, v: SchemeCourseEditValues) {
    const row = { is_mandatory: v.is_mandatory, elective_group_code: v.elective_group_code ?? null, display_order: num(v.display_order), internal_max_marks: v.internal_max_marks, external_max_marks: v.external_max_marks, passing_marks: num(v.passing_marks), exam_duration_minutes: num(v.exam_duration_minutes) };
    const { data, error } = await createClient().from('curriculum_course').update(row).eq('curriculum_course_id', id).select('curriculum_course_id');
    if (error) return void toast.error(writeError(error, 'scheme course'));
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success('Updated.');
    setEditing(null);
    router.refresh();
  }

  const marks = (f: typeof edit, p: string) => (
    <>
      <TextField id={`${p}int`} label="Internal" className="w-24" inputMode="decimal" {...f.register('internal_max_marks')} error={f.formState.errors.internal_max_marks?.message} />
      <TextField id={`${p}ext`} label="External" className="w-24" inputMode="decimal" {...f.register('external_max_marks')} error={f.formState.errors.external_max_marks?.message} />
      <TextField id={`${p}pass`} label="Passing" className="w-24" inputMode="decimal" {...f.register('passing_marks')} error={f.formState.errors.passing_marks?.message} />
      <TextField id={`${p}dur`} label="Exam (min)" className="w-24" inputMode="numeric" {...f.register('exam_duration_minutes')} error={f.formState.errors.exam_duration_minutes?.message} />
      <TextField id={`${p}grp`} label="Elective group" className="w-32" maxLength={30} {...f.register('elective_group_code')} error={f.formState.errors.elective_group_code?.message} />
      <TextField id={`${p}ord`} label="Order" className="w-20" inputMode="numeric" {...f.register('display_order')} error={f.formState.errors.display_order?.message} />
      <div className="pt-6"><Check id={`${p}man`} label="Mandatory" {...f.register('is_mandatory')} /></div>
    </>
  );

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No courses in this scheme yet.</p>
      ) : (
        [...bySemester.entries()].map(([sid, list]) => (
          <div key={sid}>
            <h3 className="mb-1 text-sm font-semibold">{semName.get(sid) ?? `Semester #${sid}`}</h3>
            <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
              {list.map((r) => (
                <li key={r.curriculum_course_id} className="px-4 py-2">
                  {editing === r.curriculum_course_id ? (
                    <form onSubmit={edit.handleSubmit((v) => save(r.curriculum_course_id, v))} className="flex flex-wrap items-start gap-3" noValidate>
                      <span className="w-full font-medium">{r.code} {r.title}</span>
                      {marks(edit, `e${r.curriculum_course_id}`)}
                      <div className="flex gap-2 pt-6">
                        <Button type="submit">Save</Button>
                        <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <Link href={`/courses/${r.course_id}`} className="font-medium text-primary underline-offset-4 hover:underline">{r.code ?? `#${r.course_id}`}</Link> {r.title}
                        <br />
                        <span className="text-muted-foreground">
                          {r.is_mandatory ? 'Mandatory' : 'Elective'}{r.elective_group_code ? ` (${r.elective_group_code})` : ''} · internal {r.internal_max_marks} + external {r.external_max_marks}
                          {r.passing_marks != null ? ` · pass ${r.passing_marks}` : ''}{r.exam_duration_minutes ? ` · ${r.exam_duration_minutes} min` : ''}
                        </span>
                      </span>
                      {canManage && (
                        <span className="flex items-start gap-2">
                          <Button type="button" variant="outline" onClick={() => { edit.reset({ is_mandatory: r.is_mandatory, elective_group_code: r.elective_group_code ?? '', display_order: r.display_order == null ? '' : String(r.display_order), internal_max_marks: String(r.internal_max_marks), external_max_marks: String(r.external_max_marks), passing_marks: r.passing_marks == null ? '' : String(r.passing_marks), exam_duration_minutes: r.exam_duration_minutes == null ? '' : String(r.exam_duration_minutes) }); setEditing(r.curriculum_course_id); }}>
                            Edit
                          </Button>
                          <DeleteButton table="curriculum_course" id={r.curriculum_course_id} label="scheme course" />
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {canManage && (
        <form onSubmit={add.handleSubmit(create)} className="space-y-3 rounded-md border border-border p-4" noValidate>
          <p className="text-sm font-semibold">Add a course to this scheme</p>
          <div className="flex flex-wrap items-start gap-3">
            <SelectField id="sc_sem" label="Semester *" className="w-44" options={semesters} emptyHint="No semesters exist yet." {...add.register('semester_id')} error={add.formState.errors.semester_id?.message} />
            <SelectField id="sc_course" label="Course *" className="w-80" options={courses} emptyHint="No active courses are visible." {...add.register('course_id')} error={add.formState.errors.course_id?.message} />
            <SelectField id="sc_cat" label="Category" className="w-44" options={categories} hint="Blank = the course's own category" {...add.register('course_category_id')} error={add.formState.errors.course_category_id?.message} />
          </div>
          <div className="flex flex-wrap items-start gap-3">{marks(add as never, 'add')}</div>
          <Button type="submit" disabled={add.formState.isSubmitting}>Add to scheme</Button>
        </form>
      )}
    </div>
  );
}
