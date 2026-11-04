import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { listLevels, listYears } from '@/features/activity-data';
import { listRoleTypes, listStaffTypes } from '@/features/staff-data';
import { StaffActivityForm } from '@/features/staff-forms';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'New staff record' };

export default async function NewStaffRecordPage() {
  const { supabase, ctx } = await requireContext();
  if (ctx.employee_id === null) notFound(); // records are created by the employee they belong to
  const [types, years, levels, roles] = await Promise.all([listStaffTypes(supabase), listYears(supabase), listLevels(supabase), listRoleTypes(supabase)]);
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">New staff record</h1>
      <Card><CardContent className="pt-6"><StaffActivityForm lookups={{ types, years, levels, roles }} /></CardContent></Card>
    </div>
  );
}
