import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ResultsView } from '@/components/feedback-results';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCycle, getCycleOfferings, getResults, parseFbId } from '@/features/feedback-data';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Feedback results' };

export default async function CycleResultsPage({ params }: { params: Promise<{ cycle: string }> }) {
  const id = parseFbId((await params).cycle);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  if (!ctx.permissions.some((p) => p.startsWith('FEEDBACK.'))) notFound();
  const cycle = await getCycle(supabase, id);
  if (!cycle) notFound();
  const [offerings, overall] = await Promise.all([getCycleOfferings(supabase, id), getResults(supabase, id, null)]);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{cycle.cycle_name}</h1>
        <p className="text-sm text-muted-foreground">{cycle.status} · results visible to {cycle.result_visibility.toLowerCase().replace('_', ' ')} · <Link href="/feedback" className="text-primary underline-offset-4 hover:underline">Back</Link></p>
      </div>
      <Card>
        <CardHeader><CardTitle>By course</CardTitle></CardHeader>
        <CardContent>
          {offerings.length === 0 ? <p className="text-sm text-muted-foreground">No course results are available to you for this cycle.</p> : (
            <ul className="divide-y divide-border text-sm">
              {offerings.map((o) => (
                <li key={o.course_offering_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{o.course_label} <span className="text-muted-foreground">· {o.programme_name} · {o.responses} response{o.responses === 1 ? '' : 's'}</span></span>
                  <Link href={`/feedback/results/${id}/${o.course_offering_id}`} className="text-primary underline-offset-4 hover:underline">Open</Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>All responses you can see</CardTitle></CardHeader>
        <CardContent><ResultsView results={overall} /></CardContent>
      </Card>
    </div>
  );
}
