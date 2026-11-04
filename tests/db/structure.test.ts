import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

const SCOPED = '00000000-0000-0000-0000-0000000000d1';
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const rpc = (sub: string, fn: string, args: string) => asUser<{ r: unknown }>(sub, `select public.${fn}(${args}) r`);
const INST = { university_id: 1, institution_code: 'NEW1', institution_name: 'New Institute', email: 'info@new.example.org', website_url: 'https://new.example.org' };

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO university (university_id, university_code, university_name) VALUES (1, 'U1', 'University One') ON CONFLICT DO NOTHING;
    INSERT INTO user_account (user_id, username, password_hash) VALUES (40, 'instadmin1', 'x');
    INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
      SELECT 40, permission_id, 'ALLOW', 'INSTITUTION', 1, 'test' FROM permission WHERE permission_code IN ('INSTITUTION.ALL.READ','INSTITUTION.ALL.CREATE','INSTITUTION.ALL.UPDATE','INSTITUTION.ALL.DELETE');
    INSERT INTO auth.users (id) VALUES ('${SCOPED}');
    SELECT sims_private.link_auth_user('${SCOPED}', 40, 'test');`);
}, 180_000);

describe('institution RPCs', () => {
  it('only a global INSTITUTION.CREATE holder can create institutions', async () => {
    const [r] = await rpc(U.superAdmin, 'institution_create', `'${JSON.stringify(INST)}'::jsonb`);
    expect(Number(r?.r)).toBeGreaterThan(2);
    for (const sub of [U.registrar1, SCOPED, U.student1, U.unmapped]) {
      await expect(rpc(sub, 'institution_create', `'${JSON.stringify({ ...INST, institution_code: 'X' })}'::jsonb`)).rejects.toThrow(/Not authorised/);
    }
    await expect(as('anon', null, "select public.institution_create('{}'::jsonb)")).rejects.toThrow(/permission denied/i);
  });
  it('validates input and refuses duplicate codes', async () => {
    await expect(rpc(U.superAdmin, 'institution_create', `'${JSON.stringify({ ...INST, institution_code: 'NEW2', email: 'bad' })}'::jsonb`)).rejects.toThrow(/valid email/);
    await expect(rpc(U.superAdmin, 'institution_create', `'${JSON.stringify({ ...INST, institution_code: 'NEW2', website_url: 'ftp://x' })}'::jsonb`)).rejects.toThrow(/http/);
    await expect(rpc(U.superAdmin, 'institution_create', `'${JSON.stringify({ university_id: 1 })}'::jsonb`)).rejects.toThrow(/required/);
    await expect(rpc(U.superAdmin, 'institution_create', `'${JSON.stringify(INST)}'::jsonb`)).rejects.toThrow(/already in use/);
  });
  it('update is scope-checked, partial, and cannot blank required fields', async () => {
    await rpc(SCOPED, 'institution_update', `1, '${JSON.stringify({ phone: '555-0100', legal_name: 'Inst 1 Legal' })}'::jsonb`);
    expect(await val('select phone from institution where institution_id=1')).toBe('555-0100');
    expect(await val('select institution_name from institution where institution_id=1')).toBe('Inst 1'); // untouched
    await expect(rpc(SCOPED, 'institution_update', `2, '{"phone":"1"}'::jsonb`)).rejects.toThrow(/Not authorised/);
    await expect(rpc(U.registrar1, 'institution_update', `1, '{"phone":"1"}'::jsonb`)).rejects.toThrow(/Not authorised/);
    await expect(rpc(SCOPED, 'institution_update', `1, '{"institution_name":"  "}'::jsonb`)).rejects.toThrow(/cannot be blank/);
    await expect(rpc(SCOPED, 'institution_update', `1, '{"institution_code":"NEW1"}'::jsonb`)).rejects.toThrow(/already in use/);
    await rpc(SCOPED, 'institution_update', `1, '{"phone": null}'::jsonb`);
    expect(await val('select phone is null from institution where institution_id=1')).toBe(true);
  });
  it('direct institution writes stay closed to clients', async () => {
    await expect(asUser(U.superAdmin, "update institution set institution_name='x' where institution_id=1")).rejects.toThrow(/permission denied|row-level/i);
  });
});

describe('campus / department / programme under parent-scope RLS', () => {
  it('a scoped administrator builds the hierarchy only inside their institution', async () => {
    await asUser(SCOPED, "insert into campus (institution_id, campus_code, campus_name) values (1, 'NC', 'New Campus')");
    await expect(asUser(SCOPED, "insert into campus (institution_id, campus_code, campus_name) values (2, 'XC', 'Other')")).rejects.toThrow(/row-level security/i);
    const campus = Number(await val("select campus_id from campus where campus_code='NC'"));
    await asUser(SCOPED, `insert into department (campus_id, department_code, department_name) values (${campus}, 'ND', 'New Dept')`);
    await expect(asUser(SCOPED, "insert into department (campus_id, department_code, department_name) values (2, 'XD', 'Other')")).rejects.toThrow(/row-level security/i);
    const dept = Number(await val("select department_id from department where department_code='ND'"));
    await asUser(SCOPED, `insert into programme (department_id, programme_code, programme_name, programme_level, duration_semesters) values (${dept}, 'NP', 'New Prog', 'UG', 8)`);
    await expect(asUser(SCOPED, "insert into programme (department_id, programme_code, programme_name, programme_level, duration_semesters) values (3, 'XP', 'Other', 'UG', 8)")).rejects.toThrow(/row-level security/i);
  });
  it('read-only roles read the directory but cannot write', async () => {
    expect((await asUser(U.registrar1, 'select 1 from campus')).length).toBeGreaterThan(0);
    await expect(asUser(U.registrar1, "insert into campus (institution_id, campus_code, campus_name) values (1, 'RC', 'Reg Campus')")).rejects.toThrow(/row-level security/i);
    expect(await asUser(U.registrar1, "update campus set campus_name='x' returning campus_id")).toHaveLength(0);
  });
  it('database rules: unique codes per parent, duration checks, enums', async () => {
    const campus = Number(await val("select campus_id from campus where campus_code='NC'"));
    await expect(asUser(SCOPED, `insert into department (campus_id, department_code, department_name) values (${campus}, 'ND', 'Dup')`)).rejects.toThrow(/uq_department_code|duplicate/i);
    const dept = Number(await val("select department_id from department where department_code='ND'"));
    await expect(asUser(SCOPED, `insert into programme (department_id, programme_code, programme_name, programme_level, duration_semesters, maximum_duration_semesters) values (${dept}, 'NP2', 'x', 'UG', 8, 4)`)).rejects.toThrow(/chk_programme_duration|check/i);
    await expect(asUser(SCOPED, `insert into programme (department_id, programme_code, programme_name, programme_level, duration_semesters) values (${dept}, 'NP3', 'x', 'MASTERS', 8)`)).rejects.toThrow(/enum_programme_level|check/i);
  });
  it('a campus with departments cannot be deleted; empty ones can by an authorised user', async () => {
    const campus = Number(await val("select campus_id from campus where campus_code='NC'"));
    await expect(asUser(SCOPED, `delete from campus where campus_id=${campus}`)).rejects.toThrow(/foreign key|violates/i);
    await asUser(SCOPED, "insert into campus (institution_id, campus_code, campus_name) values (1, 'TMP', 'Temp')");
    expect(await asUser(SCOPED, "delete from campus where campus_code='TMP' returning campus_id")).toHaveLength(1);
    expect(await asUser(U.registrar1, "delete from campus where campus_code='NC' returning campus_id")).toHaveLength(0);
  });
  it('changes are audited with the acting user', async () => {
    const r = await db.query<{ entity_name: string; action_code: string }>("select entity_name, action_code from activity_audit where module_code='INSTITUTION' and user_id=40 order by activity_audit_id");
    const keys = r.rows.map((x) => `${x.entity_name}:${x.action_code}`);
    expect(keys).toEqual(expect.arrayContaining(['institution:UPDATE', 'campus:INSERT', 'department:INSERT', 'programme:INSERT', 'campus:DELETE']));
  });
});
