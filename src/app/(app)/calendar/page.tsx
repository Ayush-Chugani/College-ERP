import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listSemesters, listYears } from '@/features/academic-data';
import { SemesterManager } from '@/features/academic-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Academic calendar' };

export default async function CalendarPage() {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('ACADEMIC_CALENDAR')) notFound();
  const [years, semesters] = await Promise.all([listYears(supabase), listSemesters(supabase)]);
  const canManage = can(ctx, 'ACADEMIC_CALENDAR.ALL.CONFIGURE');

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Academic calendar</h1>
          <p className="text-sm text-muted-foreground">Academic years, terms and semesters. Changes require a global configuration permission.</p>
        </div>
        {canManage && (
          <Link href="/calendar/years/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            New academic year
          </Link>
        )}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-left">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Year</th>
              <th scope="col" className="px-4 py-2 font-medium">Starts</th>
              <th scope="col" className="px-4 py-2 font-medium">Ends</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {years.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  No academic years yet.
                </td>
              </tr>
            ) : (
              years.map((y) => (
                <tr key={y.academic_year_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/calendar/years/${y.academic_year_id}`} className="text-primary underline-offset-4 hover:underline">
                      {y.year_code}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{y.start_date}</td>
                  <td className="px-4 py-2">{y.end_date}</td>
                  <td className="px-4 py-2">{y.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Semesters</CardTitle>
        </CardHeader>
        <CardContent>
          <SemesterManager semesters={semesters} canManage={canManage} />
        </CardContent>
      </Card>
    </div>
  );
}
