import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getScheme, listProgrammes, parseId } from '@/features/academic-data';
import { DeleteButton } from '@/features/academic-forms';
import { listCategories, listCourseOptions, listSchemeCourses, listSemesterOptions } from '@/features/course-data';
import { SchemeCourses } from '@/features/course-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Curriculum scheme' };

export default async function SchemeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const s = await getScheme(supabase, id);
  if (!s) notFound();
  const [programmes, schemeCourses, semesters, courseOptions, cats] = await Promise.all([
    listProgrammes(supabase),
    listSchemeCourses(supabase, id),
    listSemesterOptions(supabase),
    listCourseOptions(supabase),
    listCategories(supabase),
  ]);
  const rows: [string, string][] = [
    ['Programme', programmes.find((p) => p.id === s.programme_id)?.label ?? `#${s.programme_id}`],
    ['Regulation year', String(s.regulation_year)],
    ['Total credits', s.total_credits == null ? '—' : String(s.total_credits)],
    ['Effective from', s.effective_from],
    ['Effective to', s.effective_to ?? '—'],
    ['Status', s.status],
  ];
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{s.scheme_name}</h1>
          <p className="text-sm text-muted-foreground">{s.scheme_code}</p>
        </div>
        <div className="flex gap-2">
          {can(ctx, 'CURRICULUM.ALL.UPDATE') && (
            <Link href={`/curriculum/${id}/edit`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Edit
            </Link>
          )}
          <Link href="/curriculum" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
            Back to list
          </Link>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Courses in this scheme</CardTitle>
        </CardHeader>
        <CardContent>
          <SchemeCourses
            schemeId={id}
            rows={schemeCourses}
            semesters={semesters}
            courses={courseOptions}
            categories={cats.filter((c) => c.is_active).map((c) => ({ id: c.course_category_id, label: c.category_name }))}
            canManage={can(ctx, 'CURRICULUM.ALL.UPDATE')}
          />
        </CardContent>
      </Card>
      {can(ctx, 'CURRICULUM.ALL.DELETE') && (
        <Card>
          <CardHeader>
            <CardTitle>Delete scheme</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Refused while enrolments or courses use this scheme. Otherwise set its status to RETIRED.</p>
            <DeleteButton table="curriculum_scheme" id={id} label="curriculum scheme" redirectTo="/curriculum" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
