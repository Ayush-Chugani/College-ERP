import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/features/academic-forms';
import { getCourse, listCategories, listCourseOptions, listDepartmentOptions, listPrerequisites, listRequiredBy, listSchemeUsage, parseCourseId } from '@/features/course-data';
import { CourseForm, PrerequisiteManager } from '@/features/course-forms';
import type { CourseEditInput } from '@/lib/course-validation';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Course' };

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseCourseId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const course = await getCourse(supabase, id);
  if (!course) notFound(); // missing or not visible: same response
  const [prereqs, requiredBy, usage, cats, departments, options] = await Promise.all([
    listPrerequisites(supabase, id),
    listRequiredBy(supabase, id),
    listSchemeUsage(supabase, id),
    listCategories(supabase),
    listDepartmentOptions(supabase),
    listCourseOptions(supabase),
  ]);
  const canUpdate = can(ctx, 'CURRICULUM.ALL.UPDATE');
  const canDelete = can(ctx, 'CURRICULUM.ALL.DELETE');
  const categories = cats.filter((c) => c.is_active || c.course_category_id === course.course_category_id).map((c) => ({ id: c.course_category_id, label: c.category_name }));
  const catName = cats.find((c) => c.course_category_id === course.course_category_id)?.category_name ?? `#${course.course_category_id}`;
  const deptName = departments.find((d) => d.id === course.owning_department_id)?.label ?? `#${course.owning_department_id}`;

  const defaults: CourseEditInput = {
    course_category_id: String(course.course_category_id),
    course_code: course.course_code,
    course_title: course.course_title,
    short_title: course.short_title ?? '',
    course_type: course.course_type as CourseEditInput['course_type'],
    lecture_hours: String(course.lecture_hours),
    tutorial_hours: String(course.tutorial_hours),
    practical_hours: String(course.practical_hours),
    self_study_hours: String(course.self_study_hours),
    credits: String(course.credits),
    effective_from: course.effective_from ?? '',
    effective_to: course.effective_to ?? '',
    is_active: course.is_active,
  };
  const rows: [string, string][] = [
    ['Department', deptName],
    ['Category', catName],
    ['Type', course.course_type],
    ['Credits', String(course.credits)],
    ['Hours (L / T / P / self-study)', `${course.lecture_hours} / ${course.tutorial_hours} / ${course.practical_hours} / ${course.self_study_hours}`],
    ['Effective', `${course.effective_from ?? '—'} → ${course.effective_to ?? 'open'}`],
    ['Status', course.is_active ? 'Active' : 'Inactive'],
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{course.course_title}</h1>
          <p className="text-sm text-muted-foreground">{course.course_code}</p>
        </div>
        <Link href="/courses" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
          Back to list
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{canUpdate ? 'Edit course' : 'Details'}</CardTitle>
        </CardHeader>
        <CardContent>
          {canUpdate ? (
            <CourseForm mode="edit" id={id} categories={categories} defaults={defaults} />
          ) : (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[14rem_1fr]">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prerequisites</CardTitle>
        </CardHeader>
        <CardContent>
          <PrerequisiteManager courseId={id} prerequisites={prereqs} options={options} canManage={canUpdate} />
          {requiredBy.length > 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              Required by:{' '}
              {requiredBy.map((r, i) => (
                <span key={r.id}>
                  {i > 0 ? ', ' : ''}
                  <Link href={`/courses/${r.id}`} className="text-primary underline-offset-4 hover:underline">
                    {r.code}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Used in curriculum schemes</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not part of any scheme you can see.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {usage.map((u) => (
                <li key={u.scheme_id}>
                  <Link href={`/curriculum/${u.scheme_id}`} className="text-primary underline-offset-4 hover:underline">
                    {u.scheme_code}
                  </Link>{' '}
                  {u.scheme_name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canDelete && (
        <Card>
          <CardHeader>
            <CardTitle>Delete course</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Refused while a scheme, prerequisite or offering uses it. Otherwise untick “Active” to retire it.</p>
            <DeleteButton table="course_catalog" id={id} label="course" redirectTo="/courses" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
