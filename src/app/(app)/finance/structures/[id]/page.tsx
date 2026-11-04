import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getStructure, loadLookups } from '@/features/fee-structure-data';
import { ItemsPanel, StructureForm, WorkflowPanel } from '@/features/fee-structures';
import { parseFinId } from '@/features/finance-data';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Fee structure' };

export default async function StructurePage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseFinId((await params).id);
  if (id === null) notFound();
  const { supabase } = await requireContext();
  const s = await getStructure(supabase, id);
  if (!s) notFound();
  const lookups = await loadLookups(supabase);
  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">{s.structure_name}</h1><p className="text-sm text-muted-foreground">{s.structure_code} · {s.programme_name ?? `${s.institution_name} (all programmes)`} · {s.year_code} · from {s.effective_from}{s.effective_to ? ` to ${s.effective_to}` : ''}</p></div>
        <Link href="/finance/structures" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">All structures</Link>
      </div>
      <Card><CardHeader><CardTitle>Workflow</CardTitle></CardHeader><CardContent><WorkflowPanel s={s} /></CardContent></Card>
      {s.can_edit && <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent><StructureForm lookups={lookups} initial={s} /></CardContent></Card>}
      <Card><CardHeader><CardTitle>Items</CardTitle></CardHeader><CardContent><ItemsPanel s={s} lookups={lookups} /></CardContent></Card>
    </div>
  );
}
