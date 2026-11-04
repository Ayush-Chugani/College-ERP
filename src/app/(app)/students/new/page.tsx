import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StudentCreateForm } from '@/features/student-create-form';
import { loadStudentLookups } from '@/features/students-lookups';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Register student' };

export default async function NewStudentPage() {
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'STUDENT.ALL.CREATE')) notFound();
  const lookups = await loadStudentLookups(supabase);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Register student</h1>
      <StudentCreateForm lookups={lookups} />
    </div>
  );
}
