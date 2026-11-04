import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SectionTabs } from '@/features/record-editor';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Student records' };
const SECTIONS = [
  { section: 'address', label: 'Addresses' }, { section: 'guardian', label: 'Parents and guardians' }, { section: 'previous_education', label: 'Previous education' },
  { section: 'entrance_exam', label: 'Entrance exams' }, { section: 'residence', label: 'Residence' },
];

export default async function StudentRecordsPage({ params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id;
  if (!/^\d{1,15}$/.test(raw) || Number(raw) <= 0) notFound();
  const id = Number(raw);
  const { supabase } = await requireContext();
  const { data: student } = await supabase.from('student').select('student_number, display_name').eq('student_id', id).maybeSingle();
  if (!student) notFound();
  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Records</h1><p className="text-sm text-muted-foreground">{String(student.display_name)} · {String(student.student_number)}</p></div>
        <Link href={`/students/${id}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Student record</Link>
      </div>
      <SectionTabs kind="student" parentId={id} sections={SECTIONS} />
    </div>
  );
}
