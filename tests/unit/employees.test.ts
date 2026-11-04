import { describe, expect, it } from 'vitest';
import { parseEmployeeId } from '@/features/employee-data';
import { buildAssignArgs, buildEmployeeRegistration, buildEmployeeUpdate } from '@/features/employee-payloads';
import { assignmentProblems, assignSchema, employeeCreateSchema, employeeEditSchema, employeeListParams } from '@/lib/employee-validation';

const base = {
  institution_id: '1',
  employee_number: ' EMP-1 ',
  first_name: ' Ravi ',
  last_name: 'Kumar',
  employment_source_id: '1',
  employment_type: 'REGULAR',
  joining_date: '2024-07-01',
  primary_email: 'Ravi@Example.org',
};

describe('employee create schema', () => {
  it('trims, normalises and requires institution, source, type and joining date', () => {
    const v = employeeCreateSchema.parse(base);
    expect(v).toMatchObject({ institution_id: 1, employee_number: 'EMP-1', first_name: 'Ravi', employment_source_id: 1, primary_email: 'ravi@example.org' });
    const bad = (o: object) => employeeCreateSchema.safeParse({ ...base, ...o }).success;
    expect(bad({ institution_id: '' })).toBe(false);
    expect(bad({ employment_source_id: '' })).toBe(false);
    expect(bad({ employment_type: 'BOGUS' })).toBe(false);
    expect(bad({ employment_type: '' })).toBe(false);
    expect(bad({ joining_date: '' })).toBe(false);
    expect(bad({ joining_date: '01/07/2024' })).toBe(false);
    expect(bad({ employee_number: 'x'.repeat(31) })).toBe(false);
    expect(bad({ primary_email: 'nope' })).toBe(false);
    expect(bad({ date_of_birth: '2999-01-01' })).toBe(false);
  });
  it('assignment fields are all-or-campus-and-designation', () => {
    expect(assignmentProblems(employeeCreateSchema.parse(base))).toEqual({});
    expect(Object.keys(assignmentProblems(employeeCreateSchema.parse({ ...base, department_id: '2' }))).sort()).toEqual(['campus_id', 'designation_id']);
    expect(assignmentProblems(employeeCreateSchema.parse({ ...base, campus_id: '1', designation_id: '3' }))).toEqual({});
  });
});

describe('payload builders', () => {
  it('registration has no display_name, and no assignment unless a campus is chosen', () => {
    const r = buildEmployeeRegistration(employeeCreateSchema.parse({ ...base, display_name: 'FORGED' }));
    expect(r.employee).not.toHaveProperty('display_name');
    expect(r.assignment).toBeNull();
    const w = buildEmployeeRegistration(employeeCreateSchema.parse({ ...base, campus_id: '1', designation_id: '2', department_id: '3' }));
    expect(w.assignment).toEqual({ campus_id: 1, department_id: 3, designation_id: 2, start_date: undefined, is_primary: true });
  });
  it('update never carries institution_id or employment_status and nulls cleared fields', () => {
    const u = buildEmployeeUpdate(employeeEditSchema.parse({ ...base, display_name: 'Ravi Kumar', middle_name: '', primary_phone: '' }));
    expect(u).not.toHaveProperty('institution_id');
    expect(u).not.toHaveProperty('employment_status');
    expect(u).toMatchObject({ middle_name: null, primary_phone: null, employment_source_id: 1 });
  });
  it('assign args map to the RPC parameter names', () => {
    const v = assignSchema.parse({ campus_id: '1', department_id: '', designation_id: '2', start_date: '2025-01-01', is_primary: true, end_current: true });
    expect(buildAssignArgs(9, v)).toEqual({ p_employee_id: 9, p_campus_id: 1, p_department_id: null, p_designation_id: 2, p_start_date: '2025-01-01', p_is_primary: true, p_end_current: true });
    expect(assignSchema.safeParse({ campus_id: '', designation_id: '2', start_date: '2025-01-01', is_primary: true, end_current: false }).success).toBe(false);
  });
});

describe('list params and ids', () => {
  it('fall back to safe defaults and sanitise search', () => {
    expect(employeeListParams.parse({ page: '0', sort: 'password', dir: 'x', q: 'a,b)' })).toEqual({ page: 1, sort: 'display_name', dir: 'asc', q: 'ab' });
  });
  it('accept only positive integer ids', () => {
    expect(parseEmployeeId('7')).toBe(7);
    for (const bad of ['0', '-3', '1.2', 'x', '', '9'.repeat(20)]) expect(parseEmployeeId(bad)).toBeNull();
  });
});
