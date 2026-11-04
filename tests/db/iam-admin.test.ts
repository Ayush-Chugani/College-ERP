import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, role, U } from './world';

/** Identity administration and audit viewer (migration 041). superAdmin holds everything globally; registrar1 has no IAM / AUDIT grant. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const setStatus = (sub: string, user: number, s: string, reason: string | null = 'because') => asUser(sub, `select public.iam_set_account_status(${user}, '${s}', ${reason === null ? 'null' : `'${reason}'`})`);
const assign = (sub: string, user: number, roleCode: string, scope: string, entity: number | null = null) =>
  asUser<{ id: string }>(sub, `select public.iam_assign_role(${user}, ${role(roleCode)}, '${scope}', ${entity ?? 'null'}, 'test') id`);

beforeAll(async () => {
  await createWorld();
}, 180_000);

describe('permissions', () => {
  it('anon cannot call; users without IAM / AUDIT grants see nothing and change nothing', async () => {
    await expect(as('anon', null, 'select * from public.iam_user_list()')).rejects.toThrow(/permission denied/i);
    expect(await asUser(U.registrar1, 'select * from public.iam_user_list()')).toEqual([]);
    expect(await asUser(U.registrar1, 'select * from public.audit_list()')).toEqual([]);
    expect(await asUser(U.student1, 'select * from public.iam_roles()')).toEqual([]);
    await expect(setStatus(U.registrar1, 1, 'DISABLED')).rejects.toThrow(/IAM.ALL.UPDATE/);
    await expect(assign(U.registrar1, 1, 'REGISTRAR', 'INSTITUTION', 1)).rejects.toThrow(/IAM.ALL.UPDATE/);
    await expect(asUser(U.registrar1, 'select public.audit_get(1)')).rejects.toThrow(/AUDIT.ALL.READ/);
    await expect(asUser(U.registrar1, 'select public.iam_user_detail(1)')).rejects.toThrow(/IAM.ALL.READ/);
  });
  it('lists users with roles and links', async () => {
    const rows = await asUser<{ username: string; roles: string; linked_to: string; total_count: string }>(U.superAdmin, "select username, roles, linked_to, total_count from public.iam_user_list('stud')");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ username: 'student1', linked_to: 'Student S1' });
    expect(rows[0]?.roles).toMatch(/Student/i);
    const d = await asUser<{ d: { assignments: unknown[]; is_self: boolean } }>(U.superAdmin, 'select public.iam_user_detail(1) d');
    expect(d[0]?.d.assignments.length).toBeGreaterThan(0);
    expect(d[0]?.d.is_self).toBe(false);
  });
});

describe('account status', () => {
  it('validates, disables, re-enables, audits, and a disabled user loses identity', async () => {
    await expect(setStatus(U.superAdmin, 9, 'WEIRD')).rejects.toThrow(/ACTIVE, DISABLED or LOCKED/);
    await expect(setStatus(U.superAdmin, 9, 'DISABLED', null)).rejects.toThrow(/reason is required/);
    await expect(setStatus(U.superAdmin, 999, 'DISABLED')).rejects.toThrow(/Unknown user/);
    await setStatus(U.superAdmin, 9, 'DISABLED');
    await setStatus(U.superAdmin, 9, 'DISABLED'); // idempotent
    expect(await val('select account_status from user_account where user_id = 9')).toBe('DISABLED');
    expect(await asUser(U.registrar2, 'select * from public.announcement_feed()')).toEqual([]); // no longer an active member
    await setStatus(U.superAdmin, 9, 'ACTIVE', null);
    expect(await val('select account_status from user_account where user_id = 9')).toBe('ACTIVE');
    expect(Number(await val("select count(*) from activity_audit where module_code = 'IAM' and action_code = 'ACCOUNT_STATUS'"))).toBe(2);
    expect(JSON.stringify((await db.query("select details from activity_audit where action_code = 'ACCOUNT_STATUS' order by activity_audit_id limit 1")).rows)).toContain('because');
  });
  it('protects against self lock-out and removing the last super administrator', async () => {
    await expect(setStatus(U.superAdmin, 8, 'DISABLED')).rejects.toThrow(/own account/);
    // a system administrator (IAM grant, not a super admin) cannot remove the only super admin
    await db.exec(`insert into user_role_assignment (user_id, role_id, scope_type) values (2, ${role('SYSTEM_ADMIN')}, 'GLOBAL')`);
    await expect(setStatus(U.registrar1, 8, 'DISABLED')).rejects.toThrow(/last active super administrator/);
    expect(await val('select account_status from user_account where user_id = 8')).toBe('ACTIVE');
    await expect(asUser(U.registrar1, `select public.iam_revoke_role((select user_role_assignment_id from user_role_assignment where user_id = 8 limit 1))`)).rejects.toThrow(/super administrator/);
  });
});

describe('role assignment', () => {
  it('validates scope, role and entity', async () => {
    await expect(assign(U.superAdmin, 4, 'REGISTRAR', 'GLOBAL')).rejects.toThrow(/must be assigned with INSTITUTION scope/);
    await expect(assign(U.superAdmin, 4, 'REGISTRAR', 'INSTITUTION')).rejects.toThrow(/scope entity is required/);
    await expect(assign(U.superAdmin, 4, 'REGISTRAR', 'INSTITUTION', 99)).rejects.toThrow(/Unknown scope entity/);
    await expect(assign(U.superAdmin, 999, 'REGISTRAR', 'INSTITUTION', 1)).rejects.toThrow(/Unknown user/);
    await expect(asUser(U.superAdmin, 'select public.iam_assign_role(4, 99999, \'GLOBAL\', null, null)')).rejects.toThrow(/active, assignable role/);
    await expect(assign(U.superAdmin, 8, 'REGISTRAR', 'INSTITUTION', 1)).rejects.toThrow(/own roles/);
  });
  it('assigns, is idempotent, takes effect, and is audited; revoking removes access', async () => {
    const a = Number((await assign(U.superAdmin, 4, 'REGISTRAR', 'INSTITUTION', 1))[0]?.id);
    expect(Number((await assign(U.superAdmin, 4, 'REGISTRAR', 'INSTITUTION', 1))[0]?.id)).toBe(a);
    expect(Number(await val(`select assigned_by_user_id from user_role_assignment where user_role_assignment_id = ${a}`))).toBe(8);
    expect((await asUser(U.finance1, 'select student_id from student')).length).toBeGreaterThan(0);
    expect(Number(await val(`select count(*) from activity_audit where module_code = 'IAM' and entity_name = 'user_role_assignment' and entity_id = '${a}'`))).toBe(1);
    await asUser(U.superAdmin, `select public.iam_revoke_role(${a}, 'left')`);
    await asUser(U.superAdmin, `select public.iam_revoke_role(${a}, 'left')`); // idempotent
    expect(await val(`select assignment_status from user_role_assignment where user_role_assignment_id = ${a}`)).toBe('REVOKED');
    await expect(asUser(U.superAdmin, 'select public.iam_revoke_role(99999)')).rejects.toThrow(/Unknown assignment/);
  });
  it('only a super administrator can grant SUPER_ADMIN', async () => {
    await expect(assign(U.registrar1, 4, 'SUPER_ADMIN', 'GLOBAL')).rejects.toThrow(/super administrator can grant/); // registrar1 holds SYSTEM_ADMIN from the test above
  });
});

describe('audit viewer', () => {
  it('filters, pages and shows one entry', async () => {
    const all = await asUser<{ total_count: string; activity_audit_id: string }>(U.superAdmin, 'select activity_audit_id, total_count from public.audit_list(null, null, null, null, null, 2, 0)');
    expect(all).toHaveLength(2);
    expect(Number(all[0]?.total_count)).toBeGreaterThan(2);
    const iam = await asUser<{ module_code: string }>(U.superAdmin, "select module_code from public.audit_list('IAM')");
    expect(iam.length).toBeGreaterThan(0);
    expect(new Set(iam.map((r) => r.module_code))).toEqual(new Set(['IAM']));
    expect((await asUser(U.superAdmin, "select * from public.audit_list(null, 'ACCOUNT_STATUS', 'superadmin')")).length).toBeGreaterThan(0);
    expect((await asUser<{ module_code: string }>(U.superAdmin, 'select module_code from public.audit_modules()')).map((r) => r.module_code)).toContain('IAM');
    const g = await asUser<{ g: { action_code: string } }>(U.superAdmin, `select public.audit_get(${all[0]?.activity_audit_id}) g`);
    expect(g[0]?.g.action_code).toBeTruthy();
    await expect(asUser(U.superAdmin, 'select public.audit_get(999999)')).rejects.toThrow(/Unknown audit entry/);
  });
});
