import { describe, expect, it } from 'vitest';
import { parseAnnId } from '@/features/communication-data';
import { announcementSchema, listParams, statusLabel, toLocalInput } from '@/lib/communication-validation';

const ok = { announcement_type_id: '1', department_id: '', title: ' Library hours ', description: 'Opens at 9.', publish_from: '2025-09-01T09:00', publish_to: '', audience_type: 'ALL' };

describe('announcement schema', () => {
  it('parses ids, trims text and treats a blank department or end as absent', () => {
    expect(announcementSchema.parse(ok)).toEqual({ announcement_type_id: 1, department_id: undefined, title: 'Library hours', description: 'Opens at 9.', publish_from: '2025-09-01T09:00', publish_to: undefined, audience_type: 'ALL' });
    expect(announcementSchema.parse({ ...ok, department_id: '4', audience_type: 'DEPARTMENT' }).department_id).toBe(4);
  });
  it('rejects missing or over-long text, bad audiences and unordered times', () => {
    expect(announcementSchema.safeParse({ ...ok, title: '  ' }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, title: 'x'.repeat(251) }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, description: '' }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, description: 'x'.repeat(20001) }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, audience_type: 'PROGRAMME' }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, audience_type: 'CUSTOM' }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, announcement_type_id: '' }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, publish_from: '' }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, publish_to: '2025-09-01T09:00' }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, publish_to: '2025-09-01T09:01' }).success).toBe(true);
  });
  it('a department audience needs a department', () => {
    expect(announcementSchema.safeParse({ ...ok, audience_type: 'DEPARTMENT' }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, audience_type: 'DEPARTMENT', department_id: 'abc' }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('list params fall back safely', () => {
    expect(listParams.parse({ q: ' hi ', status: 'NOPE', page: '-3' })).toEqual({ q: 'hi', status: undefined, page: 1 });
  });
  it('parseAnnId accepts only positive integers', () => {
    expect(parseAnnId('8')).toBe(8);
    for (const bad of ['0', '-1', '1.5', 'x', '', '99999999999999999999']) expect(parseAnnId(bad)).toBeNull();
  });
  it('labels statuses and builds datetime-local values', () => {
    expect(statusLabel('APPROVED')).toBe('Approved');
    expect(toLocalInput('2025-09-01T10:30:00')).toBe('2025-09-01T10:30');
  });
});
