import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStaffId } from '@/features/staff-data';
import { ownerStorageKey, storageKey } from '@/lib/document-validation';
import { ACTIVITY_GROUPS, buildDetail, contributorSchema, detailToRaw, fieldKind, humanize, listParams, LOOKUP_TABLES, OPTION_TABLES, staffPayload, staffSchema, type DetailColumn } from '@/lib/staff-validation';

const col = (o: Partial<DetailColumn> & { name: string }): DetailColumn => ({ type: 'character varying', required: false, max_length: 100, ref_table: null, choices: null, ...o });

describe('staff schema', () => {
  const ok = { activity_type_id: '4', activity_title: ' Paper ', start_date: '', end_date: '', academic_year_id: '3', description: '' };
  it('parses ids, trims and blanks optional fields', () => {
    expect(staffSchema.parse(ok)).toMatchObject({ activity_type_id: 4, activity_title: 'Paper', academic_year_id: 3, start_date: undefined, description: undefined });
    expect(Object.values(staffPayload(staffSchema.parse(ok)))).not.toContain(undefined);
  });
  it('rejects bad input', () => {
    for (const bad of [{ activity_type_id: '' }, { activity_title: ' ' }, { activity_title: 'x'.repeat(501) }, { start_date: '1/2/2026' }, { academic_year_id: 'x' }, { start_date: '2026-02-01', end_date: '2026-01-01' }]) {
      expect(staffSchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it('contributor needs a number or a name, and a sane email', () => {
    expect(contributorSchema.safeParse({ kind: 'EMPLOYEE' }).success).toBe(false);
    expect(contributorSchema.safeParse({ kind: 'EMPLOYEE', employee_number: 'E7' }).success).toBe(true);
    expect(contributorSchema.safeParse({ kind: 'EXTERNAL' }).success).toBe(false);
    expect(contributorSchema.safeParse({ kind: 'EXTERNAL', external_name: 'A', external_email: 'bad' }).success).toBe(false);
  });
});

describe('generic detail forms', () => {
  it('classifies columns', () => {
    expect(fieldKind(col({ name: 'a', type: 'boolean' }))).toBe('boolean');
    expect(fieldKind(col({ name: 'a', type: 'date' }))).toBe('date');
    expect(fieldKind(col({ name: 'a', type: 'timestamp with time zone' }))).toBe('datetime');
    expect(fieldKind(col({ name: 'a', type: 'smallint' }))).toBe('integer');
    expect(fieldKind(col({ name: 'a', type: 'numeric' }))).toBe('decimal');
    expect(fieldKind(col({ name: 'a', type: 'text', max_length: null }))).toBe('longtext');
    expect(fieldKind(col({ name: 'a', max_length: 1000 }))).toBe('longtext');
    expect(fieldKind(col({ name: 'a', type: 'text', choices: ['X', 'Y'] }))).toBe('choice');
    expect(fieldKind(col({ name: 'journal_id', type: 'bigint', ref_table: 'journal' }))).toBe('ref');
    expect(fieldKind(col({ name: 'x_id', type: 'bigint', ref_table: 'research_proposal' }))).toBe('number-id');
  });
  it('turns form strings into a payload and reports problems per column', () => {
    const cols = [
      col({ name: 'paper_title', required: true }), col({ name: 'year', type: 'integer', required: true }), col({ name: 'amount', type: 'numeric' }), col({ name: 'when', type: 'date' }),
      col({ name: 'open_access', type: 'boolean' }), col({ name: 'journal_id', type: 'bigint', ref_table: 'journal', required: true }), col({ name: 'status', type: 'text', choices: ['CLAIMED', 'VERIFIED'] }),
      col({ name: 'short', max_length: 5 }),
    ];
    const good = buildDetail(cols, { paper_title: ' Title ', year: '2026', amount: '12.50', when: '2026-02-03', open_access: true, journal_id: '4', status: 'CLAIMED', short: 'abc' });
    expect(good.errors).toEqual({});
    expect(good.values).toEqual({ paper_title: 'Title', year: 2026, amount: 12.5, when: '2026-02-03', open_access: true, journal_id: 4, status: 'CLAIMED', short: 'abc' });
    const blank = buildDetail(cols, {});
    expect(blank.errors).toEqual({ paper_title: 'Required', year: 'Required', journal_id: 'Required' });
    expect(blank.values).toMatchObject({ amount: null, when: null, open_access: false, status: null });
    const bad = buildDetail(cols, { paper_title: 'x', year: '20x', amount: '1,5', when: '31/12/2026', journal_id: 'a', status: 'NOPE', short: 'toolong' });
    expect(Object.keys(bad.errors).sort()).toEqual(['amount', 'journal_id', 'short', 'status', 'when', 'year']);
  });
  it('round-trips a stored row back to form strings', () => {
    const cols = [col({ name: 'paper_title' }), col({ name: 'open_access', type: 'boolean' }), col({ name: 'year', type: 'integer' }), col({ name: 'at', type: 'timestamp with time zone' })];
    expect(detailToRaw(cols, { paper_title: 'T', open_access: true, year: 2026, at: '2026-03-04T05:06:00+00:00' })).toEqual({ paper_title: 'T', open_access: true, year: '2026', at: '2026-03-04T05:06' });
    expect(detailToRaw(cols, {})).toEqual({ paper_title: '', open_access: false, year: '', at: '' });
  });
  it('humanizes column names', () => {
    expect(humanize('journal_id')).toBe('Journal');
    expect(humanize('page_from')).toBe('Page from');
  });
});

describe('helpers and drift', () => {
  it('parses ids, list params and storage keys', () => {
    expect(parseStaffId('9')).toBe(9);
    expect(parseStaffId('0')).toBeNull();
    expect(listParams.parse({ group: 'NOPE', status: 'APPROVED', page: '2' })).toEqual({ q: undefined, status: 'APPROVED', group: undefined, page: 2 });
    expect(ownerStorageKey('employee', 5, 'My Paper.pdf', 'r1')).toBe('employee/5/r1-My_Paper.pdf');
    expect(storageKey(5, 'a.pdf', 'r1')).toBe('student/5/r1-a.pdf');
  });
  it('lists mirror the migrations (drift test)', () => {
    const m044 = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/044_staff_profile.sql'), 'utf8');
    const arr = (fn: string) => [...(new RegExp(`FUNCTION sims_private\\.${fn}\\(\\)[\\s\\S]*?ARRAY\\[([^\\]]*)\\]`).exec(m044)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(arr('staff_option_tables').sort()).toEqual([...OPTION_TABLES].sort());
    expect(arr('staff_lookup_tables').sort()).toEqual([...LOOKUP_TABLES].sort());
    const m010 = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/010_staff_profile_and_research.sql'), 'utf8');
    const groups = [...(/enum_activity_group CHECK \(activity_group IN \(([^)]*)\)/.exec(m010)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(groups.sort()).toEqual([...ACTIVITY_GROUPS].sort());
  });
});
