import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, role, U } from './world';

const HR1 = '00000000-0000-0000-0000-0000000000c1';
const HR2 = '00000000-0000-0000-0000-0000000000c2';
const HOD1 = '00000000-0000-0000-0000-0000000000c3';

const reg = (sub: string, emp: object, asg: object | null = null) =>
  asUser<{ id: string }>(sub, `select public.employee_register('${JSON.stringify(emp)}'::jsonb, ${asg ? `'${JSON.stringify(asg)}'::jsonb` : 'null'}) id`);
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];

const E = { institution_id: 1, employment_source_id: 1, employment_type: 'REGULAR', joining_date: '2024-07-01', first_name: 'Ravi', last_name: 'Kumar', employee_number: 'EMP-100', primary_email: 'ravi@example.org' };
const A = { campus_id: 1, department_id: 1, designation_id: 1, start_date: '2024-07-01' };

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO user_account (user_id, username, password_hash) VALUES (30, 'hr1', 'x'), (31, 'hr2', 'x'), (32, 'hod1', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES (30, ${role('HR_ADMIN')}, 'INSTITUTION', 1), (31, ${role('HR_ADMIN')}, 'INSTITUTION', 2);
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, department_id) VALUES (32, ${role('HEAD_DEPARTMENT')}, 'DEPARTMENT', 1);
    INSERT INTO auth.users (id) VALUES ('${HR1}'), ('${HR2}'), ('${HOD1}');
    SELECT sims_private.link_auth_user('${HR1}', 30, 'test');
    SELECT sims_private.link_auth_user('${HR2}', 31, 'test');
    SELECT sims_private.link_auth_user('${HOD1}', 32, 'test');`);
}, 180_000);

describe('employee_register', () => {
  it('registers an employee with a first assignment; display_name is computed server-side', async () => {
    const [r] = await reg(HR1, { ...E, display_name: 'FORGED' }, A);
    const id = Number(r?.id);
    expect(id).toBeGreaterThan(0);
    expect(await val(`select display_name from employee where employee_id=${id}`)).toBe('Ravi Kumar');
    expect(await val(`select count(*) from employee_assignment where employee_id=${id} and is_primary and end_date is null`)).toBe(1);
  });
  it('audits both rows against the acting user', async () => {
    const rows = (await db.query<{ entity_name: string; action_code: string; user_id: string }>(
      "select entity_name, action_code, user_id from activity_audit where entity_name in ('employee','employee_assignment') and user_id = 30 order by activity_audit_id",
    )).rows;
    expect(rows.map((x) => `${x.entity_name}:${x.action_code}`)).toEqual(['employee:INSERT', 'employee_assignment:INSERT']);
  });
  it('is institution-scoped: HR of another institution, faculty, students and unmapped users are refused', async () => {
    await expect(reg(HR2, { ...E, employee_number: 'EMP-101', primary_email: 'a@example.org' })).rejects.toThrow(/Not authorised/);
    await expect(reg(HR1, { ...E, institution_id: 2, employee_number: 'EMP-102', primary_email: 'b@example.org' })).rejects.toThrow(/Not authorised/);
    for (const sub of [U.facultyD1, U.student1, U.unmapped, U.disabled]) {
      await expect(reg(sub, { ...E, employee_number: 'EMP-103', primary_email: 'c@example.org' })).rejects.toThrow(/Not authorised/);
    }
    await expect(as('anon', null, "select public.employee_register('{}'::jsonb)")).rejects.toThrow(/permission denied/i);
    expect(await val("select count(*) from employee where employee_number in ('EMP-101','EMP-102','EMP-103')")).toBe(0);
  });
  it('a head of department has no CREATE in the seed catalogue, so is refused', async () => {
    await expect(reg(HOD1, { ...E, employee_number: 'EMP-104', primary_email: 'd@example.org' }, A)).rejects.toThrow(/Not authorised/);
  });
  it('with an explicit department-scoped grant, a head of department can add people only into their own department', async () => {
    await db.exec(`INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
      SELECT 32, permission_id, 'ALLOW', 'DEPARTMENT', 1, 'test' FROM permission WHERE permission_code = 'EMPLOYEE.ALL.CREATE'`);
    await expect(reg(HOD1, { ...E, employee_number: 'EMP-104', primary_email: 'd@example.org' })).rejects.toThrow(/Not authorised/); // no assignment
    await expect(reg(HOD1, { ...E, employee_number: 'EMP-104', primary_email: 'd@example.org' }, { ...A, department_id: 2 })).rejects.toThrow(/Not authorised/);
    await expect(reg(HOD1, { ...E, institution_id: 2, employee_number: 'EMP-104', primary_email: 'd@example.org' }, { ...A, campus_id: 2, department_id: 3 })).rejects.toThrow(/Not authorised/);
    const [r] = await reg(HOD1, { ...E, employee_number: 'EMP-105', primary_email: 'e@example.org' }, A);
    expect(Number(r?.id)).toBeGreaterThan(0);
  });
  it('validates input and refuses duplicates without partial writes', async () => {
    await expect(reg(HR1, { first_name: 'X', institution_id: 1 })).rejects.toThrow(/required/);
    await expect(reg(HR1, { ...E, employee_number: 'EMP-106', primary_email: 'bad' })).rejects.toThrow(/valid email/);
    await expect(reg(HR1, { ...E, employee_number: 'EMP-106', primary_email: 'f@example.org', employment_type: 'BOGUS' })).rejects.toThrow(/enum_employment_type|check/i);
    await expect(reg(HR1, { ...E, primary_email: 'g@example.org' })).rejects.toThrow(/already registered/);
    await expect(reg(HR1, { ...E, employee_number: 'EMP-107' })).rejects.toThrow(/already registered/);
    await expect(reg(HR1, { ...E, employee_number: 'EMP-108', primary_email: 'h@example.org' }, { campus_id: 1 })).rejects.toThrow(/required/);
    expect(await val("select count(*) from employee where employee_number in ('EMP-106','EMP-107','EMP-108')")).toBe(0);
  });
});

describe('employee_assign', () => {
  let emp: number;
  beforeAll(async () => {
    emp = Number(await val("select employee_id from employee where employee_number='EMP-100'"));
  });
  const assign = (sub: string, extra: string) => asUser<{ id: string }>(sub, `select public.employee_assign(${emp}, 1, 1, 2, ${extra}) id`);

  it('refuses a second current primary unless the current one is ended; ends it the day before otherwise', async () => {
    await expect(assign(HR1, "'2025-01-01'")).rejects.toThrow(/already has a current primary/);
    await expect(assign(HR1, "'2024-07-01', true, true")).rejects.toThrow(/must be after/);
    await assign(HR1, "'2025-01-01', true, true");
    expect(await val(`select end_date::text from employee_assignment where employee_id=${emp} and designation_id=1`)).toBe('2024-12-31');
    expect(await val(`select count(*) from employee_assignment where employee_id=${emp} and is_primary and end_date is null`)).toBe(1);
  });
  it('a non-primary assignment can be added alongside', async () => {
    await assign(HR1, "'2025-02-01', false");
    expect(await val(`select count(*) from employee_assignment where employee_id=${emp} and end_date is null`)).toBe(2);
  });
  it('is scope-checked', async () => {
    await expect(assign(HR2, "'2026-01-01', false")).rejects.toThrow(/Not authorised/);
    await expect(assign(U.student1, "'2026-01-01', false")).rejects.toThrow(/Not authorised/);
    await expect(asUser(HOD1, `select public.employee_assign(${emp}, 1, 2, 2, '2026-01-01', false)`)).rejects.toThrow(/Not authorised/); // other department
  });
});

describe('edit, status and tenant integrity', () => {
  it('in-scope staff edit and change status; the audit row lists only changed fields', async () => {
    expect(await asUser(HR1, "update employee set primary_phone='555', employment_status='ON_LEAVE' where employee_number='EMP-100' returning employee_id")).toHaveLength(1);
    const a = (await db.query<{ after_values: Record<string, unknown> }>(
      "select after_values from activity_audit where entity_name='employee' and action_code='UPDATE' and user_id=30 order by activity_audit_id desc limit 1",
    )).rows[0];
    expect(Object.keys(a?.after_values ?? {}).sort()).toEqual(['employment_status', 'primary_phone']);
  });
  it('other institutions update nothing; a bad status is rejected', async () => {
    expect(await asUser(HR2, "update employee set primary_phone='1' where employee_number='EMP-100' returning employee_id")).toHaveLength(0);
    await expect(asUser(HR1, "update employee set employment_status='BOGUS' where employee_number='EMP-100'")).rejects.toThrow(/enum_employment_status|check/i);
  });
  it('an employee cannot be moved to another institution by end users', async () => {
    await expect(asUser(HR1, "update employee set institution_id=2 where employee_number='EMP-100'")).rejects.toThrow(/another institution/);
    expect(await val("select institution_id from employee where employee_number='EMP-100'")).toBe(1);
  });
  it('visibility: HR sees own institution only; the employee sees their own record', async () => {
    const ids = async (sub: string) => (await asUser<{ n: string }>(sub, 'select employee_number n from employee')).map((r) => r.n).sort();
    expect((await ids(HR1)).every((n) => n !== 'E2')).toBe(true);
    expect(await ids(HR2)).toEqual(['E2']);
  });
});
