import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listCategories } from '@/features/course-data';
import { CategoryManager } from '@/features/course-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Course categories' };

export default async function CategoriesPage() {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('CURRICULUM')) notFound();
  const categories = await listCategories(supabase);
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Course categories</h1>
        <p className="text-sm text-muted-foreground">
          Shared across all institutions, so changes need a global configuration permission. <Link href="/courses" className="text-primary underline-offset-4 hover:underline">Back to courses</Link>
        </p>
      </div>
      <CategoryManager categories={categories} canManage={can(ctx, 'CURRICULUM.ALL.CONFIGURE')} />
    </div>
  );
}
