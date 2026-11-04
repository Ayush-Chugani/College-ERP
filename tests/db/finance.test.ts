import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, role, U } from './world';

/**
 * Finance RPCs (migration 021). Runs on embedded Postgres, single connection: it proves logic, authorisation, idempotency and limit
 * enforcement, but NOT concurrent interleavings (those need a multi-connection Postgres).
 */
const FIN2 = '00000000-0000-0000-0000-0000000000a2';
const CASHIER = '00000000-0000-0000-0000-0000000000a3';

const one = async <T>(sub: string, sql: string) => (await asUser<T>(sub, sql))[0] as T;
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];

const ITEMS = JSON.stringify([
  { fee_type_id: 1, description: 'Tuition', original_amount: 800 },
  { fee_type_id: 2, description: 'Lab', original_amount: 700, concession_amount: 100 },
]);
const createAssessment = (sub: string, number = 'FA-1', year = 1, items = ITEMS, acct = 1) =>
  one<{ id: string }>(sub, `select public.fin_create_fee_assessment('${number}', ${acct}, ${year}, 'ACADEMIC', '2025-01-01', '2025-03-01', '${items}'::jsonb) id`);

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO student_financial_account (student_account_id, student_id, account_number) VALUES (1, 1, 'ACC1'), (2, 3, 'ACC2');
    INSERT INTO user_account (user_id, username, password_hash) VALUES (10, 'finance2', 'x'), (11, 'cashier1', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES (10, ${role('FINANCE_OFFICER')}, 'INSTITUTION', 2);
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, campus_id) VALUES (11, ${role('CASHIER')}, 'CAMPUS', 1);
    INSERT INTO auth.users (id) VALUES ('${FIN2}'), ('${CASHIER}');
    SELECT sims_private.link_auth_user('${FIN2}', 10, 'test');
    SELECT sims_private.link_auth_user('${CASHIER}', 11, 'test');
  `);
}, 180_000);

describe('authorisation and scope', () => {
  it('anon cannot call the RPCs', async () => {
    await expect(as('anon', null, "select public.fin_record_payment('X',1,1,10)")).rejects.toThrow(/permission denied/i);
  });
  it('students, unrelated staff and out-of-scope finance officers are refused', async () => {
    for (const sub of [U.student1, U.registrar1, FIN2]) {
      await expect(asUser(sub, "select public.fin_record_payment('AUTH-1', 1, 1, 100)")).rejects.toThrow(/Not authorised/);
    }
  });
  it('cashier (FEE_PAYMENT only) cannot create assessments or decide refunds', async () => {
    await expect(createAssessment(CASHIER, 'FA-C')).rejects.toThrow(/Not authorised/);
    await expect(asUser(CASHIER, 'select public.fin_decide_refund(1, true)')).rejects.toThrow(/Not authorised/);
  });
  it('unknown ids give the same refusal as out-of-scope (no enumeration)', async () => {
    await expect(asUser(U.finance1, "select public.fin_record_payment('AUTH-2', 99999, 1, 100)")).rejects.toThrow(/Not authorised/);
  });
});

describe('fee assessment', () => {
  it('computes item and header totals on the server and is idempotent on assessment_number', async () => {
    const a = await createAssessment(U.finance1);
    const b = await createAssessment(U.finance1);
    expect(b.id).toBe(a.id);
    expect(Number(await val('select count(*) from student_fee_assessment_item'))).toBe(2);
    const h = (await db.query<Record<string, string>>(`select gross_amount g, concession_amount c, net_payable_amount n, balance_amount b, assessment_status s from student_fee_assessment where fee_assessment_id=${a.id}`)).rows[0];
    expect(h).toEqual({ g: '1500.00', c: '100.00', n: '1400.00', b: '1400.00', s: 'ASSESSED' });
  });
  it('rejects reuse of a number for a different assessment, bad amounts and empty items', async () => {
    await expect(createAssessment(U.finance1, 'FA-1', 2)).rejects.toThrow(/already used/);
    await expect(createAssessment(U.finance1, 'FA-N', 1, JSON.stringify([{ fee_type_id: 1, original_amount: -5 }]))).rejects.toThrow(/Invalid fee item/);
    await expect(createAssessment(U.finance1, 'FA-N', 1, JSON.stringify([{ fee_type_id: 1, original_amount: 10, concession_amount: 20 }]))).rejects.toThrow(/negative/);
    await expect(createAssessment(U.finance1, 'FA-N', 1, JSON.stringify([{ fee_type_id: 1, original_amount: 10.005 }]))).rejects.toThrow(/Invalid fee item/);
    await expect(createAssessment(U.finance1, 'FA-N', 1, '[]')).rejects.toThrow(/non-empty/);
    expect(Number(await val("select count(*) from student_fee_assessment where assessment_number='FA-N'"))).toBe(0);
  });
});

describe('payments and allocation', () => {
  let pay: string;
  it('records an offline payment idempotently and refuses online/unreferenced/invalid ones', async () => {
    pay = (await one<{ id: string }>(U.finance1, "select public.fin_record_payment('PAY-1', 1, 1, 1000) id")).id;
    expect((await one<{ id: string }>(U.finance1, "select public.fin_record_payment('PAY-1', 1, 1, 1000) id")).id).toBe(pay);
    expect(Number(await val("select count(*) from payment_transaction where transaction_number='PAY-1'"))).toBe(1);
    await expect(asUser(U.finance1, "select public.fin_record_payment('PAY-1', 1, 1, 999)")).rejects.toThrow(/different details/);
    await expect(asUser(U.finance1, "select public.fin_record_payment('PAY-2', 1, 2, 100)")).rejects.toThrow(/gateway/);
    await expect(asUser(U.finance1, "select public.fin_record_payment('PAY-3', 1, 6, 100)")).rejects.toThrow(/reference/);
    await expect(asUser(U.finance1, "select public.fin_record_payment('PAY-4', 1, 1, 0)")).rejects.toThrow(/positive/);
    await expect(asUser(U.finance1, "select public.fin_record_payment('PAY-5', 1, 1, 10.123)")).rejects.toThrow(/2 decimals/);
    await asUser(CASHIER, "select public.fin_record_payment('PAY-6', 1, 6, 50, 'CHQ-123')");
  });
  it('allocates, maintains item/assessment status, and never over-allocates', async () => {
    const items = (await db.query<{ assessment_item_id: string; net_amount: string }>('select assessment_item_id, net_amount from student_fee_assessment_item order by assessment_item_id')).rows;
    const [i1, i2] = [items[0]!.assessment_item_id, items[1]!.assessment_item_id]; // net 800, 600
    await asUser(U.finance1, `select public.fin_allocate_payment(${pay}, ${i1}, 800)`);
    expect(await val(`select item_status from student_fee_assessment_item where assessment_item_id=${i1}`)).toBe('PAID');
    await expect(asUser(U.finance1, `select public.fin_allocate_payment(${pay}, ${i2}, 300)`)).rejects.toThrow(/exceeds payment amount/);
    await asUser(U.finance1, `select public.fin_allocate_payment(${pay}, ${i2}, 200)`);
    expect(await val(`select item_status from student_fee_assessment_item where assessment_item_id=${i2}`)).toBe('PARTIALLY_PAID');
    expect(await val('select assessment_status from student_fee_assessment where fee_assessment_id=1')).toBe('PARTIALLY_PAID');
    expect(await val('select balance_amount from student_fee_assessment where fee_assessment_id=1')).toBe('400.00');
    // replay with the same amount is a no-op; a different amount is refused
    const again = await one<{ id: string }>(U.finance1, `select public.fin_allocate_payment(${pay}, ${i2}, 200) id`);
    expect(Number(again.id)).toBeGreaterThan(0);
    expect(Number(await val('select count(*) from payment_allocation'))).toBe(2);
    await expect(asUser(U.finance1, `select public.fin_allocate_payment(${pay}, ${i2}, 100)`)).rejects.toThrow(/different amount/);
    // totals can never exceed the payment
    expect(Number(await val('select sum(allocated_amount) from payment_allocation'))).toBeLessThanOrEqual(1000);
  });
  it('refuses allocating to another account\'s item or a non-success payment', async () => {
    await fkSwitch(false);
    await db.exec(`
      INSERT INTO student_fee_assessment (fee_assessment_id, assessment_number, student_account_id, academic_year_id, assessment_type, assessment_date) VALUES (50, 'FA-OTHER', 2, 1, 'ACADEMIC', '2025-01-01');
      INSERT INTO student_fee_assessment_item (assessment_item_id, fee_assessment_id, fee_type_id, original_amount, net_amount, balance_amount) VALUES (500, 50, 1, 100, 100, 100);`);
    await expect(asUser(U.finance1, `select public.fin_allocate_payment(${pay}, 500, 10)`)).rejects.toThrow(/does not belong/);
  });
});

describe('refunds', () => {
  let pay: string;
  let req: string;
  beforeAll(async () => {
    pay = String(await val("select payment_transaction_id from payment_transaction where transaction_number='PAY-1'"));
  });
  it('requests are idempotent and limited by the payment', async () => {
    req = (await one<{ id: string }>(U.finance1, `select public.fin_request_refund('RR-1', 1, ${pay}, 300, 'overpaid') id`)).id;
    expect((await one<{ id: string }>(U.finance1, `select public.fin_request_refund('RR-1', 1, ${pay}, 300, 'overpaid') id`)).id).toBe(req);
    await expect(asUser(U.finance1, `select public.fin_request_refund('RR-2', 1, ${pay}, 5000, 'x')`)).rejects.toThrow(/exceeds the refundable/);
    await expect(asUser(U.finance1, `select public.fin_request_refund('RR-1', 1, ${pay}, 301, 'overpaid')`)).rejects.toThrow(/different details/);
  });
  it('cannot be processed before approval; approval is permission-checked and bounded', async () => {
    await expect(asUser(U.finance1, `select public.fin_process_refund('RF-1', ${req}, 1, 100)`)).rejects.toThrow(/approved first/);
    await expect(asUser(CASHIER, `select public.fin_decide_refund(${req}, true)`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.finance1, `select public.fin_decide_refund(${req}, true, 400)`)).rejects.toThrow(/cannot exceed the requested/);
    await asUser(U.finance1, `select public.fin_decide_refund(${req}, true, 250)`);
    await asUser(U.finance1, `select public.fin_decide_refund(${req}, true, 250)`); // replay is a no-op
    expect(await val(`select request_status || ':' || approved_amount from refund_request where refund_request_id=${req}`)).toBe('APPROVED:250.00');
  });
  it('processing is bounded by the approval, idempotent, and updates request and payment status', async () => {
    const rf = (await one<{ id: string }>(U.finance1, `select public.fin_process_refund('RF-1', ${req}, 1, 250) id`)).id;
    expect((await one<{ id: string }>(U.finance1, `select public.fin_process_refund('RF-1', ${req}, 1, 250) id`)).id).toBe(rf);
    expect(await val(`select request_status from refund_request where refund_request_id=${req}`)).toBe('PROCESSED');
    expect(await val(`select payment_status from payment_transaction where payment_transaction_id=${pay}`)).toBe('PARTIALLY_REFUNDED');
    await expect(asUser(U.finance1, `select public.fin_process_refund('RF-2', ${req}, 1, 1)`)).rejects.toThrow(/exceeds approved amount/);
    await expect(asUser(U.finance1, `select public.fin_process_refund('RF-1', ${req}, 1, 249)`)).rejects.toThrow(/different details/);
    expect(Number(await val('select count(*) from fee_refund'))).toBe(1);
  });
  it('rejection path works and a decided request cannot be re-decided', async () => {
    const r2 = (await one<{ id: string }>(U.finance1, `select public.fin_request_refund('RR-3', 1, ${pay}, 100, 'mistake') id`)).id;
    await asUser(U.finance1, `select public.fin_decide_refund(${r2}, false)`);
    expect(await val(`select request_status from refund_request where refund_request_id=${r2}`)).toBe('REJECTED');
    await expect(asUser(U.finance1, `select public.fin_decide_refund(${r2}, true)`)).rejects.toThrow(/cannot be approved/);
  });
});

describe('audit trail', () => {
  it('every money movement left an audit row attributed to the acting user', async () => {
    const r = await db.query<{ action_code: string; user_id: string }>('select action_code, user_id from fee_activity_audit');
    const actions = new Set(r.rows.map((x) => x.action_code));
    for (const a of ['ASSESSMENT_CREATED', 'PAYMENT_RECORDED', 'PAYMENT_ALLOCATED', 'REFUND_REQUESTED', 'REFUND_APPROVED', 'REFUND_PROCESSED', 'REFUND_REJECTED']) {
      expect(actions.has(a)).toBe(true);
    }
    expect(r.rows.every((x) => x.user_id !== null)).toBe(true);
  });
});
