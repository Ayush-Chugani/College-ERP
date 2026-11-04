import { describe, expect, it } from 'vitest';
import { parseAttId } from '@/features/attendance-data';
import { assignmentSchema, buildMarks, correctionSchema, sectionListParams, sessionSchema, statusSchema, teachingSectionSchema } from '@/lib/attendance-validation';

describe('session schema', () => {
  const ok = { session_date: '2025-09-01', start_time: '09:00', end_time: '10:00', session_type: 'LECTURE' };
  it('needs date, ordered times and a valid type; instructor and topic are optional', () => {
    expect(sessionSchema.parse({ ...ok, faculty_assignment_id: '3', planned_topic: ' Intro ' })).toMatchObject({ faculty_assignment_id: 3, planned_topic: 'Intro' });
    expect(sessionSchema.safeParse({ ...ok, end_time: '09:00' }).success).toBe(false); // must be strictly after
    expect(sessionSchema.safeParse({ ...ok, end_time: '08:00' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...ok, start_time: '25:00' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...ok, start_time: '' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...ok, session_date: '' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...ok, session_type: 'PARTY' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...ok, planned_topic: 'x'.repeat(2001) }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...ok, start_time: '09:00:00', end_time: '10:00:00' }).success).toBe(true);
  });
});

describe('assignment and teaching-section schemas', () => {
  it('assignment needs employee, role, start; end not before start; workload is a number', () => {
    const ok = { employee_id: '5', assignment_role: 'PRIMARY_INSTRUCTOR', start_date: '2025-08-01' };
    expect(assignmentSchema.parse({ ...ok, workload_hours: '12.5' }).workload_hours).toBe(12.5);
    expect(assignmentSchema.parse({ ...ok, workload_hours: '' }).workload_hours).toBeUndefined();
    expect(assignmentSchema.safeParse({ ...ok, end_date: '2025-07-01' }).success).toBe(false);
    expect(assignmentSchema.safeParse({ ...ok, end_date: '2025-08-01' }).success).toBe(true);
    expect(assignmentSchema.safeParse({ ...ok, employee_id: '' }).success).toBe(false);
    expect(assignmentSchema.safeParse({ ...ok, assignment_role: 'BOSS' }).success).toBe(false);
    expect(assignmentSchema.safeParse({ ...ok, workload_hours: 'abc' }).success).toBe(false);
  });
  it('teaching section needs course offering, class section and a type; batch optional', () => {
    const ok = { course_offering_id: '1', class_section_id: '2', session_type: 'PRACTICAL' };
    expect(teachingSectionSchema.parse({ ...ok, class_batch_id: '' }).class_batch_id).toBeUndefined();
    for (const k of ['course_offering_id', 'class_section_id', 'session_type']) expect(teachingSectionSchema.safeParse({ ...ok, [k]: '' }).success, k).toBe(false);
  });
});

describe('status and correction schemas', () => {
  it('status needs code and name within limits', () => {
    expect(statusSchema.safeParse({ status_code: 'P', status_name: 'Present', counts_as_present: true, is_active: true }).success).toBe(true);
    expect(statusSchema.safeParse({ status_code: '', status_name: 'x', counts_as_present: true, is_active: true }).success).toBe(false);
    expect(statusSchema.safeParse({ status_code: 'x'.repeat(21), status_name: 'x', counts_as_present: true, is_active: true }).success).toBe(false);
    expect(statusSchema.safeParse({ status_code: 'P', status_name: 'x'.repeat(51), counts_as_present: true, is_active: true }).success).toBe(false);
  });
  it('correction needs a status and a reason up to 1000 characters', () => {
    expect(correctionSchema.parse({ requested_status_id: '2', reason: ' wrong ' })).toEqual({ requested_status_id: 2, reason: 'wrong' });
    expect(correctionSchema.safeParse({ requested_status_id: '', reason: 'x' }).success).toBe(false);
    expect(correctionSchema.safeParse({ requested_status_id: '2', reason: ' ' }).success).toBe(false);
    expect(correctionSchema.safeParse({ requested_status_id: '2', reason: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('buildMarks', () => {
  it('sends only students that were given a status, as numbers, with trimmed capped remarks', () => {
    const marks = buildMarks([
      { roster_id: 1, status_id: '2', remarks: '  ill  ' },
      { roster_id: 2, status_id: '', remarks: 'ignored' },
      { roster_id: 3, status_id: '0', remarks: '' },
      { roster_id: 4, status_id: '3', remarks: 'x'.repeat(600) },
    ]);
    expect(marks).toHaveLength(2);
    expect(marks[0]).toEqual({ roster_id: 1, status_id: 2, remarks: 'ill' });
    expect(marks[1]?.remarks).toHaveLength(500);
    expect(buildMarks([{ roster_id: 9, status_id: '1', remarks: '' }])[0]).toEqual({ roster_id: 9, status_id: 1 });
  });
});

describe('list params and ids', () => {
  it('fall back safely', () => {
    expect(sectionListParams.parse({ page: '-1', term: 'x', programme: 'y' })).toEqual({ page: 1, term: undefined, programme: undefined });
    expect(sectionListParams.parse({ term: '3', programme: '2' })).toMatchObject({ term: 3, programme: 2 });
  });
  it('route ids are positive integers', () => {
    expect(parseAttId('8')).toBe(8);
    for (const bad of ['0', '-1', 'x', '1.5', '', '9'.repeat(20)]) expect(parseAttId(bad)).toBeNull();
  });
});
