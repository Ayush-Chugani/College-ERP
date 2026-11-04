import type { Metadata } from 'next';
import Link from 'next/link';
import { MonthlyBars, SliceBars, StackedBars } from '@/components/charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMyResults } from '@/features/assessment-data';
import { FEE_WINDOW_MONTHS, loadDashboard, SESSION_WINDOW_DAYS } from '@/features/dashboard-data';
import { loadStats } from '@/features/dashboard-stats';
import { hhmm, isLow, loadPersonalDashboard } from '@/features/personal-dashboard';
import { percent, rupees } from '@/lib/dashboard-model';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Dashboard' };

const Unavailable = () => <p className="text-sm text-destructive">This chart is unavailable right now.</p>;

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const { supabase, ctx } = await requireContext();
  const mods = ctx.readable_modules;
  const has = (m: string) => mods.includes(m);
  const [stats, d, myTerms, mine] = await Promise.all([
    loadStats(supabase, mods),
    loadDashboard(supabase, mods),
    ctx.student_id !== null ? getMyResults(supabase) : Promise.resolve([]),
    ctx.student_id !== null || ctx.employee_id !== null ? loadPersonalDashboard(supabase) : Promise.resolve(null),
  ]);
  const latest = myTerms[0];
  const hasCharts = has('STUDENT') || has('ADMISSION') || has('REGISTRATION') || has('EMPLOYEE') || has('ATTENDANCE') || has('RESULT') || has('FEES');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Welcome, {ctx.username}</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.roles.length ? ctx.roles.map((r) => `${r.role_name} (${r.scope_type.toLowerCase()})`).join(' · ') : 'No active role assignments.'}
        </p>
      </div>

      {ctx.student_id !== null && mine && (
        <>
          <Panel title="Today's classes" note="Your registered courses.">
            {!mine.today || mine.today.length === 0 ? <p className="text-sm text-muted-foreground">No classes are scheduled for you today.</p> : (
              <ul className="divide-y divide-border text-sm">
                {mine.today.map((c, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-2"><span>{hhmm(c.start)}–{hhmm(c.end)} · <span className="font-medium">{c.course}</span></span><span className="text-muted-foreground">{c.type.toLowerCase()}{c.room ? ` · ${c.room}` : ''} · {c.status.toLowerCase()}</span></li>)}
              </ul>
            )}
          </Panel>
          <Panel title="My attendance" note="Conducted classes only. Courses under 75% are marked.">
            {!mine.attendance || mine.attendance.length === 0 ? <p className="text-sm text-muted-foreground">You are not on any class roster yet.</p> : (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left"><tr><th scope="col" className="py-2 pr-4 font-medium">Course</th><th scope="col" className="py-2 pr-4 text-right font-medium">Attended</th><th scope="col" className="py-2 text-right font-medium">Percentage</th></tr></thead>
                <tbody>{mine.attendance.map((a) => (
                  <tr key={a.section_id} className="border-b border-border last:border-0"><td className="py-2 pr-4">{a.course}</td><td className="py-2 pr-4 text-right tabular-nums">{Number(a.present)} / {Number(a.conducted)}</td>
                    <td className={`py-2 text-right tabular-nums ${isLow(a.percentage === null ? null : Number(a.percentage)) ? 'font-medium text-destructive' : ''}`}>{a.percentage === null ? '—' : `${Number(a.percentage)}%`}{isLow(a.percentage === null ? null : Number(a.percentage)) ? ' (low)' : ''}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Panel>
        </>
      )}

      {ctx.employee_id !== null && mine && (
        <Panel title="My teaching" note={`${Number(mine.sections ?? 0)} active section${Number(mine.sections ?? 0) === 1 ? '' : 's'} · next 7 days`}>
          {Number(mine.unmarked ?? 0) > 0 && <p role="status" className="mb-2 rounded-md border border-border bg-muted p-2 text-sm">{Number(mine.unmarked)} past session{Number(mine.unmarked) === 1 ? ' is' : 's are'} still not marked. <Link href="/attendance" className="text-primary underline-offset-4 hover:underline">Open attendance</Link></p>}
          {!mine.upcoming || mine.upcoming.length === 0 ? <p className="text-sm text-muted-foreground">No sessions are planned for you in the next 7 days.</p> : (
            <ul className="divide-y divide-border text-sm">
              {mine.upcoming.map((u) => <li key={u.session_id} className="flex flex-wrap justify-between gap-2 py-2"><span>{u.date} {hhmm(u.start)}–{hhmm(u.end)} · <Link href={`/attendance/session/${u.session_id}`} className="font-medium text-primary underline-offset-4 hover:underline">{u.course}</Link> ({u.section})</span><span className="text-muted-foreground">{u.type.toLowerCase()} · {u.status.toLowerCase()}</span></li>)}
            </ul>
          )}
        </Panel>
      )}

      {ctx.student_id !== null && (
        <Panel title="My results" note="Published results only.">
          {latest ? (
            <div className="space-y-1 text-sm">
              <p><span className="font-medium">{latest.term_name}</span> · {latest.semester_name} · {latest.result_status}</p>
              <p className="text-2xl font-semibold tabular-nums">CGPA {latest.cgpa ?? '—'} <span className="text-base font-normal text-muted-foreground">SGPA {latest.sgpa ?? '—'} · credits {latest.credits_earned}/{latest.credits_registered}</span></p>
              <Link href="/my-results" className="text-primary underline-offset-4 hover:underline">All results</Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No results have been published for you yet.</p>
          )}
        </Panel>
      )}

      {stats.length === 0 && !hasCharts && ctx.student_id === null ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No modules with summary views are available for your roles yet.</CardContent></Card>
      ) : (
        stats.length > 0 && (
          <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stats.map((s) => (
              <Card key={s.table}>
                <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle></CardHeader>
                <CardContent>
                  {s.count === null ? <p className="text-sm text-destructive">Unavailable</p> : s.count === 0 ? <p className="text-sm text-muted-foreground">No records yet</p> : <p className="text-3xl font-semibold">{s.count.toLocaleString()}</p>}
                  {s.href && <Link href={s.href} className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline">View {s.label.toLowerCase()}</Link>}
                </CardContent>
              </Card>
            ))}
          </section>
        )
      )}

      {hasCharts && (
        <section aria-label="Charts" className="grid gap-4 lg:grid-cols-2">
          {(has('STUDENT') || has('ADMISSION')) && (
            <Panel title="Enrolments by programme" note="Programmes you can see, split by enrolment status.">
              {d.enrolments ? <StackedBars title="Enrolments by programme" data={d.enrolments.data} keys={d.enrolments.statuses} /> : <Unavailable />}
            </Panel>
          )}
          {has('ADMISSION') && (
            <Panel title="Admission applications by status">
              {d.applications ? <SliceBars title="Admission applications by status" data={d.applications} /> : <Unavailable />}
            </Panel>
          )}
          {has('REGISTRATION') && (
            <Panel title="Term registrations by status">
              {d.registrations ? <SliceBars title="Term registrations by status" data={d.registrations} /> : <Unavailable />}
            </Panel>
          )}
          {has('ATTENDANCE') && (
            <Panel title="Class sessions by status" note={`Sessions dated in the last ${SESSION_WINDOW_DAYS} days.`}>
              {d.sessions ? <SliceBars title="Class sessions by status" data={d.sessions} /> : <Unavailable />}
            </Panel>
          )}
          {has('RESULT') && (
            <Panel title="Term results" note="Computed term results, by outcome. Unpublished results are not visible to students.">
              {d.results ? (
                <div className="space-y-4">
                  <div><h3 className="mb-1 text-sm font-medium">Published</h3><SliceBars title="Published term results" data={d.results.published} /></div>
                  <div><h3 className="mb-1 text-sm font-medium">Not yet published</h3><SliceBars title="Unpublished term results" data={d.results.unpublished} /></div>
                </div>
              ) : <Unavailable />}
            </Panel>
          )}
          {has('EMPLOYEE') && (
            <Panel title="Employees">
              {d.employees ? (
                <div className="space-y-4">
                  <div><h3 className="mb-1 text-sm font-medium">By status</h3><SliceBars title="Employees by status" data={d.employees.byStatus} /></div>
                  <div><h3 className="mb-1 text-sm font-medium">By employment type</h3><SliceBars title="Employees by type" data={d.employees.byType} /></div>
                </div>
              ) : <Unavailable />}
            </Panel>
          )}
          {has('FEES') && (
            <Panel title="Fees" note={`Successful payments over the last ${FEE_WINDOW_MONTHS} months (UTC calendar months).`}>
              {d.fees ? (
                <div className="space-y-4">
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">Payable</dt><dd className="font-semibold tabular-nums">{rupees(d.fees.outstanding.payable)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Collected</dt><dd className="font-semibold tabular-nums">{rupees(d.fees.outstanding.paid)} <span className="text-xs font-normal text-muted-foreground">({percent(d.fees.outstanding.paid, d.fees.outstanding.payable)})</span></dd></div>
                    <div><dt className="text-xs text-muted-foreground">Outstanding</dt><dd className="font-semibold tabular-nums">{rupees(d.fees.outstanding.balance)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Overdue assessments</dt><dd className="font-semibold tabular-nums">{d.fees.outstanding.overdue.toLocaleString('en-IN')}</dd></div>
                  </dl>
                  <MonthlyBars title="Fees collected per month" data={d.fees.series} unit="₹" />
                  <Link href="/finance" className="text-sm text-primary underline-offset-4 hover:underline">Open fee accounts</Link>
                </div>
              ) : <Unavailable />}
            </Panel>
          )}
        </section>
      )}
    </div>
  );
}
