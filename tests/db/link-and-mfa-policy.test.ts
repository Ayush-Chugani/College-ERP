import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

/** Linking an existing Auth user and the MFA policy (migration 058). superAdmin holds every IAM grant; registrar1 holds none. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const NEW_AUTH = '00000000-0000-0000-0000-0000000000e1';
const ctxOf = async (sub: string) => (await asUser<{ c: Record<string, unknown> | null }>(sub, 'select public.my_context() c'))[0]?.c;

beforeAll(async () => {
  await createWorld();
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${NEW_AUTH}', 'Newbie@Example.org')`);
}, 180_000);

describe('link an existing Auth user', () => {
  it('needs IAM.ALL.CREATE and an existing, unlinked Auth user', async () => {
    await expect(as('anon', null, "select public.iam_link_auth_user('newbie@example.org')")).rejects.toThrow(/permission denied/);
    await expect(asUser(U.registrar1, "select public.iam_link_auth_user('newbie@example.org')")).rejects.toThrow(/IAM.ALL.CREATE/);
    await expect(asUser(U.superAdmin, "select public.iam_link_auth_user('nobody@example.org')")).rejects.toThrow(/Authentication dashboard/);
    await expect(asUser(U.superAdmin, "select public.iam_link_auth_user('not an email')")).rejects.toThrow(/valid email/);
  });
  it('creates the account, links the person once, and refuses a second link', async () => {
    const id = Number((await asUser<{ id: string }>(U.superAdmin, "select public.iam_link_auth_user('NEWBIE@example.org', 'S1B', null) id"))[0]?.id);
    expect(id).toBeGreaterThan(0);
    expect(await val(`select student_id from student_user_account where user_id = ${id}`)).toBe(2);
    expect(await val(`select must_change_password from user_account where user_id = ${id}`)).toBe(true);
    await expect(asUser(U.superAdmin, "select public.iam_link_auth_user('newbie@example.org')")).rejects.toThrow(/already linked/);
    expect(Number(await val("select count(*) from activity_audit where action_code = 'PROVISION'"))).toBe(1);
  });
});

describe('link a person to an account', () => {
  it('validates and links', async () => {
    await db.exec("INSERT INTO user_account (user_id, username, password_hash) VALUES (41, 'plain', 'x')");
    await expect(asUser(U.registrar1, "select public.iam_link_person(41, 'S2', null)")).rejects.toThrow(/IAM.ALL.UPDATE/);
    await expect(asUser(U.superAdmin, "select public.iam_link_person(41, null, null)")).rejects.toThrow(/either/);
    await expect(asUser(U.superAdmin, "select public.iam_link_person(41, 'S2', 'E1')")).rejects.toThrow(/either/);
    await expect(asUser(U.superAdmin, "select public.iam_link_person(41, 'NOPE', null)")).rejects.toThrow(/Unknown student/);
    await expect(asUser(U.superAdmin, "select public.iam_link_person(41, 'S1', null)")).rejects.toThrow(/already has an account/);
    await asUser(U.superAdmin, "select public.iam_link_person(41, null, 'E2')");
    expect(await val('select employee_id from employee_user_account where user_id = 41')).toBe(2);
    await expect(asUser(U.superAdmin, "select public.iam_link_person(41, 'S2', null)")).rejects.toThrow(/already linked/);
    await expect(asUser(U.superAdmin, 'select public.iam_link_person(8, null, \'E1\')')).rejects.toThrow(/own links/);
  });
});

describe('require two-step verification for a role', () => {
  it('is configured by IAM.ALL.CONFIGURE and shows up as a gap and a context flag', async () => {
    await expect(asUser(U.registrar1, "select public.iam_mfa_policy_set('REGISTRAR', true)")).rejects.toThrow(/IAM.ALL.CONFIGURE/);
    await expect(asUser(U.superAdmin, "select public.iam_mfa_policy_set('NOPE', true)")).rejects.toThrow(/Unknown role/);
    expect((await ctxOf(U.registrar1))?.mfa_setup_required).toBe(false);
    await asUser(U.superAdmin, "select public.iam_mfa_policy_set('REGISTRAR', true)");
    await asUser(U.superAdmin, "select public.iam_mfa_policy_set('REGISTRAR', true)"); // idempotent
    expect((await ctxOf(U.registrar1))?.mfa_setup_required).toBe(true);
    expect((await ctxOf(U.student1))?.mfa_setup_required).toBe(false);
    const gaps = await asUser<{ username: string; role_code: string }>(U.superAdmin, 'select * from public.iam_mfa_policy_gaps()');
    expect(gaps.map((g) => g.username)).toContain('registrar1');
    expect((await asUser<{ required: boolean }>(U.superAdmin, "select * from public.iam_mfa_policy_list() where role_code = 'REGISTRAR'"))[0]?.required).toBe(true);
    await expect(asUser(U.registrar1, 'select * from public.iam_mfa_policy_gaps()')).rejects.toThrow(/IAM.ALL.READ/);
  });
  it('enrolling clears the flag; lifting the policy clears it too', async () => {
    await db.exec(`UPDATE user_account SET multi_factor_enabled = true WHERE username = 'registrar1'`);
    await db.exec(`SELECT set_config('request.jwt.claims', '{"aal":"aal2"}', false)`);
    expect((await ctxOf(U.registrar1))?.mfa_setup_required).toBe(false);
    await db.exec(`UPDATE user_account SET multi_factor_enabled = false WHERE username = 'registrar1'`);
    await db.exec(`SELECT set_config('request.jwt.claims', '', false)`);
    expect((await ctxOf(U.registrar1))?.mfa_setup_required).toBe(true);
    await asUser(U.superAdmin, "select public.iam_mfa_policy_set('REGISTRAR', false)");
    expect((await ctxOf(U.registrar1))?.mfa_setup_required).toBe(false);
  });
});
