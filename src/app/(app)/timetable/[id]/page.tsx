import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getTimetableOffering, loadTimetable, parseTtId } from '@/features/timetable-data';
import { EndEntry, EntryForm, GenerateForm } from '@/features/timetable-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';
import { DAYS, hhmm } from '@/lib/timetable-validation';

export const metadata: Metadata = { title: 'Weekly timetable' };

export default async function TimetableOfferingPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseTtId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const info = await getTimetableOffering(supabase, id);
  if (!info) notFound(); // missing or not permitted: same response
  const { entries, sections, slots, rooms } = await loadTimetable(supabase, id);
  const canWrite = can(ctx, 'TIMETABLE.ALL.CREATE');
  const canEdit = can(ctx, 'TIMETABLE.ALL.UPDATE');
  const canGenerate = can(ctx, 'ATTENDANCE.ALL.CREATE');
  const th = 'px-3 py-2 font-medium';

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{info.programme_name}</h1>
          <p className="text-sm text-muted-foreground">{info.semester_name} · {info.term_name} · {entries.length} weekly entr{entries.length === 1 ? 'y' : 'ies'}</p>
        </div>
        <Link href="/timetable" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">All programme terms</Link>
      </div>

      <Card>
        <CardHeader><CardTitle>Weekly timetable</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          {entries.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
          {DAYS.map((d) => {
            const rows = entries.filter((e) => e.day_of_week === d.n);
            if (rows.length === 0) return null;
            return (
              <section key={d.n} aria-label={d.label}>
                <h3 className="mb-1 text-sm font-semibold">{d.label}</h3>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-left"><tr>
                      <th scope="col" className={th}>Time</th><th scope="col" className={th}>Course</th><th scope="col" className={th}>Section</th><th scope="col" className={th}>Instructor</th>
                      <th scope="col" className={th}>Room</th><th scope="col" className={th}>Period</th>{canEdit && <th scope="col" className={th}><span className="sr-only">Actions</span></th>}
                    </tr></thead>
                    <tbody>
                      {rows.map((e) => (
                        <tr key={e.timetable_session_id} className="border-t border-border">
                          <td className="px-3 py-2 whitespace-nowrap">{hhmm(e.start_time)}–{hhmm(e.end_time)} <span className="text-xs text-muted-foreground">{e.slot_code}</span></td>
                          <td className="px-3 py-2">{e.course_label}</td>
                          <td className="px-3 py-2">{e.section_code}{e.batch_code ? `/${e.batch_code}` : ''} · {e.session_type}</td>
                          <td className="px-3 py-2">{e.instructor_name ?? '—'}</td><td className="px-3 py-2">{e.room_label ?? '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{e.effective_from}{e.effective_to ? ` → ${e.effective_to}` : ' →'}</td>
                          {canEdit && <td className="px-3 py-2">{e.effective_to === null ? <EndEntry entry={e} /> : null}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </CardContent>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader><CardTitle>Add an entry</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Room, instructor and section clashes are refused. Back-to-back slots are allowed.</p>
            <EntryForm sections={sections} slots={slots} rooms={rooms} />
          </CardContent>
        </Card>
      )}

      {canGenerate && (
        <Card>
          <CardHeader><CardTitle>Create class sessions</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Creates planned class sessions (for attendance) on the weekdays this section is timetabled. Existing sessions are left alone, so it is safe to repeat. Up to 367 days at a time.</p>
            <GenerateForm sections={sections} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
