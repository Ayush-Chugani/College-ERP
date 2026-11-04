import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SectionTabs } from '@/features/record-editor';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Employee records' };
const SECTIONS = [{ section: 'address', label: 'Addresses' }, { section: 'qualification', label: 'Qualifications' }, { section: 'experience', label: 'Previous employment' }];

export default async function EmployeeRecordsPage({ params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id;
  if (!/^\d{1,15}$/.test(raw) || Number(raw) <= 0) notFound();
  const id = Number(raw);
  const { supabase } = await requireContext();
  const { data: emp } = await supabase.from('employee').select('employee_number, display_name').eq('employee_id', id).maybeSingle();
  if (!emp) notFound();
  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Records</h1><p className="text-sm text-muted-foreground">{String(emp.display_name)} · {String(emp.employee_number)}</p></div>
        <Link href={`/employees/${id}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Employee record</Link>
      </div>
      <p className="text-xs text-muted-foreground">Identity numbers (PAN, Aadhaar) and bank accounts are not edited here; they wait for a decision on who holds the encryption keys.</p>
      <SectionTabs kind="employee" parentId={id} sections={SECTIONS} />
    </div>
  );
}
