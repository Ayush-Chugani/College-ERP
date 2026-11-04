import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, ids, role, U } from './world';

/**
 * RLS / identity tests against embedded Postgres with a stubbed Supabase environment:
 * auth.users, auth.uid() (reads request.jwt.claim.sub), roles anon/authenticated/service_role and Supabase's default privileges.
 * Real Supabase additionally applies PostgREST; that layer is not exercised here.
 */

beforeAll(createWorld, 180_000);

describe('anonymous and unmapped callers', () => {
  it('anon has no table access', async () => {
    await expect(as('anon', null, 'select * from document_type')).rejects.toThrow(/permission denied/i);
  });
  it('an authenticated JWT with no identity mapping sees nothing', async () => {
    expect(await asUser(U.unmapped, 'select 1 from document_type')).toHaveLength(0);
    expect(await asUser(U.unmapped, 'select 1 from student')).toHaveLength(0);
  });
  it('a DISABLED account sees nothing even with a valid mapping and role', async () => {
    expect(await asUser(U.disabled, 'select 1 from document_type')).toHaveLength(0);
    expect(await asUser(U.disabled, 'select 1 from student')).toHaveLength(0);
  });
  it('mapped active users can read reference data', async () => {
    expect((await asUser(U.student1, 'select 1 from document_type')).length).toBeGreaterThan(0);
  });
});

describe('student self-service (SELF scope is read-only)', () => {
  it('student sees only their own student row and enrolment', async () => {
    expect(await ids(U.student1, 'select student_id id from student')).toEqual([1]);
    expect(await ids(U.student1, 'select student_id id from student_programme_enrolment')).toEqual([1]);
  });
  it('student cannot modify their own student row (no direct SELF writes)', async () => {
    expect(await asUser(U.student1, "update student set first_name='Hacked' where student_id=1 returning student_id")).toHaveLength(0);
    await expect(asUser(U.student1, "insert into student (student_number, first_name, display_name) values ('X','X','X')")).rejects.toThrow(/row-level security/i);
  });
  it('student cannot read another student or any employee', async () => {
    expect(await ids(U.student1, 'select student_id id from student where student_id in (2,3)')).toEqual([]);
    expect(await ids(U.student1, 'select employee_id id from employee')).toEqual([]);
  });
});

describe('scope containment for staff', () => {
  it('institution-scoped registrar sees only their institution students', async () => {
    expect(await ids(U.registrar1, 'select student_id id from student')).toEqual([1, 2]);
    expect(await ids(U.registrar2, 'select student_id id from student')).toEqual([3]);
  });
  it('department-scoped faculty sees only that department students', async () => {
    expect(await ids(U.facultyD1, 'select student_id id from student')).toEqual([1]);
  });
  it('institution admins cannot see another institution employees', async () => {
    expect(await ids(U.registrar1, 'select employee_id id from employee')).toEqual([1]);
    expect(await ids(U.registrar2, 'select employee_id id from employee')).toEqual([2]);
  });
  it('a DENY override beats an ALLOW grant', async () => {
    expect(await ids(U.denied, 'select student_id id from student')).toEqual([]);
    expect(await ids(U.denied, 'select employee_id id from employee')).toEqual([1]); // DENY was only for STUDENT.ALL.READ
  });
  it('global super admin sees everything', async () => {
    expect(await ids(U.superAdmin, 'select student_id id from student')).toEqual([1, 2, 3]);
  });
  it('writes are checked against scope: faculty may write in own department only', async () => {
    // announcements are written through RPCs (migration 040); the scope check lives in announcement_save
    const save = (dept: number) => `select public.announcement_save(null, (select min(announcement_type_id) from announcement_type), ${dept}, 't', 'd', now(), null, 'ALL')`;
    await expect(asUser(U.facultyD1, save(2))).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.facultyD1, save(3))).rejects.toThrow(/Not authorised/);
    await asUser(U.facultyD1, save(1));
    await expect(asUser(U.facultyD1, "insert into announcement (announcement_type_id, title, description, publish_from, department_id) values (1,'t','d',now(),1)")).rejects.toThrow(/permission denied/i);
  });
  it('registrar cannot create a campus under another institution', async () => {
    await expect(asUser(U.registrar1, "insert into campus (institution_id, campus_code, campus_name) values (2,'X','X')")).rejects.toThrow(/row-level security/i);
  });
});

describe('financial and IAM tables have no direct client writes', () => {
  it('finance officer cannot write payments directly (RPC-only)', async () => {
    await expect(asUser(U.finance1, "insert into payment_transaction (transaction_number, student_account_id, transaction_date, payment_mode_id, amount, payment_status) values ('T',1,now(),1,10,'SUCCESS')")).rejects.toThrow(/permission denied/i);
  });
  it('no privilege escalation: nobody can write role assignments, overrides or identity links', async () => {
    await expect(asUser(U.registrar1, `insert into user_role_assignment (user_id, role_id, scope_type) values (2, ${role('SUPER_ADMIN')}, 'GLOBAL')`)).rejects.toThrow(/permission denied/i);
    await expect(asUser(U.registrar1, 'update user_role_assignment set is_primary = true')).rejects.toThrow(/permission denied/i);
    await expect(asUser(U.registrar1, 'select * from sims_private.auth_identity_map')).rejects.toThrow(/permission denied/i);
    await expect(asUser(U.registrar1, `select sims_private.link_auth_user('${U.registrar1}', 8)`)).rejects.toThrow(/permission denied/i);
  });
  it('users see only their own role assignments', async () => {
    expect(await ids(U.registrar1, 'select user_id id from user_role_assignment')).toEqual([2]);
    expect((await ids(U.superAdmin, 'select user_id id from user_role_assignment')).length).toBeGreaterThan(1);
  });
  it('password_hash is never readable by clients; own account row is', async () => {
    await expect(asUser(U.student1, 'select password_hash from user_account')).rejects.toThrow(/permission denied/i);
    expect(await ids(U.student1, 'select user_id id from user_account')).toEqual([1]);
  });
});

describe('my_context() RPC', () => {
  it('describes only the caller (student)', async () => {
    const [r] = await asUser<{ c: { user_id: number; student_id: number; roles: { role_code: string }[]; readable_modules: string[] } }>(U.student1, 'select public.my_context() c');
    expect(r?.c.user_id).toBe(1);
    expect(r?.c.student_id).toBe(1);
    expect(r?.c.roles.map((x) => x.role_code)).toEqual(['STUDENT']);
    expect(r?.c.readable_modules).toContain('STUDENT');
    expect(r?.c.readable_modules).not.toContain('IAM');
  });
  it('returns null for unmapped and disabled identities and is not callable by anon', async () => {
    expect((await asUser<{ c: unknown }>(U.unmapped, 'select public.my_context() c'))[0]?.c).toBeNull();
    expect((await asUser<{ c: unknown }>(U.disabled, 'select public.my_context() c'))[0]?.c).toBeNull();
    await expect(as('anon', null, 'select public.my_context()')).rejects.toThrow(/permission denied/i);
  });
});

describe('workflow guards (APPROVE / VERIFY / PUBLISH)', () => {
  // announcement writes are RPC-only since migration 040; the workflow is exercised through those RPCs
  const typeId = '(select min(announcement_type_id) from announcement_type)';
  const decide = (yes: boolean) => `select public.announcement_decide((select announcement_id from announcement where title='g'), ${yes})`;

  it('faculty may draft but not self-approve an announcement', async () => {
    await asUser(U.facultyD1, `select public.announcement_save(null, ${typeId}, 1, 'g', 'd', now(), null, 'ALL')`);
    await asUser(U.facultyD1, "select public.announcement_submit((select announcement_id from announcement where title='g'))");
    await expect(asUser(U.facultyD1, decide(true))).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.facultyD1, "update announcement set approval_status='APPROVED' where title='g'")).rejects.toThrow(/permission denied/i);
  });
  it('a holder of the APPROVE permission can approve; the author keeps editing rights only before approval', async () => {
    await asUser(U.registrar1, decide(true));
    expect(String((await db.query<{ s: string }>("select approval_status s from announcement where title='g'")).rows[0]?.s)).toBe('APPROVED');
    await expect(asUser(U.facultyD1, `select public.announcement_save((select announcement_id from announcement where title='g'), ${typeId}, 1, 'g', 'edited', now(), null, 'ALL')`)).rejects.toThrow(/cannot be edited/);
  });

  it('un-approving is not possible once a decision is made', async () => {
    await expect(asUser(U.registrar1, decide(false))).rejects.toThrow(/Only a PENDING/);
  });

  describe('employee_document verification and actor integrity', () => {
    beforeAll(async () => {
      await fkSwitch(false);
      await db.exec(`
        INSERT INTO employee_document (employee_document_id, employee_id, document_scope, employee_document_category_id, document_type_id, file_object_id, document_title)
          VALUES (1, 1, 'EMPLOYEE_GENERAL', 1, 1, 1, 'Doc');
        INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
          SELECT 4, permission_id, 'ALLOW', 'INSTITUTION', 1, 'test' FROM permission
          WHERE permission_code IN ('EMPLOYEE.EMPLOYEE_DOCUMENT.READ', 'EMPLOYEE.EMPLOYEE_DOCUMENT.UPDATE');`);
      await fkSwitch(true);
    });
    it('UPDATE without VERIFY cannot verify, but can edit other fields', async () => {
      await expect(asUser(U.finance1, "update employee_document set verification_status='VERIFIED' where employee_document_id=1")).rejects.toThrow(/Not authorised to VERIFY/);
      await expect(asUser(U.finance1, 'update employee_document set verified_at=now() where employee_document_id=1')).rejects.toThrow(/Not authorised to VERIFY/);
      expect(await asUser(U.finance1, "update employee_document set document_title='Renamed' where employee_document_id=1 returning employee_document_id")).toHaveLength(1);
    });
    it('with VERIFY granted, the verifier identity cannot be forged', async () => {
      await db.exec(`INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
        SELECT 4, permission_id, 'ALLOW', 'INSTITUTION', 1, 'test' FROM permission WHERE permission_code = 'EMPLOYEE.EMPLOYEE_DOCUMENT.VERIFY'`);
      await expect(asUser(U.finance1, "update employee_document set verification_status='VERIFIED', verified_by_user_id=1 where employee_document_id=1")).rejects.toThrow(/must be the acting user/);
      expect(await asUser(U.finance1, "update employee_document set verification_status='VERIFIED', verified_by_user_id=4, verified_at=now() where employee_document_id=1 returning employee_document_id")).toHaveLength(1);
    });
    it('another institution admin cannot verify (scope)', async () => {
      await expect(asUser(U.registrar2, "update employee_document set verification_status='REJECTED' where employee_document_id=1")).resolves.toHaveLength(0);
    });
  });

  it('privileged server paths (non end-user roles) are not blocked by the guard', async () => {
    await db.exec("update announcement set approval_status='ARCHIVED' where title='g'");
  });
});

describe('catalogue-level guarantees', () => {
  it('every public table has RLS enabled and at least one policy', async () => {
    const r = await db.query<{ t: string }>(
      "select c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and (not c.relrowsecurity or not exists (select 1 from pg_policy p where p.polrelid=c.oid))",
    );
    expect(r.rows.map((x) => x.t)).toEqual([]);
  });
  it('anon holds no privileges on any public table', async () => {
    const r = await db.query<{ n: number }>("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and grantee='anon'");
    expect(r.rows[0]?.n).toBe(0);
  });
  it('authenticated holds no write privileges on financial, IAM, audit tables', async () => {
    const r = await db.query<{ t: string }>(
      "select distinct table_name t from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE') and (table_name ~ '^(payment_|refund_|fee_|student_fee_)' or table_name in ('user_account','user_role_assignment','user_permission_override','role','role_permission','permission','login_audit','activity_audit','file_object'))",
    );
    expect(r.rows.map((x) => x.t)).toEqual([]);
  });
});
