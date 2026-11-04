import { describe, expect, it } from 'vitest';
import { parseRegId } from '@/features/registration-data';
import {
  batchSchema, COURSE_REG_NEXT, COURSE_REG_STATUSES, courseRegSchema, offeringListParams, offeringSchema, registerStudentSchema, sectionSchema, TERM_REG_NEXT, TERM_REG_STATUSES,
} from '@/lib/registration-validation';

describe('offering schema', () => {
  const ok = { academic_term_id: '1', programme_id: '2', curriculum_scheme_id: '3', semester_id: '4', status: 'PLANNED' };
  it('needs term, programme, scheme, semester and a valid status', () => {
    expect(offeringSchema.parse(ok)).toMatchObject({ academic_term_id: 1, programme_id: 2, curriculum_scheme_id: 3, semester_id: 4 });
    for (const k of ['academic_term_id', 'programme_id', 'curriculum_scheme_id', 'semester_id']) expect(offeringSchema.safeParse({ ...ok, [k]: '' }).success, k).toBe(false);
    expect(offeringSchema.safeParse({ ...ok, status: 'OPEN' }).success).toBe(false);
  });
});

describe('sections and batches', () => {
  it('code required (max 20); capacity blank or 1..65535', () => {
    expect(sectionSchema.parse({ section_code: ' A ', capacity: '' })).toMatchObject({ section_code: 'A', capacity: undefined });
    expect(sectionSchema.parse({ section_code: 'A', capacity: '60' }).capacity).toBe(60);
    for (const c of ['0', '-1', '65536', '1.5', 'x']) expect(sectionSchema.safeParse({ section_code: 'A', capacity: c }).success, c).toBe(false);
    expect(sectionSchema.safeParse({ section_code: '' }).success).toBe(false);
    expect(sectionSchema.safeParse({ section_code: 'x'.repeat(21) }).success).toBe(false);
    expect(batchSchema.safeParse({ batch_code: 'B1', capacity: '30' }).success).toBe(true);
    expect(batchSchema.safeParse({ batch_code: '' }).success).toBe(false);
  });
});

describe('register student', () => {
  const ok = { enrolment_id: '7', registration_date: '2025-08-01' };
  it('needs a student and date; a batch requires a section', () => {
    expect(registerStudentSchema.parse({ ...ok, class_section_id: '2', class_batch_id: '3', roll_number: ' R1 ' })).toMatchObject({ enrolment_id: 7, class_section_id: 2, class_batch_id: 3, roll_number: 'R1' });
    expect(registerStudentSchema.safeParse({ ...ok, enrolment_id: '' }).success).toBe(false);
    expect(registerStudentSchema.safeParse({ ...ok, registration_date: '' }).success).toBe(false);
    expect(registerStudentSchema.safeParse({ ...ok, class_batch_id: '3' }).success).toBe(false);
    expect(registerStudentSchema.safeParse({ ...ok, roll_number: 'x'.repeat(31) }).success).toBe(false);
  });
});

describe('course registration', () => {
  it('needs an offering, a known type and a date', () => {
    const ok = { course_offering_id: '5', registration_type: 'REGULAR', registration_date: '2025-08-02' };
    expect(courseRegSchema.parse(ok).course_offering_id).toBe(5);
    expect(courseRegSchema.safeParse({ ...ok, registration_type: 'MAGIC' }).success).toBe(false);
    expect(courseRegSchema.safeParse({ ...ok, course_offering_id: '' }).success).toBe(false);
  });
});

describe('status transition maps', () => {
  it('cover every status and only point at real statuses; completed is terminal', () => {
    for (const s of TERM_REG_STATUSES) {
      expect(TERM_REG_NEXT[s], s).toBeDefined();
      for (const n of TERM_REG_NEXT[s] ?? []) expect(TERM_REG_STATUSES).toContain(n);
    }
    for (const s of COURSE_REG_STATUSES) {
      expect(COURSE_REG_NEXT[s], s).toBeDefined();
      for (const n of COURSE_REG_NEXT[s] ?? []) expect(COURSE_REG_STATUSES).toContain(n);
    }
    expect(TERM_REG_NEXT.COMPLETED).toEqual([]);
    expect(COURSE_REG_NEXT.COMPLETED).toEqual([]);
    expect(COURSE_REG_NEXT.DROPPED).toContain('REGISTERED'); // a dropped course can be re-registered (capacity is re-checked by the database)
  });
});

describe('list params and ids', () => {
  it('fall back safely', () => {
    expect(offeringListParams.parse({ page: '0', term: 'x', programme: 'y', status: 'NOPE' })).toEqual({ page: 1, term: undefined, programme: undefined, status: undefined, q: '' });
    expect(offeringListParams.parse({ term: '2', status: 'ACTIVE' })).toMatchObject({ term: 2, status: 'ACTIVE' });
  });
  it('route ids are positive integers', () => {
    expect(parseRegId('3')).toBe(3);
    for (const bad of ['0', '-1', 'x', '1.5', '', '9'.repeat(20)]) expect(parseRegId(bad)).toBeNull();
  });
});
