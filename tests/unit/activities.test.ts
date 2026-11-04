import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseActId } from '@/features/activity-data';
import { ACHIEVEMENTS, activityPayload, activitySchema, APPROVAL_STATUSES, evidenceSchema, listParams, reviewSchema, teamSchema, VERIFY_DECISIONS } from '@/lib/activity-validation';

const ok = { student_activity_type_id: '3', activity_title: ' Hackathon ', achievement_type: 'WINNER', start_date: '2026-01-10', end_date: '', position_rank: '', activity_url: '', academic_year_id: '' };

describe('activity schema', () => {
  it('parses ids and numbers, trims, and turns blanks into undefined', () => {
    const v = activitySchema.parse({ ...ok, position_rank: '2', academic_year_id: '5', city: ' Pune ' });
    expect(v).toMatchObject({ student_activity_type_id: 3, activity_title: 'Hackathon', position_rank: 2, academic_year_id: 5, city: 'Pune', end_date: undefined, activity_url: undefined });
  });
  it('rejects bad input', () => {
    for (const bad of [{ activity_title: ' ' }, { activity_title: 'x'.repeat(501) }, { student_activity_type_id: '' }, { achievement_type: 'GOLDEN' }, { position_rank: '0' }, { position_rank: '1.5' }, { activity_url: 'ftp://x' }, { start_date: '10/01/2026' }, { academic_year_id: 'abc' }]) {
      expect(activitySchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it('end date cannot precede start date', () => {
    expect(activitySchema.safeParse({ ...ok, end_date: '2026-01-09' }).success).toBe(false);
    expect(activitySchema.safeParse({ ...ok, end_date: '2026-01-10' }).success).toBe(true);
  });
  it('payload sends null for every empty column', () => {
    const p = activityPayload(activitySchema.parse(ok));
    expect(p.end_date).toBeNull();
    expect(p.activity_title).toBe('Hackathon');
    expect(Object.values(p)).not.toContain(undefined);
  });
});

describe('review, team and evidence schemas', () => {
  it('only a plain verification or approval needs no remarks', () => {
    expect(reviewSchema.safeParse({ step: 'VERIFY', decision: 'VERIFIED' }).success).toBe(true);
    expect(reviewSchema.safeParse({ step: 'VERIFY', decision: 'NEEDS_CORRECTION' }).success).toBe(false);
    expect(reviewSchema.safeParse({ step: 'VERIFY', decision: 'REJECTED', remarks: 'fake' }).success).toBe(true);
    expect(reviewSchema.safeParse({ step: 'APPROVE', decision: 'REJECTED' }).success).toBe(false);
    expect(reviewSchema.safeParse({ step: 'APPROVE', decision: 'APPROVED' }).success).toBe(true);
    expect(reviewSchema.safeParse({ step: 'APPROVE', decision: 'NEEDS_CORRECTION', remarks: 'x' }).success).toBe(false);
    expect(reviewSchema.safeParse({ step: 'VERIFY', decision: '' }).success).toBe(false);
  });
  it('team member needs a student number or a name; email must look like one', () => {
    expect(teamSchema.safeParse({ kind: 'STUDENT' }).success).toBe(false);
    expect(teamSchema.safeParse({ kind: 'STUDENT', student_number: 'S9' }).success).toBe(true);
    expect(teamSchema.safeParse({ kind: 'EXTERNAL' }).success).toBe(false);
    expect(teamSchema.safeParse({ kind: 'EXTERNAL', external_name: 'A', external_email: 'nope' }).success).toBe(false);
    expect(teamSchema.safeParse({ kind: 'EXTERNAL', external_name: 'A', external_email: 'a@b.co' }).success).toBe(true);
  });
  it('evidence needs a document type and title', () => {
    expect(evidenceSchema.safeParse({ document_type_id: '', title: 'x' }).success).toBe(false);
    expect(evidenceSchema.safeParse({ document_type_id: '2', title: ' ' }).success).toBe(false);
    expect(evidenceSchema.parse({ document_type_id: '2', title: ' Cert ', evidence_type_id: '' })).toMatchObject({ document_type_id: 2, title: 'Cert', evidence_type_id: undefined });
  });
});

describe('helpers and drift', () => {
  it('parses list params and ids', () => {
    expect(listParams.parse({ status: 'BAD', page: 'x' })).toEqual({ q: undefined, status: undefined, page: 1 });
    expect(parseActId('7')).toBe(7);
    expect(parseActId('07x')).toBeNull();
  });
  it('lists mirror the migrations (drift test)', () => {
    const m013 = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/013_student_activity_and_evidence.sql'), 'utf8');
    const enumBody = /enum_achievement_type CHECK \(achievement_type IN \(([^)]*)\)/.exec(m013)?.[1] ?? '';
    expect([...enumBody.matchAll(/'(\w+)'/g)].map((x) => x[1]).sort()).toEqual([...ACHIEVEMENTS].sort());
    const m043 = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/043_student_activities.sql'), 'utf8');
    for (const a of ACHIEVEMENTS) expect(m043).toContain(`'${a}'`);
    for (const s of VERIFY_DECISIONS) expect(m043).toContain(`'${s}'`);
    const m011 = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/011_evidence_and_seed_data.sql'), 'utf8');
    for (const s of APPROVAL_STATUSES) expect(m011).toContain(`('${s}',`);
  });
});
