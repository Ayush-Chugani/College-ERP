import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HrView } from '@/features/hr-view';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'My HR records' };

export default async function MyHrPage() {
  const { supabase, ctx } = await requireContext();
  if (ctx.employee_id === null) notFound();
  const body = await HrView({ supabase, ctx, employeeId: ctx.employee_id });
  return (
    <div className="max-w-5xl space-y-4">
      <div><h1 className="text-xl font-semibold">My HR records</h1><p className="text-sm text-muted-foreground">Your PAN, Aadhaar, bank accounts and HR documents. HR checks what you submit.</p></div>
      {body}
    </div>
  );
}
