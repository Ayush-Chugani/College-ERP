import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { listStudents, PAGE_SIZE } from '@/features/students-query';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';
import { studentListParams, type StudentListParams } from '@/lib/validation';

export const metadata: Metadata = { title: 'Students' };

function href(p: StudentListParams, patch: Partial<StudentListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.page > 1) sp.set('page', String(n.page));
  sp.set('sort', n.sort);
  sp.set('dir', n.dir);
  return `/students?${sp.toString()}`;
}

const COLUMNS: { key: StudentListParams['sort']; label: string }[] = [
  { key: 'student_number', label: 'Student no.' },
  { key: 'display_name', label: 'Name' },
  { key: 'student_status', label: 'Status' },
];

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('STUDENT')) notFound();
  const params = studentListParams.parse(await searchParams);
  const { rows, total, error } = await listStudents(supabase, params);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Students</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} record{total === 1 ? '' : 's'} you are allowed to view</p>
        </div>
        {can(ctx, 'STUDENT.ALL.CREATE') && (
          <Link href="/students/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Register student
          </Link>
        )}
        <form method="get" action="/students" className="flex gap-2" role="search">
          <Input name="q" defaultValue={params.q} placeholder="Search name or number" aria-label="Search students" className="w-64" />
          <input type="hidden" name="sort" value={params.sort} />
          <input type="hidden" name="dir" value={params.dir} />
          <Button type="submit">Search</Button>
        </form>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">
          Could not load students.
        </p>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" className="px-4 py-2 font-medium">
                  <Link
                    href={href(params, { sort: c.key, dir: params.sort === c.key && params.dir === 'asc' ? 'desc' : 'asc', page: 1 })}
                    className="hover:underline"
                  >
                    {c.label}
                    {params.sort === c.key ? (params.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </Link>
                </th>
              ))}
              <th scope="col" className="px-4 py-2 font-medium">
                Email
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  {params.q ? 'No students match your search.' : 'No student records yet.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.student_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">{r.student_number}</td>
                  <td className="px-4 py-2">
                    <Link href={`/students/${r.student_id}`} className="text-primary underline-offset-4 hover:underline">
                      {r.display_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.student_status}</td>
                  <td className="px-4 py-2">{r.primary_email ?? '—'}</td>
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
