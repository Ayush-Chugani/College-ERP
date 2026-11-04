import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getYear, parseId } from '@/features/academic-data';
import { YearForm } from '@/features/academic-forms';
import { can } from '@/lib/context';
import type { YearInput } from '@/lib/academic-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Edit academic year' };

export default async function EditYearPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'ACADEMIC_CALENDAR.ALL.CONFIGURE')) notFound();
  const y = await getYear(supabase, id);
  if (!y) notFound();
  const defaults: YearInput = { year_code: y.year_code, start_date: y.start_date, end_date: y.end_date, status: y.status as YearInput['status'] };
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Edit academic year {y.year_code}</h1>
      <YearForm id={id} defaults={defaults} />
    </div>
  );
}
