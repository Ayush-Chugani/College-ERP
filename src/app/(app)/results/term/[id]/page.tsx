import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getTermSheet, parseAsmId } from '@/features/assessment-data';
import { TermResultTable } from '@/features/assessment-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Term results' };

export default async function TermResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseAsmId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'RESULT.ALL.READ')) notFound();
  const rows = await getTermSheet(supabase, id);
  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Term results</h1>
        <p className="text-sm text-muted-foreground">
          Record course results first, then compute each student&apos;s SGPA/CGPA, then publish. Students see results only once published.{' '}
          <Link href="/assessment" className="text-primary underline-offset-4 hover:underline">Back to assessment</Link>
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle>Students</CardTitle></CardHeader>
        <CardContent>
          <TermResultTable key={rows.map((r) => `${r.term_registration_id}:${r.result_status}:${r.published_at}`).join('|')} rows={rows} canCompute={can(ctx, 'RESULT.ALL.CREATE')} canPublish={can(ctx, 'RESULT.ALL.PUBLISH')} />
        </CardContent>
      </Card>
    </div>
  );
}
