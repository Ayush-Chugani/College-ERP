import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, role, U } from './world';

/** Fee receipts and holds (migration 047). finance1 is a finance officer of institution 1; FIN2 of institution 2; student1 owns account 1. */
const FIN2 = '00000000-0000-0000-0000-0000000000a2';
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const one = async <T>(sub: string, sql: string) => (await asUser<T>(sub, sql))[0] as T;
const ITEMS = JSON.stringify([{ fee_type_id: 1, description: 'Tuition', original_amount: 800 }, { fee_type_id: 2, description: 'Lab', original_amount: 700 }]);
let PAY = 0;
let RC = 0;

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO student_financial_account (student_account_id, student_id, account_number) VALUES (1, 1, 'ACC1'), (2, 3, 'ACC2');
    INSERT INTO user_account (user_id, username, password_hash) VALUES (10, 'finance2', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES (10, ${role('FINANCE_OFFICER')}, 'INSTITUTION', 2);
    INSERT INTO auth.users (id) VALUES ('${FIN2}');
    SELECT sims_private.link_auth_user('${FIN2}', 10, 'test');
  `);
  await one(U.finance1, `select public.fin_create_fee_assessment('FA-R', 1, 1, 'ACADEMIC', '2025-01-01', '2025-03-01', '${ITEMS}'::jsonb) id`);
  PAY = Number((await one<{ id: string }>(U.finance1, "select public.fin_record_payment('PAY-R1', 1, 1, 1000) id")).id);
}, 180_000);

describe('receipts', () => {
  it('only authorised staff issue a receipt, once per payment, with a numbered rule', async () => {
    await expect(as('anon', null, `select public.fin_issue_receipt(${PAY})`)).rejects.toThrow(/permission denied/);
    for (const sub of [U.student1, U.registrar1, FIN2, U.unmapped]) await expect(asUser(sub, `select public.fin_issue_receipt(${PAY})`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.finance1, 'select public.fin_issue_receipt(99999)')).rejects.toThrow(/Not authorised/);
    RC = Number((await one<{ id: string }>(U.finance1, `select public.fin_issue_receipt(${PAY}) id`)).id);
    expect(Number((await one<{ id: string }>(U.finance1, `select public.fin_issue_receipt(${PAY}) id`)).id)).toBe(RC); // idempotent
    const r = (await db.query<{ receipt_number: string; receipt_amount: string; receipt_status: string; issued_by: string }>(`select receipt_number, receipt_amount, receipt_status, issued_by from fee_receipt where fee_receipt_id = ${RC}`)).rows[0];
    expect(r?.receipt_number).toMatch(/^RCP-\d{4}-\d{6}$/);
    expect([r?.receipt_amount, r?.receipt_status]).toEqual(['1000.00', 'ISSUED']);
    expect(Number(await val('select count(*) from fee_activity_audit where action_code = \'ISSUE_RECEIPT\''))).toBe(1);
    await expect(asUser(U.finance1, "insert into fee_receipt (receipt_number, payment_transaction_id, receipt_date, receipt_amount) values ('X', 1, now(), 1)")).rejects.toThrow(/permission denied|row-level/);
  });
  it('refuses a payment that did not succeed', async () => {
    await db.exec(`UPDATE payment_transaction SET payment_status = 'FAILED' WHERE payment_transaction_id = ${PAY}`);
    await db.exec(`DELETE FROM fee_receipt WHERE payment_transaction_id = ${PAY}`);
    await expect(asUser(U.finance1, `select public.fin_issue_receipt(${PAY})`)).rejects.toThrow(/successful payment/);
    await db.exec(`UPDATE payment_transaction SET payment_status = 'SUCCESS' WHERE payment_transaction_id = ${PAY}`);
    RC = Number((await one<{ id: string }>(U.finance1, `select public.fin_issue_receipt(${PAY}) id`)).id);
  });
  it('lists payments with their receipt and shows a printable receipt to those who may read it', async () => {
    const list = await asUser<{ receipt_number: string; receipt_status: string; mode_name: string }>(U.finance1, 'select * from public.fin_payment_receipts(1)');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ receipt_status: 'ISSUED' });
    const g = (await one<{ g: { receipt_number: string; student_name: string; account_number: string; can_cancel: boolean; allocations: unknown[] } }>(U.finance1, `select public.fin_receipt_get(${RC}) g`)).g;
    expect(g).toMatchObject({ student_name: 'Stu One', account_number: 'ACC1', can_cancel: true });
    expect(g.allocations).toEqual([]);
    await expect(asUser(FIN2, `select public.fin_receipt_get(${RC})`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.finance1, 'select * from public.fin_payment_receipts(2)')).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.unmapped, `select public.fin_receipt_get(${RC})`)).rejects.toThrow(/Not authorised/);
  });
  it('cancels with a reason; replacing issues a new numbered receipt that points back', async () => {
    await expect(asUser(FIN2, `select public.fin_cancel_receipt(${RC}, 'x')`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.finance1, `select public.fin_cancel_receipt(${RC}, '  ')`)).rejects.toThrow(/reason is required/);
    const NEW = Number((await one<{ id: string }>(U.finance1, `select public.fin_cancel_receipt(${RC}, 'wrong name', true) id`)).id);
    expect(NEW).toBeGreaterThan(RC);
    expect(await val(`select receipt_status from fee_receipt where fee_receipt_id = ${RC}`)).toBe('REPLACED');
    expect(Number(await val(`select original_receipt_id from fee_receipt where fee_receipt_id = ${NEW}`))).toBe(RC);
    await expect(asUser(U.finance1, `select public.fin_cancel_receipt(${RC}, 'again')`)).rejects.toThrow(/Only an issued receipt/);
    await asUser(U.finance1, `select public.fin_cancel_receipt(${NEW}, 'duplicate payment')`);
    expect(await val(`select receipt_status from fee_receipt where fee_receipt_id = ${NEW}`)).toBe('CANCELLED');
    expect(await val(`select cancelled_by is not null from fee_receipt where fee_receipt_id = ${NEW}`)).toBe(true);
    const numbers = (await db.query<{ receipt_number: string }>('select receipt_number from fee_receipt order by fee_receipt_id')).rows.map((x) => x.receipt_number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe('holds', () => {
  let H = 0;
  it('places a hold (idempotent per type), moves the account on hold, and releases it', async () => {
    await expect(asUser(FIN2, "select public.fin_hold_place(1, 'RESULT', 'dues')")).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.student1, "select public.fin_hold_place(1, 'RESULT', 'dues')")).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.finance1, "select public.fin_hold_place(1, 'MOON', 'dues')")).rejects.toThrow(/Invalid hold type/);
    await expect(asUser(U.finance1, "select public.fin_hold_place(1, 'RESULT', ' ')")).rejects.toThrow(/reason is required/);
    H = Number((await one<{ id: string }>(U.finance1, "select public.fin_hold_place(1, 'RESULT', 'Unpaid tuition') id")).id);
    expect(Number((await one<{ id: string }>(U.finance1, "select public.fin_hold_place(1, 'RESULT', 'again') id")).id)).toBe(H);
    const H2 = Number((await one<{ id: string }>(U.finance1, "select public.fin_hold_place(1, 'CERTIFICATE', 'Library dues') id")).id);
    expect(await val('select account_status from student_financial_account where student_account_id = 1')).toBe('ON_HOLD');
    expect((await asUser(U.finance1, 'select * from public.fin_holds(1)')).length).toBe(2);
    await expect(asUser(FIN2, 'select * from public.fin_holds(1)')).rejects.toThrow(/Not authorised/);
    await asUser(U.finance1, `select public.fin_hold_release(${H}, 'Paid')`);
    await asUser(U.finance1, `select public.fin_hold_release(${H}, 'Paid')`); // idempotent
    expect(await val('select account_status from student_financial_account where student_account_id = 1')).toBe('ON_HOLD'); // another hold is still active
    await asUser(U.finance1, `select public.fin_hold_release(${H2}, 'Returned books')`);
    expect(await val('select account_status from student_financial_account where student_account_id = 1')).toBe('ACTIVE');
    await expect(asUser(U.finance1, `select public.fin_hold_release(${H2}, ' ')`)).rejects.toThrow(/reason is required/);
    await expect(asUser(FIN2, `select public.fin_hold_release(${H}, 'x')`)).rejects.toThrow(/Not authorised/);
    expect(Number(await val("select count(*) from fee_activity_audit where action_code in ('PLACE_HOLD', 'RELEASE_HOLD')"))).toBe(4);
  });
  it('a closed account takes no new hold', async () => {
    await db.exec("UPDATE student_financial_account SET account_status = 'CLOSED' WHERE student_account_id = 1");
    await expect(asUser(U.finance1, "select public.fin_hold_place(1, 'OTHER', 'x')")).rejects.toThrow(/CLOSED/);
  });
});
