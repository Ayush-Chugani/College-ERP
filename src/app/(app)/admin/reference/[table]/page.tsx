import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReferenceView } from './view';
import { REF_TABLES } from '@/lib/staff-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Reference data' };

export default async function ReferenceTablePage({ params }: { params: Promise<{ table: string }> }) {
  const table = (await params).table;
  if (!(REF_TABLES as readonly string[]).includes(table)) notFound();
  const { supabase } = await requireContext();
  const { data } = await supabase.rpc('ref_schema', { p_table: table });
  if (!data) notFound(); // unknown or not configurable by this user: same response
  const label = (data as { label: string }).label;
  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">{label}</h1>
        <Link href="/admin/reference" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">All lists</Link>
      </div>
      <ReferenceView table={table} />
    </div>
  );
}
