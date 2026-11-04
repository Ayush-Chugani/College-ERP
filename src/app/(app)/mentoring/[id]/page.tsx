import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAssignment, getSessions, parseMentorId } from '@/features/mentoring-data';
import { EndAssignment, SessionForm, SessionList } from '@/features/mentoring-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Mentoring assignment' };

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseMentorId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const a = await getAssignment(supabase, id);
  if (!a) notFound(); // missing or not permitted: same response
  const sessions = await getSessions(supabase, id);
  const active = a.assignment_status === 'ACTIVE';
  const canWrite = active && (a.is_mine || can(ctx, 'MENTORING.ALL.CREATE'));

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{a.student_name}</h1>
          <p className="text-sm text-muted-foreground">
            {a.student_number} · mentor {a.mentor_name}{a.is_mine ? ' (you)' : ''} · {a.start_date}{a.end_date ? ` → ${a.end_date}` : ' →'} · <span className="font-medium text-foreground">{a.assignment_status}</span>
          </p>
        </div>
        <Link href="/mentoring" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">All assignments</Link>
      </div>

      <Card>
        <CardHeader><CardTitle>Sessions</CardTitle></CardHeader>
        <CardContent><SessionList key={sessions.map((s) => `${s.counselling_session_id}:${s.session_status}:${s.redacted}`).join('|')} sessions={sessions} canEdit={a.is_mine && active} /></CardContent>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader><CardTitle>Record a session</CardTitle></CardHeader>
          <CardContent><SessionForm assignmentId={id} /></CardContent>
        </Card>
      )}
      {active && !canWrite && <p className="text-sm text-muted-foreground">Only the assigned mentor records sessions.</p>}

      {active && a.can_assign && (
        <Card><CardHeader><CardTitle>End the assignment</CardTitle></CardHeader><CardContent><EndAssignment assignmentId={id} /></CardContent></Card>
      )}
    </div>
  );
}
