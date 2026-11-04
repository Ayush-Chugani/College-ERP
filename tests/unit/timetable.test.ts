import { describe, expect, it } from 'vitest';
import { parseTtId, sectionLabel } from '@/features/timetable-data';
import { daysBetween, dayLabel, entrySchema, generateSchema, hhmm, timetableListParams } from '@/lib/timetable-validation';

const ok = { course_offering_section_id: '3', faculty_assignment_id: '', day_of_week: '2', time_slot_id: '5', room_id: '', effective_from: '2025-08-01', effective_to: '' };

describe('entry schema', () => {
  it('parses ids and treats blank optional fields as absent', () => {
    expect(entrySchema.parse(ok)).toEqual({ course_offering_section_id: 3, faculty_assignment_id: undefined, day_of_week: 2, time_slot_id: 5, room_id: undefined, effective_from: '2025-08-01', effective_to: undefined });
    expect(entrySchema.parse({ ...ok, faculty_assignment_id: '7', room_id: '9', effective_to: '2025-12-01' })).toMatchObject({ faculty_assignment_id: 7, room_id: 9 });
  });
  it('rejects bad days, missing selections and reversed dates', () => {
    for (const day of ['0', '8', 'x', '']) expect(entrySchema.safeParse({ ...ok, day_of_week: day }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, course_offering_section_id: '' }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, time_slot_id: '' }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, room_id: 'abc' }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, effective_from: '' }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, effective_to: '2025-07-31' }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, effective_to: '2025-08-01' }).success).toBe(true); // a one-day entry
  });
});

describe('generate schema', () => {
  const g = { course_offering_section_id: '1', from: '2025-09-01', to: '2025-09-30' };
  it('limits the range to 367 days and keeps it ordered', () => {
    expect(generateSchema.safeParse(g).success).toBe(true);
    expect(generateSchema.safeParse({ ...g, to: '2025-08-01' }).success).toBe(false);
    expect(generateSchema.safeParse({ ...g, from: '2025-01-01', to: '2026-01-02' }).success).toBe(true); // 366 days apart
    expect(generateSchema.safeParse({ ...g, from: '2025-01-01', to: '2026-01-03' }).success).toBe(false); // 367 days apart = 368 days
    expect(generateSchema.safeParse({ ...g, from: '' }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('daysBetween counts whole days across month and year ends', () => {
    expect(daysBetween('2025-01-01', '2025-01-01')).toBe(0);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // leap year
  });
  it('labels days and times', () => {
    expect(dayLabel(1)).toBe('Monday');
    expect(dayLabel(7)).toBe('Sunday');
    expect(dayLabel(9)).toBe('Day 9');
    expect(hhmm('09:30:00')).toBe('09:30');
  });
  it('list params fall back safely', () => {
    expect(timetableListParams.parse({ term: 'x', programme: '2', page: '0' })).toEqual({ term: undefined, programme: 2, page: 1 });
  });
  it('parseTtId accepts only positive integers', () => {
    expect(parseTtId('4')).toBe(4);
    for (const bad of ['0', '-3', '2.5', 'a', '', '99999999999999999999']) expect(parseTtId(bad)).toBeNull();
  });
  it('section labels include batch only when present', () => {
    const s = { course_offering_section_id: 1, course_label: 'CS101 — Intro', section_code: 'A', batch_code: null, session_type: 'LECTURE' };
    expect(sectionLabel(s)).toBe('CS101 — Intro · A · LECTURE');
    expect(sectionLabel({ ...s, batch_code: 'B1', session_type: 'PRACTICAL' })).toBe('CS101 — Intro · A/B1 · PRACTICAL');
  });
});
