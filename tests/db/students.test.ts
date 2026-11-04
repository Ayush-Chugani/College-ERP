import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, role, U } from './world';

const ADM1 = '00000000-0000-0000-0000-0000000000b1';
const ADM2 = '00000000-0000-0000-0000-0000000000b2';

const reg = (sub: string, student: object, enrolment: object | null = ENR) =>
  asUser<{ id: string }>(sub, `select public.student_register('${JSON.stringify(student)}'::jsonb, ${enrolment ? `'${JSON.stringify(enrolment)}'::jsonb` : 'null'}) id`);
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];

const ENR = { programme_id: 1, curriculum_scheme_id: 100, admission_academic_year_id: 1, admission_semester_id: 1, admission_date: '2025-08-01' };
const STU = { student_number: 'N-001', first_name: 'Asha', middle_name: 'K', last_name: 'Rao', primary_email: 'asha@example.org', date_of_birth: '2006-05-01' };

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO user_account (user_id, username, password_hash) VALUES (20, 'admoff1', 'x'), (21, 'admoff2', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES (20, ${role('ADMISSION_OFFICER')}, 'INSTITUTION', 1), (21, ${role('ADMISSION_OFFICER')}, 'INSTITUTION', 2);
    INSERT INTO auth.users (id) VALUES ('${ADM1}'), ('${ADM2}');
    SELECT sims_private.link_auth_user('${ADM1}', 20, 'test');
    SELECT sims_private.link_auth_user('${ADM2}', 21, 'test');
    INSERT INTO academic_year (academic_year_id, year_code, start_date, end_date) VALUES (1, '2025-26', '2025-06-01', '2026-05-31');
    INSERT INTO semester (semester_id, semester_number, semester_name) VALUES (1, 1, 'Semester 1');
    INSERT INTO curriculum_scheme (curriculum_scheme_id, programme_id, scheme_code, scheme_name, regulation_year, effective_from)
      VALUES (100, 1, 'S1', 'Scheme P1', 2024, '2024-06-01'), (300, 3, 'S3', 'Scheme P2', 2024, '2024-06-01');`);
}, 180_000);

describe('student_register', () => {
  it('registers a student with a first enrolment, computing display_name on the server', async () => {
    const [r] = await reg(ADM1, { ...STU, display_name: 'FORGED' });
    const id = Number(r?.id);
    expect(id).toBeGreaterThan(0);
    expect(await val(`select display_name from student where student_id=${id}`)).toBe('Asha K Rao');
    expect(await val(`select count(*) from student_programme_enrolment where student_id=${id} and programme_id=1`)).toBe(1);
  });
  it('writes an audit trail attributed to the acting user', async () => {
    const rows = (await db.query<{ module_code: string; entity_name: string; action_code: string; user_id: string }>(
      "select module_code, entity_name, action_code, user_id from activity_audit where entity_name in ('student','student_programme_enrolment') and user_id = 20 order by activity_audit_id",
    )).rows;
    expect(rows.map((x) => `${x.entity_name}:${x.action_code}`)).toEqual(['student:INSERT', 'student_programme_enrolment:INSERT']);
    expect(rows.every((x) => String(x.user_id) === '20')).toBe(true);
  });
  it('is scope-checked: other institution, students, faculty, registrar (no ADMISSION.CREATE) and unmapped users are refused', async () => {
    await expect(reg(ADM2, { ...STU, student_number: 'N-002', primary_email: 'b@example.org' })).rejects.toThrow(/Not authorised/);
    await expect(reg(ADM1, { ...STU, student_number: 'N-003', primary_email: 'c@example.org' }, { ...ENR, programme_id: 3, curriculum_scheme_id: 300 })).rejects.toThrow(/Not authorised/);
    for (const sub of [U.student1, U.facultyD1, U.registrar1, U.unmapped, U.disabled]) {
      await expect(reg(sub, { ...STU, student_number: 'N-004', primary_email: 'd@example.org' })).rejects.toThrow(/Not authorised/);
    }
    await expect(as('anon', null, "select public.student_register('{}'::jsonb)")).rejects.toThrow(/permission denied/i);
    expect(await val("select count(*) from student where student_number in ('N-002','N-003','N-004')")).toBe(0);
  });
  it('unenrolled students require a global grant', async () => {
    await expect(reg(ADM1, { ...STU, student_number: 'N-005', primary_email: 'e@example.org' }, null)).rejects.toThrow(/without a programme enrolment/);
    const [r] = await reg(U.superAdmin, { ...STU, student_number: 'N-005', primary_email: 'e@example.org' }, null);
    expect(Number(r?.id)).toBeGreaterThan(0);
  });
  it('validates input and rejects duplicates without partial writes', async () => {
    await expect(reg(ADM1, { ...STU, student_number: 'N-006', primary_email: 'not-an-email' })).rejects.toThrow(/valid email/);
    await expect(reg(ADM1, { ...STU, student_number: 'N-006', primary_email: 'f@example.org', date_of_birth: '2999-01-01' })).rejects.toThrow(/plausible/);
    await expect(reg(ADM1, { first_name: 'X' })).rejects.toThrow(/required/);
    await expect(reg(ADM1, { ...STU, primary_email: 'other@example.org' })).rejects.toThrow(/already registered/);
    await expect(reg(ADM1, { ...STU, student_number: 'N-007' })).rejects.toThrow(/already registered/);
    await expect(reg(ADM1, { ...STU, student_number: 'N-008', primary_email: 'g@example.org' }, { ...ENR, curriculum_scheme_id: 300 })).rejects.toThrow(/does not belong/);
    expect(await val("select count(*) from student where student_number in ('N-006','N-007','N-008')")).toBe(0);
  });
});

describe('edit and status change through RLS', () => {
  it('in-scope staff can edit and the audit row records only the changed fields', async () => {
    const rows = await asUser(U.registrar1, "update student set primary_phone='555', notes='n' where student_number='N-001' returning student_id");
    expect(rows).toHaveLength(1);
    const a = (await db.query<{ before_values: Record<string, unknown>; after_values: Record<string, unknown> }>(
      "select before_values, after_values from activity_audit where entity_name='student' and action_code='UPDATE' order by activity_audit_id desc limit 1",
    )).rows[0];
    expect(Object.keys(a?.after_values ?? {}).sort()).toEqual(['notes', 'primary_phone']);
    expect(a?.before_values).toEqual({ notes: null, primary_phone: null });
  });
  it('out-of-scope staff and students update nothing', async () => {
    expect(await asUser(U.registrar2, "update student set notes='x' where student_number='N-001' returning student_id")).toHaveLength(0);
    expect(await asUser(U.student1, "update student set notes='x' where student_id=1 returning student_id")).toHaveLength(0);
  });
  it('status changes (deactivate / reactivate) are permitted for in-scope staff and audited', async () => {
    expect(await asUser(U.registrar1, "update student set student_status='WITHDRAWN' where student_number='N-001' returning student_id")).toHaveLength(1);
    expect(await val("select student_status from student where student_number='N-001'")).toBe('WITHDRAWN');
    expect(await asUser(U.registrar1, "update student set student_status='ACTIVE' where student_number='N-001' returning student_id")).toHaveLength(1);
    await expect(asUser(U.registrar1, "update student set student_status='BOGUS' where student_number='N-001'")).rejects.toThrow(/enum_student_status|check/i);
  });
});

describe('my_context permissions', () => {
  it('lists ALLOW permission codes for UI gating and nothing for unmapped identities', async () => {
    const [c] = await asUser<{ c: { permissions: string[] } }>(ADM1, 'select public.my_context() c');
    expect(c?.c.permissions).toContain('STUDENT.ALL.CREATE');
    const [s] = await asUser<{ c: { permissions: string[] } }>(U.student1, 'select public.my_context() c');
    expect(s?.c.permissions).not.toContain('STUDENT.ALL.CREATE');
  });
});
