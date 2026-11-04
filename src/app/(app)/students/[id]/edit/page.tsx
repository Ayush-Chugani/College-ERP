import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStudent, parseStudentId } from '@/features/student-detail';
import { StudentEditForm } from '@/features/student-edit-form';
import { loadStudentLookups } from '@/features/students-lookups';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';
import type { StudentEditInput } from '@/lib/validation';

export const metadata: Metadata = { title: 'Edit student' };

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = parseStudentId(raw);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'STUDENT.ALL.UPDATE')) notFound();
  const s = await getStudent(supabase, id);
  if (!s) notFound();
  const lookups = await loadStudentLookups(supabase);
  const str = (v: string | number | null) => (v == null ? '' : String(v));
  const defaults: StudentEditInput = {
    student_number: s.student_number,
    first_name: s.first_name,
    middle_name: str(s.middle_name),
    last_name: str(s.last_name),
    display_name: s.display_name,
    date_of_birth: str(s.date_of_birth),
    gender_id: str(s.gender_id),
    blood_group_id: str(s.blood_group_id),
    religion_id: str(s.religion_id),
    social_category_id: str(s.social_category_id),
    nationality_country_id: str(s.nationality_country_id),
    primary_email: str(s.primary_email),
    primary_phone: str(s.primary_phone),
    notes: str(s.notes),
  };
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Edit {s.display_name}</h1>
      <StudentEditForm studentId={id} defaults={defaults} lookups={lookups} />
    </div>
  );
}
