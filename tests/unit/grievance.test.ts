import { describe, expect, it } from 'vitest';
import { parseGrvId } from '@/features/grievance-data';
import { actionSchema, categorySchema, label, listParams, STATUSES, submitSchema, TRANSITIONS } from '@/lib/grievance-validation';

describe('submit schema', () => {
  const ok = { grievance_category_id: '2', department_id: '', subject: ' Broken projector ', description: 'It does not work.', priority: 'HIGH' };
  it('parses ids, trims text and treats the department as optional', () => {
    expect(submitSchema.parse(ok)).toEqual({ grievance_category_id: 2, department_id: undefined, subject: 'Broken projector', description: 'It does not work.', priority: 'HIGH' });
    expect(submitSchema.parse({ ...ok, department_id: '7' }).department_id).toBe(7);
  });
  it('rejects missing or over-long fields and unknown values', () => {
    expect(submitSchema.safeParse({ ...ok, grievance_category_id: '' }).success).toBe(false);
    expect(submitSchema.safeParse({ ...ok, subject: '  ' }).success).toBe(false);
    expect(submitSchema.safeParse({ ...ok, subject: 'x'.repeat(201) }).success).toBe(false);
    expect(submitSchema.safeParse({ ...ok, description: '' }).success).toBe(false);
    expect(submitSchema.safeParse({ ...ok, description: 'x'.repeat(5001) }).success).toBe(false);
    expect(submitSchema.safeParse({ ...ok, priority: 'MEH' }).success).toBe(false);
    expect(submitSchema.safeParse({ ...ok, department_id: 'abc' }).success).toBe(false);
  });
});

describe('action schema', () => {
  it('comments and internal notes need a note and no status', () => {
    expect(actionSchema.safeParse({ action_type: 'COMMENT', notes: 'hello' }).success).toBe(true);
    expect(actionSchema.safeParse({ action_type: 'COMMENT', notes: '  ' }).success).toBe(false);
    expect(actionSchema.safeParse({ action_type: 'INTERNAL_NOTE' }).success).toBe(false);
    expect(actionSchema.safeParse({ action_type: 'SHOUT', notes: 'x' }).success).toBe(false);
  });
  it('a status change needs a known status, and resolving or rejecting needs a resolution', () => {
    expect(actionSchema.safeParse({ action_type: 'STATUS_CHANGE', new_status: '' }).success).toBe(false);
    expect(actionSchema.safeParse({ action_type: 'STATUS_CHANGE', new_status: 'DONE' }).success).toBe(false);
    expect(actionSchema.safeParse({ action_type: 'STATUS_CHANGE', new_status: 'ASSIGNED' }).success).toBe(true);
    expect(actionSchema.safeParse({ action_type: 'STATUS_CHANGE', new_status: 'RESOLVED' }).success).toBe(false);
    expect(actionSchema.safeParse({ action_type: 'STATUS_CHANGE', new_status: 'REJECTED', resolution: 'Out of scope' }).success).toBe(true);
  });
});

describe('transitions', () => {
  it('mirror the database (one-way except re-opening a resolved grievance; CLOSED is final)', () => {
    expect(TRANSITIONS).toEqual({
      SUBMITTED: ['ASSIGNED', 'REJECTED'], ASSIGNED: ['UNDER_REVIEW', 'REJECTED'], UNDER_REVIEW: ['RESOLVED', 'REJECTED'], RESOLVED: ['CLOSED', 'UNDER_REVIEW'], REJECTED: ['CLOSED'], CLOSED: [],
    });
    for (const s of STATUSES) expect(TRANSITIONS[s]).toBeDefined();
  });
});

describe('helpers', () => {
  it('categories need a code and a name', () => {
    expect(categorySchema.safeParse({ category_code: ' ', category_name: 'x' }).success).toBe(false);
    expect(categorySchema.parse({ category_code: 'FAC', category_name: ' Facilities ' })).toEqual({ category_code: 'FAC', category_name: 'Facilities' });
  });
  it('list params fall back safely', () => {
    expect(listParams.parse({ q: ' a ', status: 'NOPE', priority: 'HIGH', page: '0' })).toEqual({ q: 'a', status: undefined, priority: 'HIGH', page: 1 });
  });
  it('parseGrvId accepts only positive integers; label humanises codes', () => {
    expect(parseGrvId('5')).toBe(5);
    for (const bad of ['0', '-1', '2.5', 'x', '', '99999999999999999999']) expect(parseGrvId(bad)).toBeNull();
    expect(label('UNDER_REVIEW')).toBe('Under review');
  });
});
