import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { YearForm } from '@/features/academic-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'New academic year' };

export default async function NewYearPage() {
  const { ctx } = await requireContext();
  if (!can(ctx, 'ACADEMIC_CALENDAR.ALL.CONFIGURE')) notFound();
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">New academic year</h1>
      <YearForm />
    </div>
  );
}
