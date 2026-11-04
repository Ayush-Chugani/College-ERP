import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getScheme, listProgrammes, parseId } from '@/features/academic-data';
import { SchemeForm } from '@/features/academic-forms';
import type { SchemeInput } from '@/lib/academic-validation';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Edit curriculum scheme' };

export default async function EditSchemePage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'CURRICULUM.ALL.UPDATE')) notFound();
  const s = await getScheme(supabase, id);
  if (!s) notFound();
  const programmes = await listProgrammes(supabase);
  const defaults: SchemeInput = {
    programme_id: String(s.programme_id),
    scheme_code: s.scheme_code,
    scheme_name: s.scheme_name,
    regulation_year: String(s.regulation_year),
    total_credits: s.total_credits == null ? '' : String(s.total_credits),
    effective_from: s.effective_from,
    effective_to: s.effective_to ?? '',
    status: s.status as SchemeInput['status'],
  };
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Edit {s.scheme_name}</h1>
      <SchemeForm id={id} defaults={defaults} programmes={programmes} />
    </div>
  );
}
