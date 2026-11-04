import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listAdmissionCategories } from '@/features/admission-data';
import { AdmissionCategoryManager } from '@/features/admission-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Admission categories' };

export default async function AdmissionCategoriesPage() {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('ADMISSION')) notFound();
  const categories = await listAdmissionCategories(supabase);
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Admission categories</h1>
        <p className="text-sm text-muted-foreground">
          Shared across institutions, so changes need a global configuration permission. <Link href="/admissions" className="text-primary underline-offset-4 hover:underline">Back to admissions</Link>
        </p>
      </div>
      <AdmissionCategoryManager categories={categories} canManage={can(ctx, 'IAM.ALL.CONFIGURE')} />
    </div>
  );
}
