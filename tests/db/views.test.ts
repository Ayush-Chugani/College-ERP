import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createWorld, db, fkSwitch, U } from './world';

/** Result rows of the 10 views (R-TST-4): they resolve for the right users, return what the data says, and, being security invoker, show nobody anything their own row level security hides. */
const VIEWS = [
  'v_active_role_permission', 'v_active_user_role', 'v_effective_user_permission', 'v_employee_previous_experience', 'v_fee_collection_summary',
  'v_staff_activity_profile', 'v_staff_evidence_search', 'v_student_activity_evidence_search', 'v_student_activity_profile', 'v_student_fee_balance',
] as const;
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const rows = async (sub: string, sql: string) => asUser<Record<string, unknown>>(sub, sql);

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO university (university_id, university_code, university_name) VALUES (1, 'U1', 'Test University') ON CONFLICT DO NOTHING;
    INSERT INTO student_financial_account (student_account_id, student_id, account_number) VALUES (1, 1, 'ACC1'), (2, 3, 'ACC2');
    INSERT INTO student_activity_type (student_activity_type_id, type_code, type_name, activity_group) VALUES (900, 'V_T', 'View type', 'OTHER');
    INSERT INTO student_activity (student_id, student_activity_type_id, institution_id, department_id, programme_id, activity_title, verification_status_id, approval_status_id)
      VALUES (1, 900, 1, 1, 1, 'Hackathon', (select verification_status_id from verification_status limit 1), (select approval_status_id from approval_status limit 1));
    INSERT INTO activity_type (activity_type_id, activity_type_code, activity_type_name, activity_group) VALUES (900, 'V_ST', 'View staff type', 'OTHER');
    INSERT INTO staff_activity (employee_id, activity_type_id, institution_id, campus_id, department_id, activity_title, verification_status_id, approval_status_id)
      VALUES (1, 900, 1, 1, 1, 'Seminar', (select verification_status_id from verification_status limit 1), (select approval_status_id from approval_status limit 1));
  `);
  await fkSwitch(true);
}, 180_000);

describe('every view resolves', () => {
  it('there are exactly the ten views, all created with security invoker', async () => {
    const found = (await db.query<{ viewname: string }>("select viewname from pg_views where schemaname = 'public' order by 1")).rows.map((r) => r.viewname);
    expect(found).toEqual([...VIEWS].sort());
    const invoker = (await db.query<{ relname: string }>("select c.relname from pg_class c where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace and 'security_invoker=true' = any (coalesce(c.reloptions, '{}'))")).rows.map((r) => r.relname);
    expect(invoker.sort()).toEqual([...VIEWS].sort());
  });
  it.each(VIEWS)('%s can be selected by an administrator and nobody outside the system sees rows', async (v) => {
    await expect(asUser(U.superAdmin, `select * from ${v} limit 1`)).resolves.toBeDefined();
    expect(await rows(U.unmapped, `select * from ${v}`)).toEqual([]);
    expect(await rows(U.disabled, `select * from ${v}`)).toEqual([]);
  });
});

describe('what the views return', () => {
  it('the role and permission views reflect the assignments, and only for those who may read the role tables', async () => {
    const admin = await rows(U.superAdmin, "select user_id, role_code from v_active_user_role where role_code = 'REGISTRAR'");
    expect(admin.length).toBeGreaterThanOrEqual(3); // registrar1, registrar2 and the disabled registrar
    expect(new Set(admin.map((r) => Number(r.user_id)))).toEqual(new Set([2, 5, 7, 9].filter((id) => [2, 5, 7, 9].includes(id)) as number[]));
    expect((await rows(U.superAdmin, "select distinct permission_code from v_effective_user_permission where permission_code = 'STUDENT.ALL.READ'"))).toHaveLength(1);
    expect(Number(await val("select count(*) from v_active_role_permission where role_code = 'SUPER_ADMIN'"))).toBeGreaterThan(100);
    // the role tables are readable by IAM readers only, so a registrar sees none of it through the views (the identity helpers read them as the system)
    expect(await rows(U.registrar1, 'select * from v_active_user_role')).toEqual([]);
    expect(await rows(U.registrar1, 'select * from v_effective_user_permission')).toEqual([]);
  });
  it('v_student_fee_balance shows one row per account, to those who may read fees', async () => {
    expect((await rows(U.finance1, 'select account_number, total_outstanding from v_student_fee_balance')).map((r) => r.account_number)).toEqual(['ACC1']); // institution 1 only
    expect(await rows(U.student1, 'select * from v_student_fee_balance')).toEqual([]); // students hold no FEES permission (KI-41)
    expect(await rows(U.registrar2, 'select * from v_student_fee_balance')).toEqual([]);
    expect(Number(await val('select count(*) from v_student_fee_balance'))).toBe(2); // the owner role sees both
  });
  it('v_fee_collection_summary resolves for finance staff', async () => {
    await expect(rows(U.finance1, 'select * from v_fee_collection_summary')).resolves.toBeDefined();
  });
  it('the activity profile views follow the same scope as the tables', async () => {
    expect((await rows(U.superAdmin, 'select activity_title from v_student_activity_profile')).map((r) => r.activity_title)).toEqual(['Hackathon']);
    expect((await rows(U.student1, 'select activity_title from v_student_activity_profile')).map((r) => r.activity_title)).toEqual(['Hackathon']); // the student's own
    expect(await rows(U.registrar2, 'select * from v_student_activity_profile')).toEqual([]);
    expect((await rows(U.superAdmin, 'select activity_title, staff_name from v_staff_activity_profile')).map((r) => r.activity_title)).toEqual(['Seminar']);
    expect(await rows(U.facultyD1, 'select activity_title from v_staff_activity_profile')).toEqual([]); // department-scoped faculty hold no SELF grant: they reach their own records through the RPCs
    expect(await rows(U.registrar2, 'select * from v_staff_activity_profile')).toEqual([]);
    expect(await rows(U.student1, 'select * from v_staff_activity_profile')).toEqual([]);
  });
  it('the evidence search views and the previous-experience view are empty without evidence or experience', async () => {
    for (const v of ['v_staff_evidence_search', 'v_student_activity_evidence_search', 'v_employee_previous_experience']) expect(await rows(U.superAdmin, `select * from ${v}`)).toEqual([]);
  });
});
