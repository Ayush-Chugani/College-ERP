import { describe, expect, it } from 'vitest';
import { parseApplicationId } from '@/features/admission-data';
import {
  ACTION_FOR, admissionCategorySchema, admitSchema, APPLICATION_STATUSES, applicationListParams, applySchema, canAdmit, nextStatuses, TERMINAL, TRANSITIONS,
} from '@/lib/admission-validation';

const base = { first_name: ' Meera ', application_number: ' APP-1 ', programme_id: '1', academic_year_id: '2', application_date: '2025-05-01' };

describe('transition rules', () => {
  it('terminal statuses have no outgoing transitions and ADMITTED is never a normal target', () => {
    for (const t of TERMINAL) expect(TRANSITIONS[t]).toEqual([]);
    for (const from of APPLICATION_STATUSES) expect(TRANSITIONS[from]).not.toContain('ADMITTED');
  });
  it('every target a user can request has a permission action', () => {
    for (const from of APPLICATION_STATUSES) for (const to of TRANSITIONS[from]) expect(ACTION_FOR[to], `${from}->${to}`).toBeDefined();
  });
  it('nextStatuses only offers what the permissions allow', () => {
    const only = (...codes: string[]) => (c: string) => codes.includes(c);
    expect(nextStatuses('DRAFT', only())).toEqual([]);
    expect(nextStatuses('DRAFT', only('ADMISSION.ALL.UPDATE'))).toEqual(['SUBMITTED', 'CANCELLED']);
    expect(nextStatuses('UNDER_REVIEW', only('ADMISSION.ALL.UPDATE'))).toEqual(['CANCELLED']);
    expect(nextStatuses('UNDER_REVIEW', only('ADMISSION.ALL.UPDATE', 'ADMISSION.ALL.VERIFY'))).toEqual(['ELIGIBLE', 'INELIGIBLE', 'CANCELLED']);
    expect(nextStatuses('ELIGIBLE', only('ADMISSION.ALL.APPROVE'))).toEqual(['SELECTED', 'WAITLISTED', 'REJECTED']);
    expect(nextStatuses('ADMITTED', () => true)).toEqual([]);
    expect(nextStatuses('NONSENSE', () => true)).toEqual([]);
  });
  it('admitting needs SELECTED plus both permissions', () => {
    const both = (c: string) => ['ADMISSION.ALL.APPROVE', 'STUDENT.ALL.CREATE'].includes(c);
    expect(canAdmit('SELECTED', both)).toBe(true);
    expect(canAdmit('ELIGIBLE', both)).toBe(false);
    expect(canAdmit('SELECTED', (c) => c === 'ADMISSION.ALL.APPROVE')).toBe(false);
  });
});

describe('apply schema', () => {
  it('trims, lower-cases email, requires programme/year/number/date and a first name', () => {
    const v = applySchema.parse({ ...base, primary_email: 'Meera@Example.ORG', gender_id: '' });
    expect(v).toMatchObject({ first_name: 'Meera', application_number: 'APP-1', programme_id: 1, academic_year_id: 2, primary_email: 'meera@example.org', gender_id: undefined });
    const bad = (o: object) => applySchema.safeParse({ ...base, ...o }).success;
    expect(bad({ first_name: '' })).toBe(false);
    expect(bad({ application_number: '' })).toBe(false);
    expect(bad({ application_number: 'x'.repeat(31) })).toBe(false);
    expect(bad({ programme_id: '' })).toBe(false);
    expect(bad({ academic_year_id: '0' })).toBe(false);
    expect(bad({ application_date: '' })).toBe(false);
    expect(bad({ primary_email: 'nope' })).toBe(false);
    expect(bad({ primary_phone: 'abc' })).toBe(false);
    expect(bad({ date_of_birth: '2999-01-01' })).toBe(false);
    expect(bad({ remarks: 'x'.repeat(2001) })).toBe(false);
  });
});

describe('admit schema and categories', () => {
  it('admit needs number, scheme, year and semester', () => {
    const ok = { student_number: 'S-1', curriculum_scheme_id: '1', admission_academic_year_id: '2', admission_semester_id: '3' };
    expect(admitSchema.parse(ok)).toMatchObject({ curriculum_scheme_id: 1, admission_academic_year_id: 2, admission_semester_id: 3 });
    for (const k of Object.keys(ok)) expect(admitSchema.safeParse({ ...ok, [k]: '' }).success, k).toBe(false);
    expect(admitSchema.safeParse({ ...ok, student_number: 'x'.repeat(31) }).success).toBe(false);
  });
  it('category needs a code and name within limits', () => {
    expect(admissionCategorySchema.safeParse({ category_code: 'GEN', category_name: 'General', is_active: true }).success).toBe(true);
    expect(admissionCategorySchema.safeParse({ category_code: '', category_name: 'General', is_active: true }).success).toBe(false);
    expect(admissionCategorySchema.safeParse({ category_code: 'G', category_name: 'x'.repeat(101), is_active: true }).success).toBe(false);
  });
});

describe('list params and ids', () => {
  it('fall back safely and sanitise search', () => {
    expect(applicationListParams.parse({ page: '-1', status: 'LOST', programme: 'x', year: 'y', q: 'a,b)' })).toEqual({ page: 1, status: undefined, programme: undefined, year: undefined, q: 'ab' });
    expect(applicationListParams.parse({ status: 'SELECTED', programme: '2', year: '3' })).toMatchObject({ status: 'SELECTED', programme: 2, year: 3 });
  });
  it('route ids are positive integers', () => {
    expect(parseApplicationId('4')).toBe(4);
    for (const bad of ['0', '-1', 'x', '1.5', '', '9'.repeat(20)]) expect(parseApplicationId(bad)).toBeNull();
  });
});
