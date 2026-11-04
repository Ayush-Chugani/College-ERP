import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { SUPABASE_STUB } from './supabase-stub';

/** Shared integration world: stubbed Supabase + all migrations + an org/people/role fixture. See rls.test.ts for what each user is. */
const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations');
export let db: PGlite;

export const U = {
  student1: '00000000-0000-0000-0000-000000000001',
  registrar1: '00000000-0000-0000-0000-000000000002',
  facultyD1: '00000000-0000-0000-0000-000000000003',
  finance1: '00000000-0000-0000-0000-000000000004',
  disabled: '00000000-0000-0000-0000-000000000005',
  unmapped: '00000000-0000-0000-0000-000000000006',
  denied: '00000000-0000-0000-0000-000000000007',
  superAdmin: '00000000-0000-0000-0000-000000000008',
  registrar2: '00000000-0000-0000-0000-000000000009',
};

export async function as<T = Record<string, unknown>>(role: 'authenticated' | 'anon', sub: string | null, sql: string): Promise<T[]> {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [sub ?? '']);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('RESET ROLE');
  }
}
export const asUser = <T = Record<string, unknown>>(sub: string | null, sql: string) => as<T>('authenticated', sub, sql);
export const ids = async (sub: string | null, sql: string) => (await asUser<{ id: number | string }>(sub, sql)).map((r) => Number(r.id)).sort((a, b) => a - b);

export async function fkSwitch(enable: boolean) {
  const { rows } = await db.query<{ t: string; n: string }>(
    "select c.relname t, g.tgname n from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and g.tgisinternal and g.tgconstraint<>0 and g.tgname like 'RI_ConstraintTrigger%'",
  );
  for (const r of rows) await db.exec(`ALTER TABLE public.${r.t} ${enable ? 'ENABLE' : 'DISABLE'} TRIGGER "${r.n}"`);
}

export const role = (code: string) => `(select role_id from role where role_code='${code}')`;

export async function createWorld() {
  db = new PGlite();
  // --- stub of the Supabase environment (before migrations, like a real project) ---
  await db.exec(SUPABASE_STUB);
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  }

  // --- fixtures (FK checks off; user triggers, unique/check constraints stay on) ---
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO institution (institution_id, university_id, institution_code, institution_name) VALUES (1,1,'I1','Inst 1'),(2,1,'I2','Inst 2');
    INSERT INTO campus (campus_id, institution_id, campus_code, campus_name) VALUES (1,1,'C1','Campus 1'),(2,2,'C2','Campus 2');
    INSERT INTO department (department_id, campus_id, department_code, department_name) VALUES (1,1,'D1','Dept 1'),(2,1,'D1B','Dept 1B'),(3,2,'D2','Dept 2');
    INSERT INTO programme (programme_id, department_id, programme_code, programme_name, programme_level, duration_semesters) VALUES
      (1,1,'P1','Prog 1','UG',8),(2,2,'P1B','Prog 1B','UG',8),(3,3,'P2','Prog 2','UG',8);
    INSERT INTO student (student_id, student_number, first_name, display_name) VALUES (1,'S1','Stu','Stu One'),(2,'S1B','Stu','Stu 1B'),(3,'S2','Stu','Stu Two');
    INSERT INTO student_programme_enrolment (student_id, programme_id, curriculum_scheme_id, admission_academic_year_id, admission_date, admission_semester_id) VALUES
      (1,1,1,1,'2024-08-01',1),(2,2,1,1,'2024-08-01',1),(3,3,1,1,'2024-08-01',1);
    INSERT INTO employee (employee_id, institution_id, employment_source_id, employee_number, first_name, display_name, joining_date, employment_type) VALUES
      (1,1,1,'E1','Emp','Emp One','2020-01-01','REGULAR'),(2,2,1,'E2','Emp','Emp Two','2020-01-01','REGULAR');
    INSERT INTO user_account (user_id, username, password_hash, account_status) VALUES
      (1,'student1','x','ACTIVE'),(2,'registrar1','x','ACTIVE'),(3,'facultyd1','x','ACTIVE'),(4,'finance1','x','ACTIVE'),
      (5,'disabled','x','DISABLED'),(7,'denied','x','ACTIVE'),(8,'superadmin','x','ACTIVE'),(9,'registrar2','x','ACTIVE');
    INSERT INTO student_user_account (student_id, user_id) VALUES (1,1);
    INSERT INTO employee_user_account (employee_id, user_id) VALUES (1,3);
    INSERT INTO user_role_assignment (user_id, role_id, scope_type) VALUES (1, ${role('STUDENT')}, 'SELF'), (8, ${role('SUPER_ADMIN')}, 'GLOBAL');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES
      (2, ${role('REGISTRAR')}, 'INSTITUTION', 1), (4, ${role('FINANCE_OFFICER')}, 'INSTITUTION', 1),
      (5, ${role('REGISTRAR')}, 'INSTITUTION', 1), (7, ${role('REGISTRAR')}, 'INSTITUTION', 1), (9, ${role('REGISTRAR')}, 'INSTITUTION', 2);
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, department_id) VALUES (3, ${role('FACULTY')}, 'DEPARTMENT', 1);
    INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
      VALUES (7, (select permission_id from permission where permission_code='STUDENT.ALL.READ'), 'DENY', 'INSTITUTION', 1, 'test deny');
    INSERT INTO announcement_type (announcement_type_id, type_code, type_name) VALUES (1,'GEN','General') ON CONFLICT DO NOTHING;
  `);
  await fkSwitch(true);
  // fixtures used explicit ids: move identity sequences past them, as migration 015 does for seed data
  await db.exec(fs.readFileSync(path.join(MIGRATIONS, '015_identity_sequence_resync.sql'), 'utf8'));
  for (const [i, sub] of [U.student1, U.registrar1, U.facultyD1, U.finance1, U.disabled, U.unmapped, U.denied, U.superAdmin, U.registrar2].entries()) {
    await db.exec(`INSERT INTO auth.users (id) VALUES ('${sub}')`);
    const uid = [1, 2, 3, 4, 5, null, 7, 8, 9][i];
    if (uid) await db.exec(`SELECT sims_private.link_auth_user('${sub}', ${uid}, 'test')`);
  }
}

