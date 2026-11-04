import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, U } from './world';

/** Dashboard aggregates (migration 036). They are SECURITY INVOKER, so RLS scopes every number. */
const rows = <T = Record<string, unknown>>(sub: string, sql: string) => asUser<T>(sub, sql);
const total = (r: { n: string | number }[]) => r.reduce((s, x) => s + Number(x.n), 0);

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    UPDATE student_programme_enrolment SET enrolment_status = 'COMPLETED' WHERE student_id = 2;
    INSERT INTO student_financial_account (student_account_id, student_id, account_number) VALUES (1, 1, 'ACC1'), (2, 3, 'ACC2');
    INSERT INTO payment_mode (mode_code, mode_name) VALUES ('TEST_CASH', 'Test cash') ON CONFLICT DO NOTHING;
    INSERT INTO payment_transaction (transaction_number, student_account_id, transaction_date, payment_mode_id, amount, payment_status)
      SELECT t.n, t.a, t.d, (SELECT min(payment_mode_id) FROM payment_mode), t.amt, t.st FROM (VALUES
        ('P-NOW', 1, now(), 500, 'SUCCESS'), ('P-OLD', 1, now() - interval '200 days', 300, 'SUCCESS'), ('P-FAIL', 1, now(), 999, 'FAILED'), ('P-OTHER', 2, now(), 100, 'SUCCESS')) AS t(n, a, d, amt, st);
  `);
}, 180_000);

describe('access', () => {
  it('anon cannot call any dashboard function', async () => {
    for (const f of ['dash_enrolments()', 'dash_applications()', 'dash_registrations()', 'dash_employees()', 'dash_sessions()', 'dash_term_results()', 'dash_fee_collection()', 'dash_fee_outstanding()']) {
      await expect(as('anon', null, `select * from public.${f}`)).rejects.toThrow(/permission denied/i);
    }
  });
  it('an unmapped user gets empty results rather than errors', async () => {
    expect(await rows(U.unmapped, 'select * from public.dash_enrolments()')).toEqual([]);
    expect(await rows(U.unmapped, 'select * from public.dash_employees()')).toEqual([]);
  });
});

describe('scoping follows row-level security', () => {
  it('enrolments are counted per programme and status within the caller scope', async () => {
    const r1 = await rows<{ label: string; enrolment_status: string; n: string }>(U.registrar1, 'select * from public.dash_enrolments()');
    expect(total(r1)).toBe(2); // students 1 and 2 are in institution 1
    expect(r1.find((r) => r.enrolment_status === 'COMPLETED')?.n).toBe(1);
    const r2 = await rows<{ n: string }>(U.registrar2, 'select * from public.dash_enrolments()');
    expect(total(r2)).toBe(1);
    expect(total(await rows<{ n: string }>(U.superAdmin, 'select * from public.dash_enrolments()'))).toBe(3);
  });
  it('a student only counts their own rows', async () => {
    expect(total(await rows<{ n: string }>(U.student1, 'select * from public.dash_enrolments()'))).toBe(1);
  });
  it('employees are scoped to the institution', async () => {
    expect(total(await rows<{ n: string }>(U.registrar1, 'select * from public.dash_employees()'))).toBeLessThanOrEqual(1);
    expect(total(await rows<{ n: string }>(U.superAdmin, 'select * from public.dash_employees()'))).toBe(2);
  });
});

describe('fees', () => {
  it('collection lists every month, counts only successful payments, and respects scope', async () => {
    const all = await rows<{ month: string; collected: string; payments: string }>(U.finance1, 'select month::text, collected, payments from public.dash_fee_collection(6)');
    expect(all.length).toBe(6);
    expect(new Set(all.map((r) => r.month)).size).toBe(6);
    expect(all.reduce((s, r) => s + Number(r.collected), 0)).toBe(500); // P-NOW only: the failed payment is ignored, the 200-day-old one is outside the window, P-OTHER is out of scope
  });
  it('the window length is clamped and longer windows include older payments', async () => {
    const long = await rows<{ collected: string }>(U.finance1, 'select * from public.dash_fee_collection(12)');
    expect(long.length).toBe(12);
    expect(long.reduce((s, r) => s + Number(r.collected), 0)).toBe(800);
    expect((await rows(U.finance1, 'select * from public.dash_fee_collection(0)')).length).toBe(1);
    expect((await rows(U.finance1, 'select * from public.dash_fee_collection(1000)')).length).toBe(36);
  });
  it('finance staff see their institution only; students and registrars see nothing', async () => {
    const mine = await rows<{ collected: string }>(U.finance1, 'select * from public.dash_fee_collection(12)');
    expect(mine.reduce((s, r) => s + Number(r.collected), 0)).toBe(800); // account 1 only: P-NOW + P-OLD
    expect((await rows<{ collected: string }>(U.registrar1, 'select * from public.dash_fee_collection(12)')).reduce((s, r) => s + Number(r.collected), 0)).toBe(0);
    expect((await rows<{ collected: string }>(U.student1, 'select * from public.dash_fee_collection(12)')).reduce((s, r) => s + Number(r.collected), 0)).toBe(0);
  });
  it('outstanding balances exclude cancelled, waived and draft assessments', async () => {
    await db.exec(`
      INSERT INTO student_fee_assessment (assessment_number, student_account_id, academic_year_id, assessment_type, assessment_date, gross_amount, net_payable_amount, amount_paid, balance_amount, due_date, assessment_status) VALUES
        ('A1', 1, 1, 'ACADEMIC', '2025-01-01', 1000, 1000, 400, 600, '2000-01-01', 'PARTIALLY_PAID'),
        ('A2', 1, 1, 'ACADEMIC', '2025-01-01', 500, 500, 0, 500, '2000-01-01', 'CANCELLED'),
        ('A3', 1, 1, 'ACADEMIC', '2025-01-01', 700, 700, 0, 700, '2000-01-01', 'DRAFT'),
        ('A4', 2, 1, 'ACADEMIC', '2025-01-01', 200, 200, 0, 200, '2999-01-01', 'ASSESSED');`);
    const f1 = (await rows<{ payable: string; paid: string; balance: string; overdue_assessments: string }>(U.finance1, 'select * from public.dash_fee_outstanding()'))[0];
    expect(f1).toMatchObject({ payable: '1000.00', paid: '400.00', balance: '600.00', overdue_assessments: 1 });
    expect((await rows<{ balance: string }>(U.student1, 'select * from public.dash_fee_outstanding()'))[0]?.balance).toBe('0');
  });
});

describe('other aggregates', () => {
  it('sessions respect the window; term results split by publication', async () => {
    expect(await rows(U.superAdmin, 'select * from public.dash_sessions(30)')).toEqual([]);
    expect(await rows(U.superAdmin, 'select * from public.dash_term_results()')).toEqual([]);
    expect(await rows(U.superAdmin, 'select * from public.dash_applications()')).toEqual([]);
    expect(await rows(U.superAdmin, 'select * from public.dash_registrations()')).toEqual([]);
  });
});
