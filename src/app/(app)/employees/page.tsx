import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EMPLOYEE_PAGE_SIZE, listEmployees } from '@/features/employee-data';
import { can } from '@/lib/context';
import { employeeListParams, type EmployeeListParams } from '@/lib/employee-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Employees' };

function href(p: EmployeeListParams, patch: Partial<EmployeeListParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set('q', n.q);
  if (n.page > 1) sp.set('page', String(n.page));
  sp.set('sort', n.sort);
  sp.set('dir', n.dir);
  return `/employees?${sp.toString()}`;
}

const COLUMNS: { key: EmployeeListParams['sort']; label: string }[] = [
  { key: 'employee_number', label: 'Employee no.' },
  { key: 'display_name', label: 'Name' },
  { key: 'employment_status', label: 'Status' },
];

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('EMPLOYEE')) notFound();
  const params = employeeListParams.parse(await searchParams);
  const { rows, total, error } = await listEmployees(supabase, params);
  const pages = Math.max(1, Math.ceil(total / EMPLOYEE_PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Employees</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} record{total === 1 ? '' : 's'} you are allowed to view
          </p>
        </div>
        {can(ctx, 'EMPLOYEE.ALL.CREATE') && (
          <Link href="/employees/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Register employee
          </Link>
        )}
        <form method="get" action="/employees" className="flex gap-2" role="search">
          <Input name="q" defaultValue={params.q} placeholder="Search name or number" aria-label="Search employees" className="w-64" />
          <input type="hidden" name="sort" value={params.sort} />
          <input type="hidden" name="dir" value={params.dir} />
          <Button type="submit">Search</Button>
        </form>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">
          Could not load employees.
        </p>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" className="px-4 py-2 font-medium">
                  <Link href={href(params, { sort: c.key, dir: params.sort === c.key && params.dir === 'asc' ? 'desc' : 'asc', page: 1 })} className="hover:underline">
                    {c.label}
                    {params.sort === c.key ? (params.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </Link>
                </th>
              ))}
              <th scope="col" className="px-4 py-2 font-medium">
                Type
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Email
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {params.q ? 'No employees match your search.' : 'No employee records yet.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.employee_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">{r.employee_number}</td>
                  <td className="px-4 py-2">
                    <Link href={`/employees/${r.employee_id}`} className="text-primary underline-offset-4 hover:underline">
                      {r.display_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.employment_status}</td>
                  <td className="px-4 py-2">{r.employment_type}</td>
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
