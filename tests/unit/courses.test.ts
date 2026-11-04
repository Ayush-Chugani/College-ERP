import { describe, expect, it } from 'vitest';
import { parseCourseId } from '@/features/course-data';
import { categorySchema, courseEditSchema, courseListParams, courseSchema, prerequisiteSchema, schemeCourseEditSchema, schemeCourseSchema } from '@/lib/course-validation';

const ok = { owning_department_id: '1', course_category_id: '2', course_code: ' CS101 ', course_title: 'Intro', course_type: 'THEORY', is_active: true };

describe('course schema', () => {
  it('trims, defaults blank hours/credits to 0 and converts numbers', () => {
    const v = courseSchema.parse({ ...ok, credits: '4', lecture_hours: '3.5', tutorial_hours: '', short_title: '' });
    expect(v).toMatchObject({ course_code: 'CS101', owning_department_id: 1, course_category_id: 2, credits: 4, lecture_hours: 3.5, tutorial_hours: 0, practical_hours: 0, short_title: undefined });
  });
  it('enforces numeric(4,1): max 999.9, one decimal, non-negative', () => {
    const bad = (o: object) => courseSchema.safeParse({ ...ok, ...o }).success;
    expect(bad({ credits: '999.9' })).toBe(true);
    expect(bad({ credits: '1000' })).toBe(false);
    expect(bad({ credits: '3.25' })).toBe(false);
    expect(bad({ credits: '-1' })).toBe(false);
    expect(bad({ lecture_hours: 'abc' })).toBe(false);
  });
  it('requires department, category, code, title and a valid type; dates must be ordered', () => {
    const bad = (o: object) => courseSchema.safeParse({ ...ok, ...o }).success;
    expect(bad({ owning_department_id: '' })).toBe(false);
    expect(bad({ course_category_id: '' })).toBe(false);
    expect(bad({ course_code: '' })).toBe(false);
    expect(bad({ course_code: 'x'.repeat(31) })).toBe(false);
    expect(bad({ course_title: 'x'.repeat(201) })).toBe(false);
    expect(bad({ course_type: 'MAGIC' })).toBe(false);
    expect(bad({ effective_from: '2025-02-01', effective_to: '2025-01-01' })).toBe(false);
    expect(bad({ effective_from: '2025-01-01', effective_to: '2025-01-01' })).toBe(true);
  });
  it('the edit schema does not include the owning department', () => {
    const { owning_department_id, ...rest } = ok;
    void owning_department_id;
    expect(courseEditSchema.safeParse(rest).success).toBe(true);
    expect(courseEditSchema.parse(rest)).not.toHaveProperty('owning_department_id');
  });
});

describe('category and prerequisite', () => {
  it('category needs code and name', () => {
    expect(categorySchema.safeParse({ category_code: 'CORE', category_name: 'Core', is_graded: true, contributes_to_gpa: true, is_active: true }).success).toBe(true);
    expect(categorySchema.safeParse({ category_code: '', category_name: 'Core', is_graded: true, contributes_to_gpa: true, is_active: true }).success).toBe(false);
  });
  it('prerequisite needs a course; grade is at most 5 characters', () => {
    expect(prerequisiteSchema.safeParse({ prerequisite_course_id: '3', minimum_grade: 'C+' }).success).toBe(true);
    expect(prerequisiteSchema.safeParse({ prerequisite_course_id: '' }).success).toBe(false);
    expect(prerequisiteSchema.safeParse({ prerequisite_course_id: '3', minimum_grade: 'ABCDEF' }).success).toBe(false);
  });
});

describe('scheme course schema', () => {
  const sc = { semester_id: '1', course_id: '2', is_mandatory: true, internal_max_marks: '40', external_max_marks: '60.5', passing_marks: '40' };
  it('numeric(6,2) marks, whole-number order/duration, passing ≤ internal + external', () => {
    const v = schemeCourseSchema.parse({ ...sc, display_order: '3', exam_duration_minutes: '180' });
    expect(v).toMatchObject({ semester_id: 1, course_id: 2, internal_max_marks: 40, external_max_marks: 60.5, passing_marks: 40, display_order: 3, exam_duration_minutes: 180 });
    const bad = (o: object) => schemeCourseSchema.safeParse({ ...sc, ...o }).success;
    expect(bad({ passing_marks: '101' })).toBe(false); // 40 + 60.5 = 100.5
    expect(bad({ passing_marks: '100.5' })).toBe(true);
    expect(bad({ internal_max_marks: '10000' })).toBe(false);
    expect(bad({ internal_max_marks: '1.234' })).toBe(false);
    expect(bad({ display_order: '-1' })).toBe(false);
    expect(bad({ exam_duration_minutes: '1.5' })).toBe(false);
    expect(bad({ course_id: '' })).toBe(false);
    expect(schemeCourseSchema.parse({ ...sc, passing_marks: '' }).passing_marks).toBeUndefined();
  });
  it('the edit schema covers marks only, not the course or semester', () => {
    const r = schemeCourseEditSchema.parse({ is_mandatory: false, internal_max_marks: '20', external_max_marks: '30' });
    expect(r).toMatchObject({ is_mandatory: false, internal_max_marks: 20 });
    expect(r).not.toHaveProperty('course_id');
  });
});

describe('list params and ids', () => {
  it('fall back safely', () => {
    expect(courseListParams.parse({ page: '0', type: 'X', active: 'maybe', department: 'x', q: 'a,b)' })).toEqual({ page: 1, type: undefined, active: undefined, department: undefined, q: 'ab' });
    expect(courseListParams.parse({ type: 'LAB', active: 'yes', department: '2' })).toMatchObject({ type: 'LAB', active: 'yes', department: 2 });
  });
  it('route ids are positive integers', () => {
    expect(parseCourseId('9')).toBe(9);
    for (const bad of ['0', '-1', 'x', '1.5', '', '9'.repeat(20)]) expect(parseCourseId(bad)).toBeNull();
  });
});
