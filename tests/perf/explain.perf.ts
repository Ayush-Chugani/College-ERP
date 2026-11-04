import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createWorld, db, fkSwitch, U } from '../db/world';

/**
 * Query-plan measurements on SYNTHETIC data in the embedded test database. Run with:  npx vitest run --config tests/perf/vitest.perf.config.ts
 * It writes tools/work/perf_results.json (consumed when writing docs/PERFORMANCE_REPORT.md). It never touches the live project.
 * Timings come from PostgreSQL compiled to WASM on a development machine: use them to compare plans, not as production latency.
 */
const N_STUDENTS = 20000;
const N_GRIEVANCES = 6000;

type Result = { name: string; sql: string; rows: number; planningMs: number; executionMs: number; seqScans: string[]; plan: string[] };
const results: Result[] = [];

async function explain(name: string, sub: string, sql: string): Promise<Result> {
  const rows = await asUser<{ 'QUERY PLAN': string }>(sub, `EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  const plan = rows.map((r) => r['QUERY PLAN']);
  const exec = Number(/Execution Time: ([0-9.]+) ms/.exec(plan.join('\n'))?.[1] ?? NaN);
  const planning = Number(/Planning Time: ([0-9.]+) ms/.exec(plan.join('\n'))?.[1] ?? NaN);
  const top = /rows=(\d+) loops=\d+/.exec(plan[0] ?? '');
  const seq = plan.filter((l) => /Seq Scan on/.test(l)).map((l) => /Seq Scan on (\S+)/.exec(l)?.[1] ?? '').filter(Boolean);
  const r = { name, sql, rows: Number(top?.[1] ?? 0), planningMs: planning, executionMs: exec, seqScans: [...new Set(seq)], plan };
  results.push(r);
  return r;
}

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO student (student_id, student_number, first_name, last_name, display_name)
      SELECT 1000 + g, 'P' || lpad(g::text, 6, '0'), 'First' || g, 'Last' || (g % 500), 'Perf Student ' || g || ' Last' || (g % 500) FROM generate_series(1, ${N_STUDENTS}) g;
    INSERT INTO student_programme_enrolment (student_id, programme_id, curriculum_scheme_id, admission_academic_year_id, admission_date, admission_semester_id, enrolment_status)
      SELECT 1000 + g, CASE WHEN g % 3 = 0 THEN 1 WHEN g % 3 = 1 THEN 2 ELSE 3 END, 1, 1, '2024-08-01', 1, CASE WHEN g % 10 = 0 THEN 'COMPLETED' ELSE 'ACTIVE' END FROM generate_series(1, ${N_STUDENTS}) g;
    INSERT INTO student_financial_account (student_account_id, student_id, account_number)
      SELECT 1000 + g, 1000 + g, 'ACC-P' || lpad(g::text, 6, '0') FROM generate_series(1, ${N_STUDENTS}) g;
    INSERT INTO student_fee_assessment (assessment_number, student_account_id, academic_year_id, assessment_type, assessment_date, gross_amount, net_payable_amount, amount_paid, balance_amount, due_date, assessment_status)
      SELECT 'PFA' || g, 1000 + (g % ${N_STUDENTS}) + 1, 1, 'ACADEMIC', '2025-01-01', 1000, 1000, 0, 1000, '2025-03-01', 'ASSESSED' FROM generate_series(1, ${N_STUDENTS * 2}) g;
    INSERT INTO payment_transaction (transaction_number, student_account_id, transaction_date, payment_mode_id, amount, payment_status)
      SELECT 'PPAY' || g, 1000 + (g % ${N_STUDENTS}) + 1, now() - (g % 150) * interval '1 day', (SELECT min(payment_mode_id) FROM payment_mode), 500, 'SUCCESS' FROM generate_series(1, ${N_STUDENTS * 2}) g;
    INSERT INTO grievance_category (grievance_category_id, category_code, category_name) VALUES (900, 'PERF', 'Perf');
    INSERT INTO grievance (grievance_number, student_id, grievance_category_id, subject, description, priority, status)
      SELECT 'PGRV' || g, 1000 + (g % ${N_STUDENTS}) + 1, 900, 'Subject ' || g, 'Description', CASE WHEN g % 7 = 0 THEN 'HIGH' ELSE 'NORMAL' END, 'SUBMITTED' FROM generate_series(1, ${N_GRIEVANCES}) g;
    ANALYZE;
  `);
}, 600_000);

describe('query plans on synthetic data', () => {
  it('students list: exact count, first page, deep page, search', async () => {
    await explain('Students: exact count (list header)', U.registrar1, 'select count(student_id) from student');
    await explain('Students: first page ordered by student number', U.registrar1, 'select student_id, student_number, display_name from student order by student_number limit 20');
    await explain('Students: deep page (offset 10000)', U.registrar1, 'select student_id, student_number, display_name from student order by student_number limit 20 offset 10000');
    await explain('Students: search on name', U.registrar1, "select student_id, student_number, display_name from student where display_name ilike '%Last42%' order by display_name limit 20");
    await explain('Students: one student by number', U.registrar1, "select student_id from student where student_number = 'P010000'");
    expect(results.length).toBe(5);
  });
  it('dashboard aggregates', async () => {
    await explain('Dashboard: enrolments by programme and status', U.registrar1, 'select * from public.dash_enrolments()');
    await explain('Dashboard: fee collection, 6 months', U.finance1, 'select * from public.dash_fee_collection(6)');
    await explain('Dashboard: fee outstanding', U.finance1, 'select * from public.dash_fee_outstanding()');
  });
  it('finance and grievance helpers', async () => {
    await explain('Finance: account list page 1', U.finance1, 'select * from public.fin_accounts(null, null, 20, 0)');
    await explain('Finance: account search by student number', U.finance1, "select * from public.fin_accounts('P010000', null, 20, 0)");
    await explain('Grievances: staff list (priority order)', U.registrar1, 'select * from public.grievance_list(null, null, null, 20, 0)');
  });
  it('writes results', async () => {
    fs.mkdirSync('tools/work', { recursive: true });
    fs.writeFileSync('tools/work/perf_results.json', JSON.stringify({ students: N_STUDENTS, grievances: N_GRIEVANCES, results }, null, 1));
    expect(results.every((r) => Number.isFinite(r.executionMs))).toBe(true);
  });
});
