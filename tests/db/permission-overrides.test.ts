import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, role, U } from './world';

/** Permission overrides administration (migration 057). superAdmin is a super administrator; SYSADMIN holds IAM.ALL.UPDATE globally through SYSTEM_ADMIN but is not a super administrator. */
const SYSADMIN = '00000000-0000-0000-0000-0000000000d1';
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const set = (sub: string, user: number, perm: string, effect: string, scope = 'GLOBAL', entity: number | null = null, just = 'because') =>
  asUser<{ id: string }>(sub, `select public.iam_override_set(${user}, '${perm}', '${effect}', '${scope}', ${entity ?? 'null'}, '${just}') id`);

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO user_account (user_id, username, password_hash) VALUES (31, 'sysadmin', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type) VALUES (31, ${role('SYSTEM_ADMIN')}, 'GLOBAL');
    INSERT INTO auth.users (id) VALUES ('${SYSADMIN}');
    SELECT sims_private.link_auth_user('${SYSADMIN}', 31, 'test');
  `);
}, 180_000);

describe('who may administer overrides', () => {
  it('needs IAM.ALL.UPDATE globally; nobody edits their own', async () => {
    await expect(as('anon', null, "select public.iam_override_list(1)")).rejects.toThrow(/permission denied/);
    await expect(set(U.registrar1, 1, 'STUDENT.ALL.READ', 'DENY')).rejects.toThrow(/IAM.ALL.UPDATE/);
    await expect(asUser(U.registrar1, 'select public.iam_override_list(1)')).rejects.toThrow(/IAM.ALL.READ/);
    await expect(asUser(U.registrar1, "select * from public.iam_permission_options('student')")).rejects.toThrow(/IAM.ALL.UPDATE/);
    await expect(set(U.superAdmin, 8, 'STUDENT.ALL.READ', 'DENY')).rejects.toThrow(/own permissions/);
  });
});

describe('setting and ending', () => {
  it('validates scope, permission, effect and justification', async () => {
    await expect(set(U.superAdmin, 999, 'STUDENT.ALL.READ', 'DENY')).rejects.toThrow(/Unknown user/);
    await expect(set(U.superAdmin, 2, 'NOPE.ALL.READ', 'DENY')).rejects.toThrow(/Unknown permission/);
    await expect(set(U.superAdmin, 2, 'STUDENT.ALL.READ', 'MAYBE')).rejects.toThrow(/ALLOW or DENY/);
    await expect(set(U.superAdmin, 2, 'STUDENT.ALL.READ', 'DENY', 'GLOBAL', 1)).rejects.toThrow(/scope entity/);
    await expect(set(U.superAdmin, 2, 'STUDENT.ALL.READ', 'DENY', 'INSTITUTION', null)).rejects.toThrow(/scope entity/);
    await expect(set(U.superAdmin, 2, 'STUDENT.ALL.READ', 'DENY', 'INSTITUTION', 999)).rejects.toThrow(/Unknown scope entity/);
    await expect(set(U.superAdmin, 2, 'STUDENT.ALL.READ', 'DENY', 'GLOBAL', null, '  ')).rejects.toThrow(/justification/);
  });
  it('a DENY takes effect at once, is idempotent, and ending it restores access', async () => {
    expect((await asUser(U.registrar1, 'select student_id from student')).length).toBeGreaterThan(0);
    const id = Number((await set(U.superAdmin, 2, 'STUDENT.ALL.READ', 'DENY', 'INSTITUTION', 1))[0]?.id);
    expect(Number((await set(U.superAdmin, 2, 'STUDENT.ALL.READ', 'DENY', 'INSTITUTION', 1))[0]?.id)).toBe(id);
    expect(await asUser(U.registrar1, 'select student_id from student')).toEqual([]);
    const l = (await asUser<{ l: { id: number; permission: string; effect: string; scope: string; active: boolean; granted_by: string }[] }>(U.superAdmin, 'select public.iam_override_list(2) l'))[0]!.l;
    expect(l[0]).toMatchObject({ id, permission: 'STUDENT.ALL.READ', effect: 'DENY', scope: 'Inst 1', active: true, granted_by: 'superadmin' });
    await asUser(U.superAdmin, `select public.iam_override_end(${id}, 'mistake')`);
    await asUser(U.superAdmin, `select public.iam_override_end(${id}, 'again')`); // idempotent
    expect((await asUser(U.registrar1, 'select student_id from student')).length).toBeGreaterThan(0);
    const after = (await asUser<{ l: { active: boolean; justification: string }[] }>(U.superAdmin, 'select public.iam_override_list(2) l'))[0]!.l;
    expect(after[0]?.active).toBe(false);
    expect(after[0]?.justification).toContain('mistake');
    expect(Number(await val("select count(*) from activity_audit where entity_name = 'user_permission_override'"))).toBeGreaterThanOrEqual(2);
  });
  it('an ALLOW adds a permission; sensitive, IAM and AUDIT grants are for super administrators only', async () => {
    await expect(set(U.superAdmin, 2, 'IAM.ALL.UPDATE', 'ALLOW')).resolves.toBeDefined();
    await expect(set(SYSADMIN, 2, 'IAM.ALL.CONFIGURE', 'ALLOW')).rejects.toThrow(/super administrator/);
    await expect(set(SYSADMIN, 2, 'STUDENT.ALL.DELETE', 'ALLOW')).rejects.toThrow(/super administrator/); // sensitive
    await expect(set(SYSADMIN, 2, 'STUDENT.ALL.DELETE', 'DENY')).resolves.toBeDefined(); // a DENY is always allowed
    const open = await set(SYSADMIN, 2, 'STUDENT.ALL.READ', 'ALLOW', 'GLOBAL'); // not sensitive
    expect(open[0]?.id).toBeDefined();
    const iamId = Number(await val("select user_permission_override_id from user_permission_override where user_id = 2 and permission_effect = 'ALLOW' and permission_id = (select permission_id from permission where permission_code = 'IAM.ALL.UPDATE')"));
    await expect(asUser(SYSADMIN, `select public.iam_override_end(${iamId})`)).rejects.toThrow(/super administrator/);
  });
  it('lists permissions to choose from, with LIKE characters taken literally', async () => {
    expect((await asUser(U.superAdmin, "select * from public.iam_permission_options('FEES.FEE_PAYMENT')")).length).toBeGreaterThan(3);
    expect(await asUser(U.superAdmin, "select * from public.iam_permission_options('%')")).toEqual([]);
    await expect(asUser(U.superAdmin, `select * from public.iam_permission_options('${'x'.repeat(61)}')`)).rejects.toThrow(/too long/);
  });
});
