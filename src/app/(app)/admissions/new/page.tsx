import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadAdmissionLookups } from '@/features/admission-data';
import { ApplyForm } from '@/features/admission-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'New application' };

export default async function NewApplicationPage() {
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'ADMISSION.ALL.CREATE')) notFound();
  const lookups = await loadAdmissionLookups(supabase);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">New application</h1>
      <ApplyForm lookups={lookups} />
    </div>
  );
}
