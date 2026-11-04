import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMyTasks, listCycles } from '@/features/feedback-data';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Feedback' };

export default async function FeedbackPage() {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('FEEDBACK')) notFound();
  const isStudent = ctx.student_id !== null;
  const staffView = ctx.permissions.some((p) => p.startsWith('FEEDBACK.'));
  const [tasks, cycles] = await Promise.all([isStudent ? getMyTasks(supabase) : Promise.resolve([]), staffView ? listCycles(supabase) : Promise.resolve([])]);
  const todo = tasks.filter((t) => !t.submitted);
  const done = tasks.filter((t) => t.submitted);
  const href = (t: (typeof tasks)[number]) => `/feedback/give/${t.feedback_cycle_id}?${new URLSearchParams({ ...(t.course_offering_id ? { course: String(t.course_offering_id) } : {}), ...(t.faculty_assignment_id ? { faculty: String(t.faculty_assignment_id) } : {}) }).toString()}`;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Feedback</h1>
          <p className="text-sm text-muted-foreground">{isStudent ? 'Give feedback on your courses and instructors while a cycle is open.' : 'Feedback cycles and their results.'}</p>
        </div>
        {staffView && <Link href="/feedback/setup" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Questionnaires &amp; cycles</Link>}
      </div>

      {isStudent && (
        <Card>
          <CardHeader><CardTitle>Waiting for your feedback</CardTitle></CardHeader>
          <CardContent>
            {todo.length === 0 ? <p className="text-sm text-muted-foreground">{tasks.length === 0 ? 'No feedback cycle is open for you right now.' : 'You have given all the feedback that is open.'}</p> : (
              <ul className="divide-y divide-border text-sm">
                {todo.map((t, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{t.cycle_name}</span>{t.course_label ? ` · ${t.course_label}` : ''}{t.instructor_name ? ` · ${t.instructor_name}` : ''}
                      <span className="text-muted-foreground"> · {t.is_anonymous ? 'anonymous' : 'not anonymous'} · closes {new Date(t.end_at).toLocaleDateString()}</span>
                    </span>
                    <Link href={href(t)} className="text-primary underline-offset-4 hover:underline">Give feedback</Link>
                  </li>
                ))}
              </ul>
            )}
            {done.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{done.length} submitted.</p>}
          </CardContent>
        </Card>
      )}

      {staffView && (
        <Card>
          <CardHeader><CardTitle>Cycles</CardTitle></CardHeader>
          <CardContent>
            {cycles.length === 0 ? <p className="text-sm text-muted-foreground">No cycles yet.</p> : (
              <ul className="divide-y divide-border text-sm">
                {cycles.map((c) => (
                  <li key={c.feedback_cycle_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><span className="font-medium">{c.cycle_name}</span> · {c.status} · results: {c.result_visibility.toLowerCase().replace('_', ' ')}</span>
                    <Link href={`/feedback/results/${c.feedback_cycle_id}`} className="text-primary underline-offset-4 hover:underline">Results</Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
