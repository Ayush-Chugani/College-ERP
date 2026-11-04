import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, role, U } from './world';

/** Finance read helpers and account opening (migration 034). */
const FIN2 = '00000000-0000-0000-0000-0000000000a2';
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO student_financial_account (student_account_id, student_id, account_number) VALUES (1, 1, 'ACC1'), (2, 3, 'ACC2');
    INSERT INTO user_account (user_id, username, password_hash) VALUES (10, 'finance2', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES (10, ${role('FINANCE_OFFICER')}, 'INSTITUTION', 2);
    INSERT INTO auth.users (id) VALUES ('${FIN2}');
    SELECT sims_private.link_auth_user('${FIN2}', 10, 'test');
    SELECT setval(pg_get_serial_sequence('student_financial_account', 'student_account_id'), 2);
  `);
  await db.exec(`
    SELECT public.fin_create_fee_assessment('FA-R1', 1, 1, 'ACADEMIC', '2025-01-01', '2025-03-01', '[{"fee_type_id":1,"original_amount":1000}]'::jsonb)
  `).catch(() => undefined);
}, 180_000);

describe('fin_accounts / fin_account_info', () => {
  it('anon cannot call them', async () => {
    await expect(as('anon', null, 'select * from public.fin_accounts()')).rejects.toThrow(/permission denied/i);
    await expect(as('anon', null, 'select * from public.fin_account_info(1)')).rejects.toThrow(/permission denied/i);
  });
  it('lists only accounts in the caller scope, with names', async () => {
    const mine = await asUser<{ student_account_id: string; display_name: string; total_count: string }>(U.finance1, 'select * from public.fin_accounts()');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.display_name)).toBe(true);
    const other = await asUser<{ student_account_id: string }>(FIN2, 'select * from public.fin_accounts()');
    const ids = new Set([...mine, ...other].map((r) => r.student_account_id));
    expect(mine.map((r) => r.student_account_id).filter((i) => other.map((o) => o.student_account_id).includes(i))).toEqual([]); // disjoint institutions
    expect(ids.size).toBe(mine.length + other.length);
  });
  it('a student sees only their own account; staff without FEES permissions see none (M052)', async () => {
    expect((await asUser<{ student_account_id: number }>(U.student1, 'select * from public.fin_accounts()')).map((r) => Number(r.student_account_id))).toEqual([1]);
    expect(await asUser(U.registrar1, 'select * from public.fin_accounts()')).toEqual([]);
  });
  it('search matches student number, name or account number without treating input as a pattern', async () => {
    expect((await asUser(U.finance1, "select * from public.fin_accounts('%')")).length).toBe(0);
    expect((await asUser(U.finance1, "select * from public.fin_accounts('ACC1')")).length).toBe(1);
  });
  it('account info: same refusal for unknown and out-of-scope; totals follow assessments', async () => {
    await expect(asUser(U.finance1, 'select * from public.fin_account_info(99999)')).rejects.toThrow(/Not authorised/);
    await expect(asUser(FIN2, 'select * from public.fin_account_info(1)')).rejects.toThrow(/Not authorised/);
    const r = (await asUser<{ total_payable: string; total_balance: string }>(U.finance1, 'select * from public.fin_account_info(1)'))[0];
    expect(Number(r?.total_payable)).toBe(Number(await val("select coalesce(sum(net_payable_amount),0) from student_fee_assessment where student_account_id=1")));
    expect((await asUser(U.student1, 'select * from public.fin_account_info(1)')).length).toBe(1); // their own account
    await expect(asUser(U.student1, 'select * from public.fin_account_info(2)')).rejects.toThrow(/Not authorised/); // someone else's
    await expect(asUser(U.registrar1, 'select * from public.fin_account_info(1)')).rejects.toThrow(/Not authorised/);
  });
});

describe('fin_open_account', () => {
  it('creates once (idempotent), audits, and refuses unauthorised or unknown students identically', async () => {
    const sn = String(await val('select student_number from student where student_id = 2'));
    const a = (await asUser<{ id: string }>(U.finance1, `select public.fin_open_account('${sn}') id`))[0];
    const b = (await asUser<{ id: string }>(U.finance1, `select public.fin_open_account('${sn}') id`))[0];
    expect(b?.id).toBe(a?.id);
    expect(Number(await val(`select count(*) from student_financial_account where account_number = 'ACC-${sn}'`))).toBe(1);
    expect(Number(await val("select count(*) from fee_activity_audit where action_code = 'ACCOUNT_OPENED'"))).toBe(1);
    await expect(asUser(U.finance1, "select public.fin_open_account('NOPE')")).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.registrar1, `select public.fin_open_account('${sn}')`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.student1, `select public.fin_open_account('${sn}')`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.finance1, "select public.fin_open_account('  ')")).rejects.toThrow(/required/);
  });
});

describe('fin_academic_years', () => {
  it('is available to signed-in users only', async () => {
    await expect(as('anon', null, 'select * from public.fin_academic_years()')).rejects.toThrow(/permission denied/i);
    await expect(asUser(U.unmapped, 'select * from public.fin_academic_years()')).resolves.toEqual([]);
    expect((await asUser(U.finance1, 'select * from public.fin_academic_years()')).length).toBe(Number(await val('select count(*) from academic_year')));
  });
});
