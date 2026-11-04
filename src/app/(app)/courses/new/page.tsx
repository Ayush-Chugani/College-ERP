import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { listCategories, listDepartmentOptions } from '@/features/course-data';
import { CourseForm } from '@/features/course-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'New course' };

export default async function NewCoursePage() {
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'CURRICULUM.ALL.CREATE')) notFound();
  const [departments, cats] = await Promise.all([listDepartmentOptions(supabase), listCategories(supabase)]);
  const categories = cats.filter((c) => c.is_active).map((c) => ({ id: c.course_category_id, label: c.category_name }));
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">New course</h1>
      <CourseForm mode="create" departments={departments} categories={categories} />
    </div>
  );
}
