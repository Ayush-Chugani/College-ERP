import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SUPABASE_STUB } from '../db/supabase-stub';
import { buildWorld, fkSwitch, U, type SqlRunner } from '../db/world';

/**
 * Concurrent finance operations on a REAL multi-connection PostgreSQL (R-TST-7, R-FIN-4). The embedded test database has one connection, so it cannot interleave transactions.
 * Opt-in: set PG_CONCURRENCY_URL to a superuser connection string of a scratch server (for example postgres://postgres@127.0.0.1:55432/postgres). A fresh database is created and dropped.
 *   su postgres -c "pg_ctl -D /tmp/pgdata -o '-p 55432' start" && PG_CONCURRENCY_URL=postgres://postgres@127.0.0.1:55432/postgres npm run test:concurrency
 */
const URL = process.env.PG_CONCURRENCY_URL;
const run = URL ? describe : describe.skip;

const ROLES_SQL = `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;`;

type Result = { ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string };
let admin: Client;
let owner: Client;
let pool: Pool;
let dbName = '';

/** One transaction as an authenticated user, like a PostgREST request. */
async function call(sub: string, sql: string): Promise<Result> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE authenticated');
    await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [sub]);
    const r = await c.query(sql);
    await c.query('COMMIT');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    return { ok: false, error: (e as Error).message };
  } finally {
    c.release();
  }
}
const val = async (sql: string) => Object.values((await owner.query(sql)).rows[0] ?? {})[0];
const all = (rs: Result[]) => rs.filter((r): r is Extract<Result, { ok: true }> => r.ok);
const failed = (rs: Result[]) => rs.filter((r): r is Extract<Result, { ok: false }> => !r.ok);

const ITEM_COUNT = 10;
let ITEMS: number[] = [];

run('concurrent finance operations (real PostgreSQL)', () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: URL });
    await admin.connect();
    await admin.query(ROLES_SQL);
    dbName = `sims_conc_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${dbName}`);
    const u = new globalThis.URL(URL as string);
    u.pathname = `/${dbName}`;
    owner = new Client({ connectionString: u.toString() });
    await owner.connect();
    const runner: SqlRunner = { exec: (sql) => owner.query(sql), query: (sql, params) => owner.query(sql, params as unknown[]) as never };
    await buildWorld(runner, { stubSql: SUPABASE_STUB.replace(/CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;/, '') });
    await fkSwitch(false, runner);
    pool = new Pool({ connectionString: u.toString(), max: 16 });
    await owner.query(`INSERT INTO student_financial_account (student_account_id, student_id, account_number) VALUES (1, 1, 'ACC1')`);
    // one assessment with ten items of 300
    const items = JSON.stringify(Array.from({ length: ITEM_COUNT }, (_, i) => ({ fee_type_id: 1, description: `Item ${i + 1}`, original_amount: 300 })));
    const created = await call(U.finance1, `select public.fin_create_fee_assessment('FA-C', 1, 1, 'ACADEMIC', '2025-01-01', '2025-03-01', '${items}'::jsonb) id`);
    if (!created.ok) throw new Error(created.error);
    ITEMS = (await owner.query('select assessment_item_id from student_fee_assessment_item order by 1')).rows.map((r) => Number(r.assessment_item_id));
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await owner?.end();
    if (dbName) await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('the same payment number sent ten times at once records exactly one payment and every caller gets its id', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => call(U.finance1, "select public.fin_record_payment('CONC-SAME', 1, 1, 500) id")));
    expect(failed(rs)).toEqual([]);
    expect(new Set(all(rs).map((r) => String(r.rows[0]?.id))).size).toBe(1);
    expect(Number(await val("select count(*) from payment_transaction where transaction_number = 'CONC-SAME'"))).toBe(1);
    expect(Number(await val("select count(*) from fee_activity_audit where action_code = 'PAYMENT_RECORDED'"))).toBe(1);
  });

  it('ten different payments at once all succeed with their own rows and audit entries', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => call(U.finance1, `select public.fin_record_payment('CONC-P${i}', 1, 1, 100) id`)));
    expect(failed(rs)).toEqual([]);
    expect(Number(await val("select count(*) from payment_transaction where transaction_number like 'CONC-P%'"))).toBe(10);
    expect(Number(await val("select count(*) from fee_activity_audit where action_code = 'PAYMENT_RECORDED'"))).toBe(11);
  });

  it('one payment of 1000 cannot be over-allocated by ten parallel allocations of 300 (exactly three can win)', async () => {
    const pay = Number((all([await call(U.finance1, "select public.fin_record_payment('CONC-ALLOC', 1, 1, 1000) id")])[0]?.rows[0] as { id: string }).id);
    const rs = await Promise.all(ITEMS.map((item) => call(U.finance1, `select public.fin_allocate_payment(${pay}, ${item}, 300) id`)));
    expect(all(rs)).toHaveLength(3);
    expect(failed(rs)).toHaveLength(7);
    const allocated = Number(await val(`select coalesce(sum(allocated_amount), 0) from payment_allocation where payment_transaction_id = ${pay}`));
    expect(allocated).toBe(900);
    expect(Number(await val('select count(*) from student_fee_assessment_item where amount_paid < 0 or balance_amount < 0 or amount_paid > net_amount'))).toBe(0);
  });

  it('one fee item cannot be overpaid by ten payments racing for it (exactly one can win)', async () => {
    const item = ITEMS[9] as number; // untouched item of 300
    const pays: number[] = [];
    for (let i = 0; i < 10; i++) pays.push(Number((all([await call(U.finance1, `select public.fin_record_payment('CONC-RACE${i}', 1, 1, 300) id`)])[0]?.rows[0] as { id: string }).id));
    const before = Number(await val(`select amount_paid from student_fee_assessment_item where assessment_item_id = ${item}`));
    const rs = await Promise.all(pays.map((p) => call(U.finance1, `select public.fin_allocate_payment(${p}, ${item}, 300) id`)));
    const won = all(rs).length;
    expect(won).toBe(before === 0 ? 1 : 0);
    expect(failed(rs).length).toBe(10 - won);
    const row = (await owner.query(`select amount_paid, balance_amount, net_amount from student_fee_assessment_item where assessment_item_id = ${item}`)).rows[0];
    expect(Number(row?.amount_paid)).toBeLessThanOrEqual(Number(row?.net_amount));
    expect(Number(row?.balance_amount)).toBeGreaterThanOrEqual(0);
  });

  it('parallel refund processing cannot refund more than was approved (1000 approved, five refunds of 300 -> three succeed)', async () => {
    const pay = Number((all([await call(U.finance1, "select public.fin_record_payment('CONC-REF', 1, 1, 1000) id")])[0]?.rows[0] as { id: string }).id);
    const item = ITEMS[0] as number;
    // the payment must be allocated to something that can take it: use the remaining items' balances
    const spare = (await owner.query('select assessment_item_id, balance_amount from student_fee_assessment_item where balance_amount > 0 order by 1 limit 4')).rows;
    let left = 1000;
    for (const s of spare) {
      const take = Math.min(Number(s.balance_amount), left);
      if (take > 0) { await call(U.finance1, `select public.fin_allocate_payment(${pay}, ${s.assessment_item_id}, ${take}) id`); left -= take; }
    }
    expect(item).toBeGreaterThan(0);
    const req = Number((all([await call(U.finance1, `select public.fin_request_refund('RR-CONC', 1, ${pay}, 1000, 'test') id`)])[0]?.rows[0] as { id: string }).id);
    expect(all([await call(U.finance1, `select public.fin_decide_refund(${req}, true, 1000)`)])).toHaveLength(1);
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => call(U.finance1, `select public.fin_process_refund('RF-CONC-${i}', ${req}, 1, 300) id`)));
    const won = all(rs).length;
    expect(won).toBeLessThanOrEqual(3);
    expect(won).toBeGreaterThanOrEqual(1);
    const refunded = Number(await val(`select coalesce(sum(refund_amount), 0) from fee_refund where refund_request_id = ${req} and refund_status not in ('FAILED', 'CANCELLED')`));
    expect(refunded).toBe(300 * won);
    expect(refunded).toBeLessThanOrEqual(1000);
  });

  it('receipts issued in parallel get unique numbers, one per payment', async () => {
    const pays = (await owner.query("select payment_transaction_id from payment_transaction where transaction_number like 'CONC-P%' order by 1")).rows.map((r) => Number(r.payment_transaction_id));
    const rs = await Promise.all([...pays, ...pays].map((p) => call(U.finance1, `select public.fin_issue_receipt(${p}) id`))); // each payment twice at once
    expect(failed(rs)).toEqual([]);
    expect(Number(await val('select count(*) from fee_receipt'))).toBe(pays.length);
    expect(Number(await val('select count(distinct receipt_number) from fee_receipt'))).toBe(pays.length);
  });

  it('the same hold requested ten times at once leaves one active hold', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => call(U.finance1, "select public.fin_hold_place(1, 'RESULT', 'dues') id")));
    expect(failed(rs)).toEqual([]);
    expect(new Set(all(rs).map((r) => String(r.rows[0]?.id))).size).toBe(1);
    expect(Number(await val("select count(*) from student_financial_hold where hold_status = 'ACTIVE'"))).toBe(1);
  });

  it('mixed parallel work finishes without deadlocks and keeps the totals consistent', async () => {
    const pays: number[] = [];
    for (let i = 0; i < 6; i++) pays.push(Number((all([await call(U.finance1, `select public.fin_record_payment('CONC-MIX${i}', 1, 1, 50) id`)])[0]?.rows[0] as { id: string }).id));
    const rs = await Promise.all([
      ...pays.map((p) => call(U.finance1, `select public.fin_issue_receipt(${p}) id`)),
      ...pays.map((p, i) => call(U.finance1, `select public.fin_allocate_payment(${p}, ${ITEMS[1 + (i % 2)]}, 25) id`)),
      call(U.finance1, "select count(*) from public.fin_accounts()"),
    ]);
    expect(failed(rs).filter((f) => /deadlock/i.test(f.error))).toEqual([]);
    const bad = Number(await val('select count(*) from student_fee_assessment_item where amount_paid <> (select coalesce(sum(allocated_amount), 0) from payment_allocation a where a.assessment_item_id = student_fee_assessment_item.assessment_item_id)'));
    expect(bad).toBe(0);
  });
});
