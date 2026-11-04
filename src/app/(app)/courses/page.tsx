import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { COURSE_PAGE_SIZE, listCourses, listDepartmentOptions } from '@/features/course-data';
import { COURSE_TYPES, courseListParams, type CourseListParams } from '@/lib/course-validation';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Courses' };

function href(p: CourseListParams, patch: Partial<CourseListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.department) sp.set('department', String(n.department));
  if (n.type) sp.set('type', n.type);
  if (n.active) sp.set('active', n.active);
  if (n.page > 1) sp.set('page', String(n.page));
  return `/courses?${sp.toString()}`;
}

export default async function CoursesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('CURRICULUM')) notFound();
  const params = courseListParams.parse(await searchParams);
  const [{ rows, total, error }, departments] = await Promise.all([listCourses(supabase, params), listDepartmentOptions(supabase)]);
  const pages = Math.max(1, Math.ceil(total / COURSE_PAGE_SIZE));
  const deptName = new Map(departments.map((d) => [d.id, d.label]));
  const sel = 'h-9 rounded-md border border-border bg-card px-3 text-sm';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Courses</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} course{total === 1 ? '' : 's'} you are allowed to view ·{' '}
            <Link href="/courses/categories" className="text-primary underline-offset-4 hover:underline">
              Course categories
            </Link>
          </p>
        </div>
        {can(ctx, 'CURRICULUM.ALL.CREATE') && (
          <Link href="/courses/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            New course
          </Link>
        )}
      </div>

      <form method="get" action="/courses" className="flex flex-wrap gap-2" role="search">
        <Input name="q" defaultValue={params.q} placeholder="Search code or title" aria-label="Search courses" className="w-56" />
        <select name="department" defaultValue={params.department ?? ''} aria-label="Department" className={sel}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={params.type ?? ''} aria-label="Type" className={sel}>
          <option value="">Any type</option>
          {COURSE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select name="active" defaultValue={params.active ?? ''} aria-label="Active" className={sel}>
          <option value="">Active and inactive</option>
          <option value="yes">Active only</option>
          <option value="no">Inactive only</option>
        </select>
        <Button type="submit">Filter</Button>
      </form>

      {error && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">
          Could not load courses.
        </p>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Code</th>
              <th scope="col" className="px-4 py-2 font-medium">Title</th>
              <th scope="col" className="px-4 py-2 font-medium">Department</th>
              <th scope="col" className="px-4 py-2 font-medium">Type</th>
              <th scope="col" className="px-4 py-2 font-medium">Credits</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {params.q || params.department || params.type || params.active ? 'No courses match the filters.' : 'No courses yet.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.course_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/courses/${r.course_id}`} className="text-primary underline-offset-4 hover:underline">
                      {r.course_code}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {r.course_title}
                    {!r.is_active && <span className="ml-2 text-xs text-muted-foreground">inactive</span>}
                  </td>
                  <td className="px-4 py-2">{deptName.get(r.owning_department_id) ?? `#${r.owning_department_id}`}</td>
                  <td className="px-4 py-2">{r.course_type}</td>
                  <td className="px-4 py-2">{r.credits}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
        <span>
          Page {Math.min(params.page, pages)} of {pages}
        </span>
        <div className="flex gap-2">
          {params.page > 1 && (
            <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={href(params, { page: params.page - 1 })}>
              Previous
            </Link>
          )}
          {params.page < pages && (
            <Link className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted" href={href(params, { page: params.page + 1 })}>
              Next
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}
