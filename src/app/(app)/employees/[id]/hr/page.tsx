import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HrView } from '@/features/hr-view';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Employee HR records' };

export default async function EmployeeHrPage({ params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id;
  if (!/^\d{1,15}$/.test(raw) || Number(raw) <= 0) notFound();
  const id = Number(raw);
  const { supabase, ctx } = await requireContext();
  const { data: emp } = await supabase.from('employee').select('employee_number, display_name').eq('employee_id', id).maybeSingle();
  if (!emp && ctx.employee_id !== id) notFound();
  const body = await HrView({ supabase, ctx, employeeId: id });
  if (!body) notFound();
  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">HR records</h1><p className="text-sm text-muted-foreground">{emp ? `${String(emp.display_name)} · ${String(emp.employee_number)}` : 'Your record'}</p></div>
        <Link href={`/employees/${id}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Employee record</Link>
      </div>
      {body}
    </div>
  );
}
