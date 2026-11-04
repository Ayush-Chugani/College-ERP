import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadSetup } from '@/features/feedback-data';
import { SetupManager } from '@/features/feedback-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Feedback setup' };

export default async function FeedbackSetupPage() {
  const { supabase, ctx } = await requireContext();
  if (!ctx.permissions.some((p) => p.startsWith('FEEDBACK.'))) notFound();
  const s = await loadSetup(supabase);
  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Questionnaires &amp; cycles</h1>
        <p className="text-sm text-muted-foreground">
          A questionnaire becomes ACTIVE, then a cycle opens it to students for a term. Once a cycle has opened (or has responses) its questions are locked.{' '}
          <Link href="/feedback" className="text-primary underline-offset-4 hover:underline">Back to feedback</Link>
        </p>
      </div>
      <SetupManager {...s} canManage={can(ctx, 'FEEDBACK.ALL.CONFIGURE')} />
    </div>
  );
}
