import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { parentOptions, parseRowId } from '@/features/structure-data';
import { StructureForm } from '@/features/structure-form';
import { can } from '@/lib/context';
import { CONFIG, parseKind } from '@/lib/structure-config';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'New' };

export default async function NewStructurePage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ parent?: string }> }) {
  const kind = parseKind((await params).kind);
  if (!kind) notFound();
  const cfg = CONFIG[kind];
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, cfg.perms.create)) notFound();
  const parents = await parentOptions(supabase, kind);
  const parentId = parseRowId((await searchParams).parent ?? '') ?? undefined;
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">New {cfg.singular}</h1>
      <StructureForm kind={kind} mode="create" parents={parents} parentId={parentId} />
    </div>
  );
}
