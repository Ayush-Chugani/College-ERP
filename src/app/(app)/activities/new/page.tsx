import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { listActivityTypes, listLevels, listModes, listYears } from '@/features/activity-data';
import { ActivityForm } from '@/features/activity-forms';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'New activity' };

export default async function NewActivityPage() {
  const { supabase, ctx } = await requireContext();
  if (ctx.student_id === null) notFound(); // staff open a student's activity from the list; new activities are recorded by the student
  const [types, years, levels, modes] = await Promise.all([listActivityTypes(supabase), listYears(supabase), listLevels(supabase), listModes(supabase)]);
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">New activity</h1>
      <Card><CardContent className="pt-6"><ActivityForm lookups={{ types, years, levels, modes }} /></CardContent></Card>
    </div>
  );
}
