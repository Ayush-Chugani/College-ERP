'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { sectionLabel, type AssignmentOpt, type EntryRow, type RoomRow, type SectionOpt, type SlotRow } from '@/features/timetable-data';
import { DAYS, entrySchema, generateSchema, hhmm, type EntryInput, type EntryValues, type GenerateInput, type GenerateValues } from '@/lib/timetable-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
/** Clash and rule messages raised by the timetable guard are safe to show; RLS failures are generic. */
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023') return e.message;
  if (e.code === '42501') return /Not authorised/.test(e.message) ? e.message : 'You are not allowed to change this timetable.';
  if (e.code === '23505') return 'That room, day, slot and start date already has an entry.';
  if (e.code === '23503') return 'It is referenced by generated class sessions, or a selected option does not exist.';
  return fallback;
}
const nul = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);

export function EntryForm({ sections, slots, rooms }: { sections: SectionOpt[]; slots: SlotRow[]; rooms: RoomRow[] }) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<AssignmentOpt[]>([]);
  const form = useForm<EntryInput, unknown, EntryValues>({ resolver: zodResolver(entrySchema), defaultValues: { day_of_week: '1' } });
  const e = form.formState.errors;
  const slotId = form.watch('time_slot_id');
  const campus = slots.find((s) => String(s.time_slot_id) === String(slotId))?.campus_id;
  const roomOpts = rooms.filter((r) => campus === undefined || r.campus_id === campus);

  async function loadAssignments(cos: string) {
    form.setValue('faculty_assignment_id', '');
    setAssignments([]);
    if (!/^\d+$/.test(cos)) return;
    const { data } = await createClient().rpc('timetable_assignments', { p_cos_id: Number(cos) });
    setAssignments(((data ?? []) as AssignmentOpt[]).filter((a) => a.assignment_status === 'ACTIVE'));
  }
  async function submit(v: EntryValues) {
    const { error } = await createClient().from('timetable_session').insert({
      course_offering_section_id: v.course_offering_section_id, faculty_assignment_id: nul(v.faculty_assignment_id), day_of_week: v.day_of_week, time_slot_id: v.time_slot_id,
      room_id: nul(v.room_id), effective_from: v.effective_from, effective_to: nul(v.effective_to),
    });
    if (error) return void toast.error(dbMessage(error, 'Could not add the entry.'));
    toast.success('Timetable entry added.');
    form.reset({ day_of_week: v.day_of_week.toString(), effective_from: v.effective_from });
    setAssignments([]);
    router.refresh();
  }

  if (sections.length === 0) return <p className="text-sm text-muted-foreground">This offering has no teaching sections yet. Create them under Attendance first.</p>;
  if (slots.length === 0) return <p className="text-sm text-muted-foreground">No usable time slots exist on a campus you can access. Time slots are defined under the academic calendar by an administrator.</p>;
  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Add timetable entry">
      <SelectField id="tes" label="Teaching section *" className="w-80" options={sections.map((s) => ({ id: s.course_offering_section_id, label: sectionLabel(s) }))} {...form.register('course_offering_section_id', { onChange: (ev) => void loadAssignments(ev.target.value) })} error={e.course_offering_section_id?.message} />
      <SelectField id="tef" label="Instructor" className="w-56" options={assignments.map((a) => ({ id: a.faculty_assignment_id, label: `${a.employee_name} (${a.assignment_role})` }))} emptyHint="Pick a section; only active assignments are listed." {...form.register('faculty_assignment_id')} error={e.faculty_assignment_id?.message} />
      <div className="w-36">
        <label htmlFor="ted" className="text-sm font-medium">Day *</label>
        <select id="ted" className="flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm" {...form.register('day_of_week')}>{DAYS.map((d) => <option key={d.n} value={d.n}>{d.label}</option>)}</select>
      </div>
      <SelectField id="tet" label="Time slot *" className="w-56" options={slots.map((s) => ({ id: s.time_slot_id, label: `${s.slot_code} ${hhmm(s.start_time)}–${hhmm(s.end_time)} (${s.campus_name})` }))} {...form.register('time_slot_id')} error={e.time_slot_id?.message} />
      <SelectField id="ter" label="Room" className="w-44" options={roomOpts.map((r) => ({ id: r.room_id, label: r.room_label }))} hint={campus === undefined ? 'Rooms are filtered to the slot’s campus.' : undefined} {...form.register('room_id')} error={e.room_id?.message} />
      <TextField id="tef2" label="From *" type="date" className="w-40" {...form.register('effective_from')} error={e.effective_from?.message} />
      <TextField id="tet2" label="Until" type="date" className="w-40" {...form.register('effective_to')} error={e.effective_to?.message} />
      <div className="pt-6"><Button type="submit" disabled={form.formState.isSubmitting}>Add entry</Button></div>
    </form>
  );
}

/** End an entry on a date (entries cannot be deleted by most roles and are pinned by generated sessions). */
export function EndEntry({ entry }: { entry: EntryRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return void toast.error('Choose a valid date.');
    if (date < entry.effective_from) return void toast.error('The end date cannot be before the start date.');
    setBusy(true);
    const { data, error } = await createClient().from('timetable_session').update({ effective_to: date }).eq('timetable_session_id', entry.timetable_session_id).select('timetable_session_id');
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'Could not end the entry.'));
    if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
    toast.success('Entry ended.');
    setOpen(false);
    router.refresh();
  }
  if (!open) return <Button type="button" variant="outline" onClick={() => setOpen(true)}>End…</Button>;
  return (
    <span className="inline-flex items-center gap-2">
      <input type="date" aria-label="Last day of this entry" value={date} onChange={(ev) => setDate(ev.target.value)} className="h-9 rounded-md border border-border bg-card px-2 text-sm" />
      <Button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
    </span>
  );
}

export function GenerateForm({ sections }: { sections: SectionOpt[] }) {
  const router = useRouter();
  const form = useForm<GenerateInput, unknown, GenerateValues>({ resolver: zodResolver(generateSchema) });
  const e = form.formState.errors;
  async function submit(v: GenerateValues) {
    const { data, error } = await createClient().rpc('timetable_generate_sessions', { p_cos_id: v.course_offering_section_id, p_from: v.from, p_to: v.to });
    if (error) return void toast.error(dbMessage(error, 'Could not generate class sessions.'));
    const n = Number(data);
    toast.success(n === 0 ? 'Nothing new to create; the sessions already exist.' : `${n} class session${n === 1 ? '' : 's'} created.`);
    router.refresh();
  }
  if (sections.length === 0) return null;
  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Generate class sessions">
      <SelectField id="gs" label="Teaching section *" className="w-80" options={sections.map((s) => ({ id: s.course_offering_section_id, label: sectionLabel(s) }))} {...form.register('course_offering_section_id')} error={e.course_offering_section_id?.message} />
      <TextField id="gf" label="From *" type="date" className="w-40" {...form.register('from')} error={e.from?.message} />
      <TextField id="gt" label="To *" type="date" className="w-40" {...form.register('to')} error={e.to?.message} />
      <div className="pt-6"><Button type="submit" variant="outline" disabled={form.formState.isSubmitting}>Generate sessions</Button></div>
    </form>
  );
}
