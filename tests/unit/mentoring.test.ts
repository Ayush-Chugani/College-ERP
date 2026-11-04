import { describe, expect, it } from 'vitest';
import { parseMentorId, toLocalInput } from '@/features/mentoring-data';
import { assignmentListParams, assignSchema, levelLabel, sessionSchema } from '@/lib/mentoring-validation';

describe('assign schema', () => {
  it('needs both numbers; the start date is optional', () => {
    expect(assignSchema.parse({ student_number: ' S1 ', employee_number: 'E1', start_date: '' })).toEqual({ student_number: 'S1', employee_number: 'E1', start_date: undefined });
    expect(assignSchema.safeParse({ student_number: '', employee_number: 'E1' }).success).toBe(false);
    expect(assignSchema.safeParse({ student_number: 'S1', employee_number: ' ' }).success).toBe(false);
    expect(assignSchema.safeParse({ student_number: 'S1', employee_number: 'E1', start_date: '01/02/2025' }).success).toBe(false);
  });
});

describe('session schema', () => {
  const ok = { session_date: '2025-09-01T10:00', observations: '', action_plan: '', follow_up_date: '', session_status: 'COMPLETED', confidentiality_level: 'RESTRICTED' };
  it('treats blank notes as absent and keeps real ones untrimmed in the middle', () => {
    expect(sessionSchema.parse(ok)).toMatchObject({ observations: undefined, action_plan: undefined, follow_up_date: undefined });
    expect(sessionSchema.parse({ ...ok, observations: 'line one\nline two' }).observations).toBe('line one\nline two');
  });
  it('enforces the follow-up rules, the level and the length limit', () => {
    expect(sessionSchema.safeParse({ ...ok, follow_up_date: '2025-08-31' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...ok, follow_up_date: '2025-09-01' }).success).toBe(true);
    expect(sessionSchema.safeParse({ ...ok, session_status: 'FOLLOW_UP_REQUIRED' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...ok, session_status: 'FOLLOW_UP_REQUIRED', follow_up_date: '2025-10-01' }).success).toBe(true);
    expect(sessionSchema.safeParse({ ...ok, confidentiality_level: 'SECRET' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...ok, session_status: 'DONE' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...ok, observations: 'x'.repeat(10001) }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...ok, session_date: '' }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('list params fall back safely', () => {
    expect(assignmentListParams.parse({ q: ' a ', status: 'NOPE', page: '-1' })).toEqual({ q: 'a', status: undefined, page: 1 });
  });
  it('parseMentorId accepts only positive integers', () => {
    expect(parseMentorId('3')).toBe(3);
    for (const bad of ['0', '-2', '1.5', 'x', '', '99999999999999999999']) expect(parseMentorId(bad)).toBeNull();
  });
  it('labels levels and builds datetime-local values', () => {
    expect(levelLabel('HIGHLY_RESTRICTED')).toBe('Highly restricted');
    expect(levelLabel('NORMAL')).toBe('Normal');
    expect(toLocalInput('2025-09-01T10:30:00')).toBe('2025-09-01T10:30');
  });
});
