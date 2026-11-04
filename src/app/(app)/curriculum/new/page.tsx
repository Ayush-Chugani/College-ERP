import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { listProgrammes } from '@/features/academic-data';
import { SchemeForm } from '@/features/academic-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'New curriculum scheme' };

export default async function NewSchemePage() {
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'CURRICULUM.ALL.CREATE')) notFound();
  const programmes = await listProgrammes(supabase);
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">New curriculum scheme</h1>
      <SchemeForm programmes={programmes} />
    </div>
  );
}
