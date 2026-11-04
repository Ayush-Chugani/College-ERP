/**
 * Performance run on a REAL PostgreSQL (R-PERF-6, R-PERF-8): loads the schema and migrations, generates realistic volumes, then times the queries a user waits for, as an RLS-restricted
 * `authenticated` user, with EXPLAIN (ANALYZE, BUFFERS). Writes docs/PERFORMANCE_REPORT.md.
 *   PG_PERF_URL=postgres://postgres@127.0.0.1:55432/postgres npx vite-node tools/perf/run.ts [--scale=1]
 * Numbers are from the machine that ran it (see the report header); they show relative cost and plan shape, not production latency.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { SUPABASE_STUB } from '../../tests/db/supabase-stub';
import { buildWorld, fkSwitch, U, type SqlRunner } from '../../tests/db/world';

const URL_ = process.env.PG_PERF_URL;
if (!URL_) throw new Error('Set PG_PERF_URL to a superuser connection string of a scratch server');
const TIMEOUT_MS = Number(process.env.PG_PERF_TIMEOUT_MS ?? 30000);
const KEEP = process.argv.includes('--keep');
const SKIP_QUERIES = process.argv.includes('--no-queries');
const scale = Number((process.argv.find((a) => a.startsWith('--scale=')) ?? '--scale=1').split('=')[1]);
const N = { students: 20000 * scale, employees: 2000 * scale, audit: 100000 * scale, activities: 20000 * scale, grievances: 3000 * scale, accounts: 5000 * scale, payments: 15000 * scale, logins: 50000 * scale };

const ROLES_SQL = `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;`;

type Q = { name: string; who: string; sub: string; sql: string };
const QUERIES: Q[] = [
  { name: 'my_context (every page load)', who: 'registrar', sub: U.registrar1, sql: 'select public.my_context()' },
  { name: 'Students list, page 1 (RLS per row)', who: 'registrar', sub: U.registrar1, sql: 'select student_id, student_number, display_name from student order by display_name limit 20' },
  { name: 'Students list, page 500', who: 'registrar', sub: U.registrar1, sql: 'select student_id, student_number, display_name from student order by display_name limit 20 offset 9980' },
  { name: 'Students search "ra" (substring)', who: 'registrar', sub: U.registrar1, sql: "select student_id, display_name from student where display_name ilike '%ra%' or student_number ilike '%ra%' order by display_name limit 20" },
  { name: 'Students count (list header)', who: 'registrar', sub: U.registrar1, sql: 'select count(*) from student' },
  { name: 'global_search "ra"', who: 'registrar', sub: U.registrar1, sql: "select * from public.global_search('ra', 8)" },
  { name: 'Student own record', who: 'student', sub: U.student1, sql: 'select * from student' },
  { name: 'my_notification_count', who: 'student', sub: U.student1, sql: 'select public.my_notification_count()' },
  { name: 'my_dashboard', who: 'student', sub: U.student1, sql: 'select public.my_dashboard()' },
  { name: 'student_activity_list (staff, page 1)', who: 'super admin', sub: U.superAdmin, sql: 'select * from public.student_activity_list(null, null, null, 20, 0)' },
  { name: 'student_activity_list (staff, search)', who: 'super admin', sub: U.superAdmin, sql: "select * from public.student_activity_list(null, 'hack', null, 20, 0)" },
  { name: 'Audit log, page 1', who: 'super admin', sub: U.superAdmin, sql: 'select * from public.audit_list(null, null, null, null, null, 25, 0)' },
  { name: 'Audit log, one module', who: 'super admin', sub: U.superAdmin, sql: "select * from public.audit_list('STUDENT', null, null, null, null, 25, 0)" },
  { name: 'Audit log, date range', who: 'super admin', sub: U.superAdmin, sql: "select * from public.audit_list(null, null, null, now() - interval '2 days', now(), 25, 0)" },
  { name: 'Sign-in log, page 1', who: 'super admin', sub: U.superAdmin, sql: 'select * from public.login_audit_list(null, null, null, null, 25, 0)' },
  { name: 'Sign-in log, failures for a name', who: 'super admin', sub: U.superAdmin, sql: "select * from public.login_audit_list('user42', false, null, null, 25, 0)" },
  { name: 'Users list', who: 'super admin', sub: U.superAdmin, sql: 'select * from public.iam_user_list(null, null, 20, 0)' },
  { name: 'Grievance list', who: 'super admin', sub: U.superAdmin, sql: 'select * from public.grievance_list(null, null, null, 20, 0)' },
  { name: 'Fee accounts list', who: 'finance', sub: U.finance1, sql: 'select * from public.fin_accounts(null, null, 20, 0)' },
  { name: 'Fee balance view', who: 'finance', sub: U.finance1, sql: 'select * from v_student_fee_balance limit 20' },
  { name: 'Enrolment dashboard', who: 'registrar', sub: U.registrar1, sql: 'select * from public.dash_enrolments()' },
  { name: 'Employees list', who: 'registrar', sub: U.registrar1, sql: 'select employee_id, display_name from employee order by display_name limit 20' },
];

async function main() {
  const admin = new Client({ connectionString: URL_ });
  await admin.connect();
  await admin.query(ROLES_SQL);
  const dbName = `sims_perf_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(URL_ as string);
  u.pathname = `/${dbName}`;
  const db = new Client({ connectionString: u.toString() });
  await db.connect();
  const runner: SqlRunner = { exec: (sql) => db.query(sql), query: (sql, params) => db.query(sql, params as unknown[]) as never };
  const t0 = Date.now();
  await buildWorld(runner, { stubSql: SUPABASE_STUB.replace(/CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;/, '') });
  await fkSwitch(false, runner);
  console.log(`schema ready in ${((Date.now() - t0) / 1000).toFixed(1)}s; generating data…`);
  const g = Date.now();
  await db.query(`
    INSERT INTO student (student_id, student_number, first_name, display_name)
      SELECT 100 + i, 'S' || lpad(i::text, 6, '0'), 'First' || i, (ARRAY['Ravi','Anita','Suresh','Meera','Karan','Divya','Arun','Lakshmi','Prakash','Sunita'])[1 + i % 10] || ' ' || (ARRAY['Kumar','Rao','Patil','Naik','Hegde','Shetty','Gowda','Joshi'])[1 + i % 8] || ' ' || i
      FROM generate_series(1, ${N.students}) i;
    INSERT INTO student_programme_enrolment (student_id, programme_id, curriculum_scheme_id, admission_academic_year_id, admission_date, admission_semester_id)
      SELECT 100 + i, 1 + (i % 3), 1, 1, '2024-08-01', 1 FROM generate_series(1, ${N.students}) i;
    INSERT INTO employee (employee_id, institution_id, employment_source_id, employee_number, first_name, display_name, joining_date, employment_type)
      SELECT 100 + i, 1 + i % 2, 1, 'E' || lpad(i::text, 5, '0'), 'Emp', 'Employee ' || i, '2020-01-01', 'REGULAR' FROM generate_series(1, ${N.employees}) i;
    INSERT INTO student_activity_type (student_activity_type_id, type_code, type_name, activity_group) VALUES (900, 'P_T', 'Perf type', 'OTHER');
    INSERT INTO student_activity (student_id, student_activity_type_id, institution_id, department_id, programme_id, activity_title, verification_status_id, approval_status_id)
      SELECT 100 + (i % ${N.students}) + 1, 900, 1, 1, 1 + (i % 3), CASE WHEN i % 7 = 0 THEN 'Hackathon ' ELSE 'Event ' END || i, (select verification_status_id from verification_status limit 1), (select approval_status_id from approval_status limit 1)
      FROM generate_series(1, ${N.activities}) i;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, activity_at)
      SELECT 2, (ARRAY['STUDENT','FEES','IAM','GRIEVANCE','STAFF_PROFILE'])[1 + i % 5], (ARRAY['INSERT','UPDATE','DELETE'])[1 + i % 3], 'student', i::text, now() - (i || ' seconds')::interval * 5
      FROM generate_series(1, ${N.audit}) i;
    INSERT INTO login_audit (user_id, username_attempted, was_successful, login_at, failure_reason)
      SELECT CASE WHEN i % 3 = 0 THEN 2 END, 'user' || (i % 500), i % 3 = 0, now() - (i || ' seconds')::interval * 7, CASE WHEN i % 3 = 0 THEN NULL ELSE 'INVALID_CREDENTIALS' END FROM generate_series(1, ${N.logins}) i;
    INSERT INTO grievance_category (grievance_category_id, category_code, category_name, is_active) VALUES (1, 'FAC', 'Facilities', true);
    INSERT INTO grievance (grievance_number, student_id, grievance_category_id, subject, description, status, priority)
      SELECT 'GRV-2026-' || lpad(i::text, 6, '0'), 100 + (i % ${N.students}) + 1, 1, 'Subject ' || i, 'Text', (ARRAY['SUBMITTED','ASSIGNED','RESOLVED'])[1 + i % 3], 'NORMAL' FROM generate_series(1, ${N.grievances}) i;
    INSERT INTO student_financial_account (student_account_id, student_id, account_number)
      SELECT 100 + i, 100 + i, 'ACC' || lpad(i::text, 6, '0') FROM generate_series(1, ${N.accounts}) i;
    INSERT INTO payment_transaction (transaction_number, student_account_id, transaction_date, payment_mode_id, amount, payment_status)
      SELECT 'PT' || i, 100 + 1 + (i % ${N.accounts}), now() - (i || ' minutes')::interval, 1, 100 + i % 900, 'SUCCESS' FROM generate_series(1, ${N.payments}) i;
  `);
  await fkSwitch(true, runner);
  await db.query('ANALYZE');
  console.log(`data generated in ${((Date.now() - g) / 1000).toFixed(1)}s`);

  if (SKIP_QUERIES) { console.log(`database kept: ${dbName}`); await db.end(); await admin.end(); return; }
  const timeIt = async (q: Q) => {
    const runs: number[] = [];
    let plan: Record<string, unknown> | null = null;
    for (let i = 0; i < 5; i++) {
      await db.query('BEGIN');
      try {
        await db.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
        await db.query('SET LOCAL ROLE authenticated');
        await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [q.sub]);
        const r = await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}`);
        const j = (r.rows[0] as Record<string, unknown>)['QUERY PLAN'] as Record<string, unknown>[];
        runs.push(Number(j[0]?.['Execution Time']));
        plan = j[0] ?? null;
      } finally {
        await db.query('ROLLBACK');
      }
    }
    runs.sort((a, b) => a - b);
    const seq = new Set<string>();
    const walk = (n: Record<string, unknown> | undefined) => {
      if (!n) return;
      if (n['Node Type'] === 'Seq Scan' && Number(n['Actual Rows']) * Number(n['Actual Loops'] ?? 1) + Number(n['Rows Removed by Filter'] ?? 0) > 5000) seq.add(String(n['Relation Name']));
      for (const c of (n['Plans'] as Record<string, unknown>[] | undefined) ?? []) walk(c);
    };
    walk((plan?.['Plan'] as Record<string, unknown>) ?? undefined);
    return { median: runs[2] ?? 0, max: runs[4] ?? 0, seq: [...seq].sort() };
  };
  const results: (Q & { median: number; max: number; seq: string[] })[] = [];
  for (const q of QUERIES) {
    try { results.push({ ...q, ...(await timeIt(q)) }); } catch (e) { results.push({ ...q, median: -1, max: -1, seq: [`ERROR: ${(e as Error).message.slice(0, 80)}`] }); }
    const last = results[results.length - 1];
    console.log(`${last?.median !== undefined && last.median >= 0 ? last.median.toFixed(1).padStart(9) + ' ms' : '    failed   '}  ${q.name}${last?.seq.length ? '   [' + last.seq.join(',') + ']' : ''}`);
  }
  const counts = (await db.query(`select (select count(*) from student) students, (select count(*) from employee) employees, (select count(*) from activity_audit) audit, (select count(*) from login_audit) logins, (select count(*) from student_activity) activities, (select count(*) from payment_transaction) payments`)).rows[0] as Record<string, string>;
  const ver = (await db.query('select version()')).rows[0] as { version: string };
  fs.writeFileSync(path.resolve(process.cwd(), 'tools/perf/last-run.json'), JSON.stringify({ at: new Date().toISOString(), version: ver.version, counts, results }, null, 2));
  console.table(results.map((r) => ({ query: r.name, who: r.who, median_ms: r.median.toFixed(1), max_ms: r.max.toFixed(1), big_seq_scans: r.seq.join(',') })));
  await db.end();
  if (KEEP) console.log(`database kept: ${dbName}`);
  else await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
