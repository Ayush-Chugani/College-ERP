import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, role, U } from './world';

/** Benefits, adjustments, instalments, late fees and penalties (migration 053). finance1 and FIN_B are both finance officers of institution 1; FIN2 is of institution 2. */
const FIN_B = '00000000-0000-0000-0000-0000000000b1';
const FIN2 = '00000000-0000-0000-0000-0000000000b2';
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const one = async <T>(sub: string, sql: string) => (await asUser<T>(sub, sql))[0] as T;
const ITEMS = JSON.stringify([{ fee_type_id: 1, description: 'Tuition', original_amount: 1000 }, { fee_type_id: 2, description: 'Lab', original_amount: 500 }]);
let FA = 0;
let ITEM = 0;
let ITEM2 = 0;
const item = async (id: number) => (await db.query<{ concession_amount: string; scholarship_amount: string; adjustment_amount: string; net_amount: string; balance_amount: string; item_status: string }>(
  `select concession_amount, scholarship_amount, adjustment_amount, net_amount, balance_amount, item_status from student_fee_assessment_item where assessment_item_id = ${id}`)).rows[0]!;

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO student_financial_account (student_account_id, student_id, account_number) VALUES (1, 1, 'ACC1'), (2, 3, 'ACC2');
    INSERT INTO user_account (user_id, username, password_hash) VALUES (11, 'finb', 'x'), (12, 'fin2', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES (11, ${role('FINANCE_OFFICER')}, 'INSTITUTION', 1), (12, ${role('FINANCE_OFFICER')}, 'INSTITUTION', 2);
    INSERT INTO auth.users (id) VALUES ('${FIN_B}'), ('${FIN2}');
    SELECT sims_private.link_auth_user('${FIN_B}', 11, 'test');
    SELECT sims_private.link_auth_user('${FIN2}', 12, 'test');
    INSERT INTO academic_year (academic_year_id, year_code, start_date, end_date) VALUES (1, '2024-25', '2024-04-01', '2025-03-31') ON CONFLICT DO NOTHING;
    INSERT INTO concession_type (concession_type_id, concession_code, concession_name, concession_basis, maximum_percentage, maximum_amount) VALUES (1, 'MERIT', 'Merit', 'PERCENTAGE', 50, NULL), (2, 'FLAT', 'Flat', 'FIXED_AMOUNT', NULL, 300);
    INSERT INTO scholarship_scheme (scholarship_scheme_id, scheme_code, scheme_name, scheme_type, maximum_amount) VALUES (1, 'GOV', 'Govt', 'GOVERNMENT', 400);
    INSERT INTO installment_plan (installment_plan_id, plan_code, plan_name, number_of_installments, minimum_initial_percentage) VALUES (1, 'P3', 'Three', 3, 50);
    INSERT INTO late_fee_rule (late_fee_rule_id, rule_code, rule_name, calculation_method, grace_period_days, daily_amount, maximum_amount, effective_from) VALUES (1, 'DAY', 'Per day', 'PER_DAY', 2, 10, 100, '2020-01-01');
  `);
  FA = Number((await one<{ id: string }>(U.finance1, `select public.fin_create_fee_assessment('FA-B', 1, 1, 'ACADEMIC', '2025-01-01', '2025-01-10', '${ITEMS}'::jsonb) id`)).id);
  ITEM = Number(await val(`select assessment_item_id from student_fee_assessment_item where fee_assessment_id = ${FA} and description = 'Tuition'`));
  ITEM2 = Number(await val(`select assessment_item_id from student_fee_assessment_item where fee_assessment_id = ${FA} and description = 'Lab'`));
}, 180_000);

describe('benefits', () => {
  let C = 0;
  it('a request needs FEE_BENEFIT.CREATE at the student and respects the type limits', async () => {
    for (const sub of [U.student1, U.facultyD1, FIN2, U.unmapped]) await expect(asUser(sub, "select public.fin_benefit_create('CONCESSION', 1, 1, 1, null, 20, 'APP1', null, null)")).rejects.toThrow(/Not authorised/);
    await expect(as('anon', null, "select public.fin_benefit_create('CONCESSION', 1, 1, 1, null, 20, 'APP1', null, null)")).rejects.toThrow(/permission denied/);
    await expect(asUser(U.finance1, "select public.fin_benefit_create('CONCESSION', 1, 1, 1, null, 80, 'APP1', null, null)")).rejects.toThrow(/exceeds the maximum/);
    await expect(asUser(U.finance1, "select public.fin_benefit_create('CONCESSION', 1, 1, 2, 500, null, 'APP1', null, null)")).rejects.toThrow(/exceeds the maximum/);
    await expect(asUser(U.finance1, "select public.fin_benefit_create('LOAN', 1, 1, 1, 5, null, null, null, null)")).rejects.toThrow(/Unknown benefit kind/);
    C = Number((await one<{ id: string }>(U.finance1, "select public.fin_benefit_create('CONCESSION', 1, 1, 1, null, 20, 'APP1', null, 'merit') id")).id);
    expect(await val(`select approval_status from student_fee_concession where student_concession_id = ${C}`)).toBe('SUBMITTED');
  });
  it('cannot be applied before it is approved, and the requester cannot approve', async () => {
    await expect(asUser(U.finance1, `select public.fin_benefit_apply('CONCESSION', ${C}, ${ITEM}, 100)`)).rejects.toThrow(/not approved/);
    await expect(asUser(U.finance1, `select public.fin_benefit_decide('CONCESSION', ${C}, true)`)).rejects.toThrow(/yourself/);
    await expect(asUser(FIN2, `select public.fin_benefit_decide('CONCESSION', ${C}, true)`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(FIN_B, `select public.fin_benefit_decide('CONCESSION', ${C}, false)`)).rejects.toThrow(/reason is required/);
    await expect(asUser(FIN_B, `select public.fin_benefit_decide('CONCESSION', ${C}, true, null, 70)`)).rejects.toThrow(/not allowed/);
  });
  it('an approved percentage concession applies per item and is capped', async () => {
    await asUser(FIN_B, `select public.fin_benefit_decide('CONCESSION', ${C}, true)`);
    await expect(asUser(FIN_B, `select public.fin_benefit_decide('CONCESSION', ${C}, true)`)).rejects.toThrow(/Only a submitted/);
    await expect(asUser(U.finance1, `select public.fin_benefit_apply('CONCESSION', ${C}, ${ITEM}, 250)`)).rejects.toThrow(/left of the benefit/);
    await asUser(U.finance1, `select public.fin_benefit_apply('CONCESSION', ${C}, ${ITEM}, 150)`);
    let i = await item(ITEM);
    expect([i.concession_amount, i.net_amount, i.balance_amount]).toEqual(['150.00', '850.00', '850.00']);
    expect(Number(await val(`select net_payable_amount from student_fee_assessment where fee_assessment_id = ${FA}`))).toBe(1350);
    await asUser(U.finance1, `select public.fin_benefit_apply('CONCESSION', ${C}, ${ITEM}, null)`); // the rest: 50
    i = await item(ITEM);
    expect(i.concession_amount).toBe('200.00');
    await expect(asUser(U.finance1, `select public.fin_benefit_apply('CONCESSION', ${C}, ${ITEM}, 1)`)).rejects.toThrow(/left of the benefit/);
    await expect(asUser(U.finance1, `select public.fin_benefit_apply('CONCESSION', ${C}, ${ITEM2}, 100)`)).resolves.toBeDefined(); // 20% of 500 = 100 on the other item
  });
  it('a scholarship and a sponsorship reduce scholarship_amount; other students are untouched', async () => {
    const S = Number((await one<{ id: string }>(U.finance1, "select public.fin_benefit_create('SCHOLARSHIP', 1, 1, 1, 300, null, 'SCH1', null, null) id")).id);
    await expect(asUser(U.finance1, "select public.fin_benefit_create('SCHOLARSHIP', 1, 1, 1, 900, null, 'SCH2', null, null)")).rejects.toThrow(/exceeds the maximum/);
    await asUser(FIN_B, `select public.fin_benefit_decide('SCHOLARSHIP', ${S}, true, 250)`);
    expect(await val(`select application_status || sanctioned_amount from student_scholarship where student_scholarship_id = ${S}`)).toBe('SANCTIONED250.00');
    await asUser(U.finance1, `select public.fin_benefit_apply('SCHOLARSHIP', ${S}, ${ITEM}, 250)`);
    expect((await item(ITEM)).scholarship_amount).toBe('250.00');
    const P = Number((await one<{ id: string }>(U.finance1, "select public.fin_benefit_create('SPONSORSHIP', 1, 1, null, 100, null, 'SP-1', 'Trust', null) id")).id);
    await asUser(FIN_B, `select public.fin_benefit_decide('SPONSORSHIP', ${P}, true)`);
    await asUser(U.finance1, `select public.fin_benefit_apply('SPONSORSHIP', ${P}, ${ITEM2}, 100)`);
    expect((await item(ITEM2)).scholarship_amount).toBe('100.00');
    // student 3 is in institution 2: only that institution's finance officer can act
    await expect(asUser(U.finance1, "select public.fin_benefit_create('SCHOLARSHIP', 3, 1, 1, 50, null, 'SCH-X', null, null)")).rejects.toThrow(/Not authorised/);
    expect(Number((await one<{ id: string }>(FIN2, "select public.fin_benefit_create('SCHOLARSHIP', 3, 1, 1, 50, null, 'SCH-X', null, null) id")).id)).toBeGreaterThan(0);
  });
  it('the audit log records the workflow', async () => {
    expect(Number(await val("select count(*) from fee_activity_audit where action_code in ('BENEFIT_REQUESTED','BENEFIT_APPROVED','BENEFIT_APPLIED')"))).toBeGreaterThanOrEqual(8);
  });
});

describe('adjustments', () => {
  it('request, four-eyes approval, effect on the item', async () => {
    const before = await item(ITEM);
    await expect(asUser(U.student1, `select public.fin_adjustment_create('ADJ-1', 1, ${ITEM}, 'WAIVER', 10, 'x')`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.finance1, `select public.fin_adjustment_create('ADJ-1', 1, ${ITEM}, 'TRANSFER', 10, 'x')`)).rejects.toThrow(/not supported/);
    await expect(asUser(U.finance1, `select public.fin_adjustment_create('ADJ-1', 2, ${ITEM}, 'WAIVER', 10, 'x')`)).rejects.toThrow(/Not authorised|does not belong/);
    const id = Number((await one<{ id: string }>(U.finance1, `select public.fin_adjustment_create('ADJ-1', 1, ${ITEM}, 'WAIVER', 50, 'hardship') id`)).id);
    expect(Number((await one<{ id: string }>(U.finance1, `select public.fin_adjustment_create('ADJ-1', 1, ${ITEM}, 'WAIVER', 50, 'hardship') id`)).id)).toBe(id); // idempotent
    await expect(asUser(U.finance1, `select public.fin_adjustment_decide(${id}, true)`)).rejects.toThrow(/yourself/);
    await asUser(FIN_B, `select public.fin_adjustment_decide(${id}, true)`);
    const after = await item(ITEM);
    expect(Number(after.net_amount)).toBe(Number(before.net_amount) - 50);
    expect(after.adjustment_amount).toBe('-50.00');
    const d = Number((await one<{ id: string }>(U.finance1, `select public.fin_adjustment_create('ADJ-2', 1, ${ITEM}, 'DEBIT', 20, 'late') id`)).id);
    await asUser(FIN_B, `select public.fin_adjustment_decide(${d}, true)`);
    expect(Number((await item(ITEM)).net_amount)).toBe(Number(before.net_amount) - 30);
    const big = Number((await one<{ id: string }>(U.finance1, `select public.fin_adjustment_create('ADJ-3', 1, ${ITEM}, 'WRITE_OFF', 9000, 'big') id`)).id);
    await expect(asUser(FIN_B, `select public.fin_adjustment_decide(${big}, true)`)).rejects.toThrow(/exceeds the unpaid balance/);
    await asUser(FIN_B, `select public.fin_adjustment_decide(${big}, false, 'too big')`);
    expect(await val(`select approval_status from fee_adjustment where fee_adjustment_id = ${big}`)).toBe('REJECTED');
  });
});

describe('instalments', () => {
  it('spreads the net payable amount, matches payments, and locks the amounts while active', async () => {
    const net = Number(await val(`select net_payable_amount from student_fee_assessment where fee_assessment_id = ${FA}`));
    await expect(asUser(U.student1, `select public.fin_instalment_apply(${FA}, 1, current_date + 5)`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.finance1, `select public.fin_instalment_apply(${FA}, 1, current_date - 5)`)).rejects.toThrow(/today or later/);
    expect(Number((await one<{ n: string }>(U.finance1, `select public.fin_instalment_apply(${FA}, 1, current_date + 5) n`)).n)).toBe(3);
    const rows = (await db.query<{ installment_amount: string; installment_number: number }>(`select installment_amount, installment_number from student_installment_schedule where fee_assessment_id = ${FA} order by 2`)).rows;
    expect(rows.reduce((a, r) => a + Number(r.installment_amount), 0)).toBeCloseTo(net, 2);
    expect(Number(rows[0]!.installment_amount)).toBeGreaterThanOrEqual(net / 2 - 0.01); // minimum initial 50%
    await expect(asUser(U.finance1, `select public.fin_instalment_apply(${FA}, 1, current_date + 5)`)).rejects.toThrow(/already has/);
    await expect(asUser(U.finance1, `select public.fin_adjustment_decide(0, true)`)).rejects.toThrow(/Not authorised/);
    const x = Number((await one<{ id: string }>(U.finance1, `select public.fin_adjustment_create('ADJ-4', 1, ${ITEM2}, 'DEBIT', 5, 'x') id`)).id);
    await expect(asUser(FIN_B, `select public.fin_adjustment_decide(${x}, true)`)).rejects.toThrow(/instalment schedule/);
    // a student sees their own schedule through fin_account_extras, but no benefit or adjustment rows
    const ex = (await one<{ e: { instalments: unknown[]; benefits: unknown[]; adjustments: unknown[]; can: Record<string, boolean> } }>(U.student1, 'select public.fin_account_extras(1) e')).e;
    expect([ex.instalments.length, ex.benefits.length, ex.adjustments.length]).toEqual([3, 0, 0]);
    expect(Object.values(ex.can).some(Boolean)).toBe(false);
    await expect(asUser(U.student1, 'select public.fin_account_extras(2)')).rejects.toThrow(/Not authorised/);
    await asUser(U.finance1, `select public.fin_instalment_cancel(${FA})`);
    await expect(asUser(U.finance1, `select public.fin_instalment_cancel(${FA})`)).rejects.toThrow(/no active/);
    await asUser(FIN_B, `select public.fin_adjustment_decide(${x}, true)`);
  });
});

describe('late fees and penalties', () => {
  it('suggests from the rule and the penalty is payable and waivable', async () => {
    // due 2025-01-10, grace 2 days, 10/day, capped at 100
    expect(Number((await one<{ s: string }>(U.finance1, `select public.fin_late_fee_suggest(${FA}, 1, '2025-01-15') s`)).s)).toBe(30);
    expect(Number((await one<{ s: string }>(U.finance1, `select public.fin_late_fee_suggest(${FA}, 1, '2025-01-11') s`)).s)).toBe(0);
    expect(Number((await one<{ s: string }>(U.finance1, `select public.fin_late_fee_suggest(${FA}, 1, '2026-01-01') s`)).s)).toBe(100);
    await expect(asUser(U.finance1, `select public.fin_late_fee_suggest(${FA}, 99)`)).rejects.toThrow(/late-fee rule/);
    await expect(asUser(FIN2, `select public.fin_late_fee_suggest(${FA}, 1)`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.finance1, "select public.fin_penalty_assess(1, 1, 0, 'x', 1, current_date)")).rejects.toThrow(/positive amount/);
    const p = Number((await one<{ id: string }>(U.finance1, "select public.fin_penalty_assess(1, 1, 60, 'Late payment', 1, current_date + 30) id")).id);
    const pi = Number(await val(`select assessment_item_id from student_fee_penalty where fee_penalty_id = ${p}`));
    expect((await item(pi)).balance_amount).toBe('60.00');
    await expect(asUser(U.finance1, `select public.fin_penalty_waive(${p}, 20, 'x')`)).resolves.toBeDefined(); // finance officer holds FEE_REFUND.APPROVE
    await expect(asUser(U.student1, `select public.fin_penalty_waive(${p}, 5, 'x')`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.finance1, `select public.fin_penalty_waive(${p}, 500, 'x')`)).rejects.toThrow(/left of the penalty/);
    await asUser(U.finance1, `select public.fin_penalty_waive(${p}, 40, 'all')`);
    expect(await val(`select penalty_status from student_fee_penalty where fee_penalty_id = ${p}`)).toBe('WAIVED');
    expect((await item(pi)).item_status).toBe('WAIVED');
  });
});
