import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ResultsView } from '@/components/feedback-results';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCycle, getCycleOfferings, getResults, parseFbId } from '@/features/feedback-data';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Course feedback results' };

export default async function OfferingResultsPage({ params }: { params: Promise<{ cycle: string; offering: string }> }) {
  const p = await params;
  const id = parseFbId(p.cycle);
  const offering = parseFbId(p.offering);
  if (id === null || offering === null) notFound();
  const { supabase, ctx } = await requireContext();
  if (!ctx.permissions.some((q) => q.startsWith('FEEDBACK.'))) notFound();
  const cycle = await getCycle(supabase, id);
  if (!cycle) notFound();
  const [offerings, results] = await Promise.all([getCycleOfferings(supabase, id), getResults(supabase, id, offering)]);
  const label = offerings.find((o) => o.course_offering_id === offering)?.course_label ?? `Course offering ${offering}`;

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{label}</h1>
        <p className="text-sm text-muted-foreground">{cycle.cycle_name} · <Link href={`/feedback/results/${id}`} className="text-primary underline-offset-4 hover:underline">Back to cycle</Link></p>
      </div>
      <Card><CardHeader><CardTitle>Results</CardTitle></CardHeader><CardContent><ResultsView results={results} /></CardContent></Card>
    </div>
  );
}
