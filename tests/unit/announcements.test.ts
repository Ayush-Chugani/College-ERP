import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAnnId } from '@/features/announcement-data';
import { announcementSchema, label, listParams, STATUSES, toLocalInput, TRANSITIONS } from '@/lib/announcement-validation';

const ok = { announcement_type_id: '1', department_id: '', title: ' Holiday ', description: 'Closed Friday.', audience_type: 'ALL', publish_from: '2026-01-01T09:00', publish_to: '' };

describe('announcement schema', () => {
  it('parses ids, trims text and treats department and end date as optional', () => {
    const v = announcementSchema.parse(ok);
    expect(v).toMatchObject({ announcement_type_id: 1, department_id: undefined, title: 'Holiday', publish_to: undefined });
    expect(announcementSchema.parse({ ...ok, department_id: '4' }).department_id).toBe(4);
  });
  it('rejects bad input', () => {
    for (const bad of [{ title: ' ' }, { title: 'x'.repeat(251) }, { description: '' }, { announcement_type_id: '' }, { audience_type: 'NOPE' }, { publish_from: '' }, { publish_from: 'tomorrow' }, { department_id: 'abc' }]) {
      expect(announcementSchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it('needs a department for department and programme audiences and an end after the start', () => {
    expect(announcementSchema.safeParse({ ...ok, audience_type: 'DEPARTMENT' }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, audience_type: 'PROGRAMME', department_id: '2' }).success).toBe(true);
    expect(announcementSchema.safeParse({ ...ok, publish_to: '2025-12-31T09:00' }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...ok, publish_to: '2026-02-01T09:00' }).success).toBe(true);
  });
});

describe('helpers', () => {
  it('lists, labels, ids and datetime-local values', () => {
    expect(listParams.parse({ q: ' a ', status: 'BAD', page: '0' })).toEqual({ q: 'a', status: undefined, page: 1 });
    expect(label('PENDING')).toBe('Pending');
    expect(parseAnnId('12')).toBe(12);
    expect(parseAnnId('0')).toBeNull();
    expect(parseAnnId('1e3')).toBeNull();
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput('2026-03-04T05:06:00Z')).toMatch(/^2026-03-0[34]T\d\d:06$/);
  });
  it('TRANSITIONS mirror the database function (drift test)', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/040_announcements.sql'), 'utf8');
    const body = /announcement_transition_ok[\s\S]*?IN \(([\s\S]*?)\)\s*\$\$/.exec(sql)?.[1] ?? '';
    const db = [...body.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
    const app = STATUSES.flatMap((f) => (TRANSITIONS[f] ?? []).map((t) => `${f}>${t}`)).sort();
    expect(app).toEqual(db);
    expect(db.length).toBe(5);
  });
});
