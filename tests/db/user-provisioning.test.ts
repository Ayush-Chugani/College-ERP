import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createWorld, db, U } from './world';

/** User provisioning (migration 049). The service_role function is called as the server would call it: as the service_role database role. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const lit = (v: string | null) => (v === null ? 'null' : `'${v}'`);
const AUTH1 = '00000000-0000-0000-0000-0000000000b1';
const AUTH2 = '00000000-0000-0000-0000-0000000000b2';
const AUTH3 = '00000000-0000-0000-0000-0000000000b3';

async function provision(auth: string, email: string, student: string | null = null, employee: string | null = null, actor = 8) {
  await db.exec('SET ROLE service_role');
  try {
    return Number((await db.query<{ id: string }>(`select public.iam_provision_user('${auth}', ${lit(email)}, ${lit(student)}, ${lit(employee)}, ${actor}) id`)).rows[0]?.id);
  } finally {
    await db.exec('RESET ROLE');
  }
}

beforeAll(async () => {
  await createWorld();
  await db.exec(`INSERT INTO auth.users (id) VALUES ('${AUTH1}'), ('${AUTH2}'), ('${AUTH3}')`);
}, 180_000);

describe('who may call what', () => {
  it('iam_can_provision is true only for a global IAM.ALL.CREATE holder', async () => {
    expect((await asUser<{ ok: boolean }>(U.superAdmin, 'select public.iam_can_provision() ok'))[0]?.ok).toBe(true);
    for (const sub of [U.registrar1, U.student1, U.facultyD1, U.finance1, U.unmapped]) {
      expect((await asUser<{ ok: boolean }>(sub, 'select public.iam_can_provision() ok'))[0]?.ok).toBe(false);
    }
  });
  it('the provisioning function is not callable by signed-in users or anon', async () => {
    await expect(asUser(U.superAdmin, `select public.iam_provision_user('${AUTH1}', 'x@example.org', null, null, 1)`)).rejects.toThrow(/permission denied/);
    await expect(asUser(null, `select public.iam_can_provision()`)).resolves.toBeDefined();
  });
});

describe('provisioning', () => {
  it('creates an ACTIVE account that must change its password, maps the Auth identity, audits, and is idempotent', async () => {
    const id = await provision(AUTH1, '  New.Admin@Example.org ');
    expect(id).toBeGreaterThan(0);
    const u = (await db.query<{ username: string; email: string; account_status: string; must_change_password: boolean; password_hash: string }>(`select username, email, account_status, must_change_password, password_hash from user_account where user_id = ${id}`)).rows[0];
    expect(u).toMatchObject({ username: 'new.admin@example.org', email: 'new.admin@example.org', account_status: 'ACTIVE', must_change_password: true });
    expect(u?.password_hash).toBe('!supabase-auth'); // no password is ever stored here
    expect(Number(await val(`select count(*) from sims_private.auth_identity_map where auth_user_id = '${AUTH1}' and user_id = ${id}`))).toBe(1);
    expect(Number(await val("select count(*) from activity_audit where module_code = 'IAM' and action_code = 'PROVISION'"))).toBe(1);
    expect(await provision(AUTH1, 'new.admin@example.org')).toBe(id); // replay
    expect(Number(await val("select count(*) from user_account where username = 'new.admin@example.org'"))).toBe(1);
  });
  it('a new account has no roles and therefore no access until roles are assigned', async () => {
    const id = Number(await val("select user_id from user_account where username = 'new.admin@example.org'"));
    expect(Number(await val(`select count(*) from user_role_assignment where user_id = ${id}`))).toBe(0);
    expect(await asUser(AUTH1, 'select * from student')).toEqual([]);
    expect((await asUser<{ id: string }>(AUTH1, 'select sims_private.current_user_id()::text id'))[0]?.id).toBe(String(id));
  });
  it('rejects bad input and duplicates', async () => {
    await expect(provision(AUTH2, 'not-an-email')).rejects.toThrow(/valid email/);
    await expect(provision(AUTH2, 'new.admin@example.org')).rejects.toThrow(/already exists/);
    await expect(provision(AUTH2, 'both@example.org', 'S1', 'E1')).rejects.toThrow(/not both/);
    await expect(provision(AUTH2, 'ghost@example.org', 'NOPE')).rejects.toThrow(/Unknown student/);
    await expect(provision(AUTH2, 'ghost@example.org', null, 'NOPE')).rejects.toThrow(/Unknown employee/);
    expect(Number(await val("select count(*) from user_account where username in ('ghost@example.org', 'both@example.org', 'not-an-email')"))).toBe(0);
  });
  it('links a student or an employee once', async () => {
    await db.exec("INSERT INTO student (student_id, student_number, first_name, display_name) VALUES (50, 'S50', 'Fifty', 'Fifty Student')");
    const id = await provision(AUTH2, 'stu50@example.org', 'S50');
    expect(Number(await val(`select count(*) from student_user_account where student_id = 50 and user_id = ${id}`))).toBe(1);
    await expect(provision(AUTH3, 'again50@example.org', 'S50')).rejects.toThrow(/already has an account/);
    await db.exec("INSERT INTO employee (employee_id, institution_id, employment_source_id, employee_number, first_name, display_name, joining_date, employment_type) VALUES (50, 1, 1, 'E50', 'Emp', 'Emp Fifty', '2020-01-01', 'REGULAR')");
    const eid = await provision(AUTH3, 'emp50@example.org', null, 'E50');
    expect(Number(await val(`select count(*) from employee_user_account where employee_id = 50 and user_id = ${eid}`))).toBe(1);
    expect(Number(await val("select count(*) from user_account where username = 'again50@example.org'"))).toBe(0); // failed call left nothing behind
  });
});
