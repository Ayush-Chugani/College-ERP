import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { listScales } from '@/features/assessment-data';
import { GradeManager } from '@/features/assessment-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Grade scales' };

export default async function GradesPage() {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('RESULT')) notFound();
  const { scales, rules } = await listScales(supabase);
  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Grade scales</h1>
        <p className="text-sm text-muted-foreground">
          Shared across institutions, so changes need a global configuration permission. Results are graded from the active scale whose percentage band contains the student&apos;s percentage.
        </p>
      </div>
      <GradeManager scales={scales} rules={rules} canManage={can(ctx, 'RESULT.ALL.CONFIGURE')} />
    </div>
  );
}
