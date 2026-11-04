import { describe, expect, it } from 'vitest';
import { parseAsmId } from '@/features/assessment-data';
import {
  buildMarkEntries, componentSchema, eventSchema, gradeRuleSchema, gradeScaleSchema, offeringListParams, validateMarkRow, validateResultRow, type MarkRow, type ResultRow,
} from '@/lib/assessment-validation';

describe('component schema', () => {
  const ok = { component_code: 'T1', component_name: 'Test 1', component_type: 'INTERNAL_TEST', maximum_marks: '20', weightage_percent: '', is_mandatory: true };
  it('needs code, name, type and max marks; weightage optional and at most 100', () => {
    expect(componentSchema.parse(ok)).toMatchObject({ maximum_marks: 20, weightage_percent: undefined });
    expect(componentSchema.parse({ ...ok, weightage_percent: '12.5' }).weightage_percent).toBe(12.5);
    expect(componentSchema.safeParse({ ...ok, maximum_marks: '' }).success).toBe(false);
    expect(componentSchema.safeParse({ ...ok, maximum_marks: '1.234' }).success).toBe(false);
    expect(componentSchema.safeParse({ ...ok, weightage_percent: '100.5' }).success).toBe(false);
    expect(componentSchema.safeParse({ ...ok, component_type: 'EXAM' }).success).toBe(false);
    expect(componentSchema.safeParse({ ...ok, component_code: ' ' }).success).toBe(false);
  });
});

describe('event schema', () => {
  const ok = { event_title: 'Midterm', assessment_date: '2025-10-01', start_time: '', end_time: '', maximum_marks: '50', reduced_maximum_marks: '', event_number: '', details: '' };
  it('checks times, reduced maximum and event number', () => {
    expect(eventSchema.parse(ok)).toMatchObject({ maximum_marks: 50, reduced_maximum_marks: undefined, event_number: undefined });
    expect(eventSchema.parse({ ...ok, start_time: '09:00', end_time: '10:00', event_number: '2' })).toMatchObject({ event_number: 2 });
    expect(eventSchema.safeParse({ ...ok, start_time: '10:00', end_time: '10:00' }).success).toBe(false);
    expect(eventSchema.safeParse({ ...ok, reduced_maximum_marks: '60' }).success).toBe(false);
    expect(eventSchema.safeParse({ ...ok, event_number: '0' }).success).toBe(false);
    expect(eventSchema.safeParse({ ...ok, event_number: '70000' }).success).toBe(false);
    expect(eventSchema.safeParse({ ...ok, assessment_date: '' }).success).toBe(false);
  });
});

describe('grade schemas', () => {
  it('scale dates must be ordered', () => {
    expect(gradeScaleSchema.safeParse({ scale_name: 'S', effective_from: '2025-01-01', effective_to: '2024-01-01', is_active: true }).success).toBe(false);
    expect(gradeScaleSchema.safeParse({ scale_name: 'S', effective_from: '2025-01-01', effective_to: '', is_active: true }).success).toBe(true);
  });
  it('rule bands must be ordered and within 0-100', () => {
    const ok = { grade_letter: 'A', grade_point: '9', minimum_percentage: '80', maximum_percentage: '89.99', result_status: 'PASS' };
    expect(gradeRuleSchema.parse(ok)).toMatchObject({ grade_point: 9, minimum_percentage: 80 });
    expect(gradeRuleSchema.safeParse({ ...ok, maximum_percentage: '70' }).success).toBe(false);
    expect(gradeRuleSchema.safeParse({ ...ok, maximum_percentage: '101' }).success).toBe(false);
    expect(gradeRuleSchema.safeParse({ ...ok, grade_letter: 'ABCDEF' }).success).toBe(false);
    expect(gradeRuleSchema.safeParse({ ...ok, result_status: 'INCOMPLETE' }).success).toBe(false);
  });
});

describe('marks entry', () => {
  const row = (p: Partial<MarkRow> = {}): MarkRow => ({ course_registration_id: 1, status: 'PRESENT', marks: '', reduced: '', remarks: '', touched: true, ...p });
  it('rejects bad, excessive, or status-inconsistent marks', () => {
    expect(validateMarkRow(row({ marks: '15' }), 20, null)).toBeNull();
    expect(validateMarkRow(row({ marks: '20.5' }), 20, null)).toMatch(/exceed/);
    expect(validateMarkRow(row({ marks: '-1' }), 20, null)).toMatch(/non-negative/);
    expect(validateMarkRow(row({ marks: '1.234' }), 20, null)).toMatch(/2 decimals/);
    expect(validateMarkRow(row({ reduced: '5' }), 20, null)).toMatch(/no reduced/);
    expect(validateMarkRow(row({ reduced: '11' }), 20, 10)).toMatch(/exceed/);
    expect(validateMarkRow(row({ status: 'ABSENT', marks: '3' }), 20, null)).toMatch(/cannot carry/);
    expect(validateMarkRow(row({ status: 'ABSENT' }), 20, null)).toBeNull();
  });
  it('sends only touched rows and nulls marks for non-present', () => {
    const entries = buildMarkEntries([row({ marks: '12.5', remarks: ' ok ' }), row({ course_registration_id: 2, touched: false, marks: '3' }), row({ course_registration_id: 3, status: 'ABSENT', marks: '9' })]);
    expect(entries).toEqual([
      { course_registration_id: 1, attendance_status: 'PRESENT', marks_obtained: 12.5, reduced_marks: null, remarks: 'ok' },
      { course_registration_id: 3, attendance_status: 'ABSENT', marks_obtained: null, reduced_marks: null },
    ]);
  });
});

describe('result entry', () => {
  const row = (p: Partial<ResultRow> = {}): ResultRow => ({ course_registration_id: 1, internal: '', external: '', status: '', touched: true, ...p });
  it('needs both marks unless an explicit status is chosen', () => {
    expect(validateResultRow(row({ internal: '30', external: '50' }), 40, 60)).toBeNull();
    expect(validateResultRow(row({ internal: '30' }), 40, 60)).toMatch(/both/);
    expect(validateResultRow(row({ status: 'ABSENT' }), 40, 60)).toBeNull();
    expect(validateResultRow(row({ internal: '41', external: '50' }), 40, 60)).toMatch(/Internal/);
    expect(validateResultRow(row({ internal: '30', external: '61' }), 40, 60)).toMatch(/External/);
    expect(validateResultRow(row({ internal: 'x', external: '5' }), 40, 60)).toMatch(/non-negative/);
  });
});

describe('list params and ids', () => {
  it('falls back safely on junk', () => {
    expect(offeringListParams.parse({ term: 'abc', programme: '3', page: '-2' })).toEqual({ term: undefined, programme: 3, page: 1 });
  });
  it('parseAsmId accepts only positive integers', () => {
    expect(parseAsmId('12')).toBe(12);
    for (const bad of ['0', '-1', '1.5', 'abc', '', '1e3', '99999999999999999999']) expect(parseAsmId(bad)).toBeNull();
  });
});
