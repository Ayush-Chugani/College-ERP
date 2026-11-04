import { describe, expect, it } from 'vitest';
import { parseStudentId } from '@/features/student-detail';
import { buildRegistration, buildStudentUpdate } from '@/features/student-payloads';
import { can, parseContext } from '@/lib/context';
import { enrolmentProblems, studentCreateSchema, studentEditSchema } from '@/lib/validation';

const base = { student_number: ' N-1 ', first_name: ' Asha ', middle_name: '', last_name: 'Rao', primary_email: ' ASHA@Example.ORG ', primary_phone: '+91 98765-43210' };

describe('student create schema', () => {
  it('trims, lower-cases email and turns blank optional fields into undefined', () => {
    const v = studentCreateSchema.parse({ ...base, gender_id: '', programme_id: '3' });
    expect(v).toMatchObject({ student_number: 'N-1', first_name: 'Asha', middle_name: undefined, primary_email: 'asha@example.org', gender_id: undefined, programme_id: 3 });
  });
  it('rejects bad email, phone, overlong values, future birth dates and bad ids', () => {
    const bad = (o: object) => studentCreateSchema.safeParse({ ...base, ...o }).success;
    expect(bad({})).toBe(true);
    expect(bad({ primary_email: 'nope' })).toBe(false);
    expect(bad({ primary_phone: 'abc' })).toBe(false);
    expect(bad({ student_number: 'x'.repeat(31) })).toBe(false);
    expect(bad({ first_name: '' })).toBe(false);
    expect(bad({ date_of_birth: '2999-01-01' })).toBe(false);
    expect(bad({ date_of_birth: '2006-05-01' })).toBe(true);
    expect(bad({ gender_id: '-2' })).toBe(false);
    expect(bad({ gender_id: '1.5' })).toBe(false);
  });
});

describe('enrolment completeness', () => {
  it('requires all four enrolment selections once any is chosen, none when all are blank', () => {
    expect(enrolmentProblems(studentCreateSchema.parse(base))).toEqual({});
    const partial = enrolmentProblems(studentCreateSchema.parse({ ...base, programme_id: '1' }));
    expect(Object.keys(partial).sort()).toEqual(['admission_academic_year_id', 'admission_semester_id', 'curriculum_scheme_id']);
    expect(enrolmentProblems(studentCreateSchema.parse({ ...base, programme_id: '1', curriculum_scheme_id: '2', admission_academic_year_id: '3', admission_semester_id: '1' }))).toEqual({});
  });
});

describe('payload builders', () => {
  it('registration never carries a display_name and omits the enrolment when no programme is chosen', () => {
    const noEnrol = buildRegistration(studentCreateSchema.parse({ ...base, display_name: 'FORGED' }));
    expect(noEnrol.enrolment).toBeNull();
    expect(noEnrol.student).not.toHaveProperty('display_name');
    const withEnrol = buildRegistration(studentCreateSchema.parse({ ...base, programme_id: '1', curriculum_scheme_id: '2', admission_academic_year_id: '3', admission_semester_id: '1', admission_date: '2025-08-01' }));
    expect(withEnrol.enrolment).toEqual({ programme_id: 1, curriculum_scheme_id: 2, admission_academic_year_id: 3, admission_semester_id: 1, admission_date: '2025-08-01' });
  });
  it('update sends null for cleared optional fields so they are actually cleared', () => {
    const v = studentEditSchema.parse({ ...base, display_name: 'Asha Rao', middle_name: '', primary_phone: '', notes: '' });
    const u = buildStudentUpdate(v);
    expect(u).toMatchObject({ middle_name: null, primary_phone: null, notes: null, display_name: 'Asha Rao' });
    expect(u).not.toHaveProperty('student_status');
  });
});

describe('route id and permission hints', () => {
  it('accepts only positive integer ids', () => {
    expect(parseStudentId('42')).toBe(42);
    for (const bad of ['0', '-1', '1.5', 'abc', '1e3', '', '99999999999999999999', '12 ']) expect(parseStudentId(bad)).toBeNull();
  });
  it('can() reads the permission list and defaults to none', () => {
    const base = { user_id: 1, username: 'u', email: null, student_id: null, employee_id: null, roles: [], readable_modules: [] };
    expect(can(parseContext({ ...base })!, 'STUDENT.ALL.CREATE')).toBe(false);
    expect(can(parseContext({ ...base, permissions: ['STUDENT.ALL.CREATE'] })!, 'STUDENT.ALL.CREATE')).toBe(true);
  });
});
