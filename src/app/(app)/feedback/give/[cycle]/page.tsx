import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getForm, getMyTasks, parseFbId } from '@/features/feedback-data';
import { FeedbackForm } from '@/features/feedback-forms';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Give feedback' };

export default async function GiveFeedbackPage({ params, searchParams }: { params: Promise<{ cycle: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const cycleId = parseFbId((await params).cycle);
  if (cycleId === null) notFound();
  const sp = await searchParams;
  const course = parseFbId(sp.course);
  const faculty = parseFbId(sp.faculty);
  const { supabase, ctx } = await requireContext();
  if (ctx.student_id === null) notFound();
  // Only a task the student really has can be opened; the database re-checks everything on submit.
  const tasks = await getMyTasks(supabase);
  const task = tasks.find((t) => t.feedback_cycle_id === cycleId && t.course_offering_id === course && t.faculty_assignment_id === faculty);
  if (!task) notFound();
  const questions = task.submitted ? [] : await getForm(supabase, cycleId);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{task.cycle_name}</h1>
        <p className="text-sm text-muted-foreground">
          {task.course_label ?? 'General feedback'}{task.instructor_name ? ` · ${task.instructor_name}` : ''} ·{' '}
          {task.is_anonymous ? 'Anonymous: your name is not stored with your answers.' : 'Not anonymous: your name is stored with your answers.'}{' '}
          <Link href="/feedback" className="text-primary underline-offset-4 hover:underline">Back</Link>
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle>Questions</CardTitle></CardHeader>
        <CardContent>
          {task.submitted ? <p className="text-sm">You have already submitted this feedback. Thank you.</p> : questions.length === 0 ? <p className="text-sm text-muted-foreground">This questionnaire has no questions.</p> : (
            <FeedbackForm cycleId={cycleId} courseOfferingId={course} facultyAssignmentId={faculty} questions={questions} anonymous={task.is_anonymous} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
