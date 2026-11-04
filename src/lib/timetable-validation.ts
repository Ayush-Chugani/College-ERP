import { z } from 'zod';
import { optionalId } from '@/lib/validation';

export const DAYS = [
  { n: 1, label: 'Monday' }, { n: 2, label: 'Tuesday' }, { n: 3, label: 'Wednesday' }, { n: 4, label: 'Thursday' }, { n: 5, label: 'Friday' }, { n: 6, label: 'Saturday' }, { n: 7, label: 'Sunday' },
] as const;
export const dayLabel = (n: number) => DAYS.find((d) => d.n === n)?.label ?? `Day ${n}`;

const requiredDate = (what: string) => z.string().min(1, `${what} is required`).regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const optDate = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date');
const id = (what: string) => z.string().min(1, `Select ${what}`).regex(/^\d{1,15}$/, `Select ${what}`).transform(Number);
const optId = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{1,15}$/.test(v), 'Select a valid option').transform((v) => (v === undefined ? undefined : Number(v)));

export const entrySchema = z
  .object({
    course_offering_section_id: id('a teaching section'),
    faculty_assignment_id: optId,
    day_of_week: z.string().regex(/^[1-7]$/, 'Select a day').transform(Number),
    time_slot_id: id('a time slot'),
    room_id: optId,
    effective_from: requiredDate('Start date'),
    effective_to: optDate,
  })
  .refine((v) => !v.effective_to || v.effective_to >= v.effective_from, { path: ['effective_to'], message: 'The end date cannot be before the start date' });
export type EntryInput = z.input<typeof entrySchema>;
export type EntryValues = z.output<typeof entrySchema>;

export const MAX_GENERATE_DAYS = 367;

export const generateSchema = z
  .object({ course_offering_section_id: id('a teaching section'), from: requiredDate('From'), to: requiredDate('To') })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'The end date cannot be before the start date' })
  .refine((v) => daysBetween(v.from, v.to) < MAX_GENERATE_DAYS, { path: ['to'], message: `Generate at most ${MAX_GENERATE_DAYS} days at a time` });
export type GenerateInput = z.input<typeof generateSchema>;
export type GenerateValues = z.output<typeof generateSchema>;

/** Whole days from a to b (both YYYY-MM-DD), inclusive count minus one. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);
}

export const timetableListParams = z.object({
  term: optionalId.catch(undefined),
  programme: optionalId.catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type TimetableListParams = z.infer<typeof timetableListParams>;

export const hhmm = (t: string) => t.slice(0, 5);
