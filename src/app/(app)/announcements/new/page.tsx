import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { listDepartments, listTypes } from '@/features/announcement-data';
import { AnnouncementForm } from '@/features/announcement-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'New announcement' };

export default async function NewAnnouncementPage() {
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'COMMUNICATION.ALL.CREATE')) notFound();
  const [types, departments] = await Promise.all([listTypes(supabase), listDepartments(supabase)]);
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">New announcement</h1>
      <Card><CardContent className="pt-6"><AnnouncementForm types={types} departments={departments} /></CardContent></Card>
    </div>
  );
}
