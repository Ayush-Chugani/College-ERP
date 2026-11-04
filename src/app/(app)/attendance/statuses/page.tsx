import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listStatuses } from '@/features/attendance-data';
import { AttendanceStatusManager } from '@/features/attendance-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Attendance statuses' };

export default async function StatusesPage() {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('ATTENDANCE')) notFound();
  const statuses = await listStatuses(supabase);
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Attendance statuses</h1>
        <p className="text-sm text-muted-foreground">
          Shared across institutions, so changes need a global configuration permission. “Counts as present” decides which statuses raise a student&apos;s attendance percentage.{' '}
          <Link href="/attendance" className="text-primary underline-offset-4 hover:underline">Back to attendance</Link>
        </p>
      </div>
      <AttendanceStatusManager statuses={statuses} canManage={can(ctx, 'ATTENDANCE.ALL.CONFIGURE')} />
    </div>
  );
}
