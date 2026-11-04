import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadRegLookups } from '@/features/registration-data';
import { OfferingForm } from '@/features/registration-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'New offering' };

export default async function NewOfferingPage() {
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'REGISTRATION.ALL.CREATE')) notFound();
  const lookups = await loadRegLookups(supabase);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">New programme-term offering</h1>
      <OfferingForm lookups={lookups} />
    </div>
  );
}
