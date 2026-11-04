import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadEditorLookups } from '@/features/communication-data';
import { AnnouncementForm } from '@/features/communication-forms';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'New announcement' };

export default async function NewAnnouncementPage() {
  const { supabase, ctx } = await requireContext();
  if (!ctx.permissions.includes('COMMUNICATION.ALL.CREATE')) notFound();
  const l = await loadEditorLookups(supabase);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">New announcement</h1>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent><AnnouncementForm types={l.types} departments={l.departments} canPostGlobal={l.canPostGlobal} /></CardContent></Card>
    </div>
  );
}
