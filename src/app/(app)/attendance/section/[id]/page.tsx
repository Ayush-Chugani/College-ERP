import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSummary, getTeachingSection, listAssignments, listEmployeeOptions, listSessions, parseAttId } from '@/features/attendance-data';
import { AssignmentManager, RosterButton, SessionManager } from '@/features/attendance-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Teaching section' };

export default async function TeachingSectionPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseAttId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const cos = await getTeachingSection(supabase, id);
  if (!cos) notFound(); // missing or not visible: same response
  const canTeachUpdate = can(ctx, 'TEACHING.ALL.UPDATE');
  const canTeachCreate = can(ctx, 'TEACHING.ALL.CREATE');
  const canAttCreate = can(ctx, 'ATTENDANCE.ALL.CREATE');
  const [assignments, sessions, summary, employees] = await Promise.all([
    listAssignments(supabase, id),
    listSessions(supabase, id),
    ctx.readable_modules.includes('ATTENDANCE') ? getSummary(supabase, id) : Promise.resolve([]),
    canTeachCreate ? listEmployeeOptions(supabase) : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{cos.course_label} · section {cos.section_code}{cos.batch_code ? ` / ${cos.batch_code}` : ''}</h1>
          <p className="text-sm text-muted-foreground">{cos.session_type} · {cos.term_name} · {cos.programme_name}</p>
        </div>
        <Link href="/attendance" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Back to attendance</Link>
      </div>

      <Card>
        <CardHeader><CardTitle>Instructors</CardTitle></CardHeader>
        <CardContent><AssignmentManager cosId={id} assignments={assignments} employees={employees} canManage={canTeachCreate} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Roster and attendance summary</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {canTeachUpdate && <RosterButton cosId={id} count={summary.length} />}
          {summary.length === 0 ? <p className="text-sm text-muted-foreground">No students on the roster yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left"><tr>
                  <th scope="col" className="py-2 pr-4 font-medium">Student</th><th scope="col" className="py-2 pr-4 font-medium">Present</th><th scope="col" className="py-2 pr-4 font-medium">Conducted</th><th scope="col" className="py-2 pr-4 font-medium">%</th>
                </tr></thead>
                <tbody>
                  {summary.map((r) => (
                    <tr key={r.roster_id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-4">{r.student_number} — {r.display_name}</td><td className="py-2 pr-4">{r.present_sessions}</td><td className="py-2 pr-4">{r.conducted_sessions}</td>
                      <td className="py-2 pr-4">{r.percentage === null ? '—' : `${r.percentage}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">Percentage = sessions marked with a status that counts as present, divided by CONDUCTED sessions.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sessions</CardTitle></CardHeader>
        <CardContent><SessionManager cosId={id} sessions={sessions} assignments={assignments} defaultType={cos.session_type} canManage={canAttCreate} /></CardContent>
      </Card>
    </div>
  );
}
