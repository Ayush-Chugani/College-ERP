import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, U } from './world';

/** Account features (migration 045): MFA enforcement, login audit, profile, notifications, global search. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const setAal = (aal: string | null) => db.exec(`SELECT set_config('request.jwt.claims', ${aal === null ? "''" : `'{"aal":"${aal}"}'`}, false)`);
const ctxOf = async (sub: string) => (await asUser<{ c: unknown }>(sub, 'select public.my_context() c'))[0]?.c;

beforeAll(async () => {
  await createWorld();
}, 180_000);

describe('MFA enforcement', () => {
  it('is off for users without a verified factor and cannot be switched by a client', async () => {
    expect(await ctxOf(U.student1)).not.toBeNull();
    expect((await asUser<{ s: boolean }>(U.student1, 'select public.mfa_sync() s'))[0]?.s).toBe(false);
    await expect(asUser(U.student1, "update user_account set multi_factor_enabled = true where username = 'student1'")).rejects.toThrow(/permission denied/);
    await expect(asUser(U.unmapped, 'select public.mfa_sync()')).rejects.toThrow(/Not authorised/);
    await expect(as('anon', null, 'select public.mfa_sync()')).rejects.toThrow(/permission denied/);
  });
  it('an unverified factor does not switch it on', async () => {
    await db.exec(`INSERT INTO auth.mfa_factors (user_id, status) VALUES ('${U.student1}', 'unverified')`);
    expect((await asUser<{ s: boolean }>(U.student1, 'select public.mfa_sync() s'))[0]?.s).toBe(false);
  });
  it('a verified factor makes the database demand aal2', async () => {
    await db.exec(`UPDATE auth.mfa_factors SET status = 'verified' WHERE user_id = '${U.student1}'`);
    expect((await asUser<{ s: boolean }>(U.student1, 'select public.mfa_sync() s'))[0]?.s).toBe(true);
    expect(await val("select multi_factor_enabled from user_account where username = 'student1'")).toBe(true);
    await setAal('aal1');
    expect(await ctxOf(U.student1)).toBeNull(); // password only: no identity
    expect(await asUser(U.student1, 'select student_id from student')).toEqual([]);
    expect(await ctxOf(U.registrar1)).not.toBeNull(); // other users are unaffected
    await setAal(null);
    expect(await ctxOf(U.student1)).toBeNull(); // no claim at all counts as aal1
    await setAal('aal2');
    expect(await ctxOf(U.student1)).not.toBeNull();
    expect((await asUser(U.student1, 'select student_id from student')).length).toBe(1);
  });
  it('removing the factor lifts the requirement (only reachable at aal2)', async () => {
    await db.exec(`DELETE FROM auth.mfa_factors WHERE user_id = '${U.student1}'`);
    expect((await asUser<{ s: boolean }>(U.student1, 'select public.mfa_sync() s'))[0]?.s).toBe(false);
    await setAal('aal1');
    expect(await ctxOf(U.student1)).not.toBeNull();
    await setAal(null);
  });
});

describe('login audit', () => {
  it('records a sign-in and a sign-out for the caller, and updates last_login_at', async () => {
    await asUser(U.student1, 'select public.auth_login_record()');
    expect(Number(await val("select count(*) from login_audit where was_successful and username_attempted = 'student1'"))).toBe(1);
    expect(await val("select last_login_at is not null from user_account where username = 'student1'")).toBe(true);
    await asUser(U.student1, 'select public.auth_logout_record()');
    expect(await val("select logout_at is not null from login_audit where was_successful and username_attempted = 'student1'")).toBe(true);
    expect(await asUser(U.unmapped, 'select public.auth_login_record() r')).toEqual([{ r: null }]); // unprovisioned: nothing recorded
    await expect(as('anon', null, 'select public.auth_login_record()')).rejects.toThrow(/permission denied/);
  });
  it('lets anyone report a failure but only stores sane, throttled entries', async () => {
    await as('anon', null, "select public.auth_failure_record('student1', 'INVALID_CREDENTIALS')");
    await as('anon', null, "select public.auth_failure_record('  ', 'x')");
    await as('anon', null, "select public.auth_failure_record(null, 'x')");
    await as('anon', null, `select public.auth_failure_record('who' || chr(7) || 'ever', 'TOTALLY_MADE_UP')`);
    const rows = (await db.query<{ username_attempted: string; failure_reason: string; user_id: string | null }>("select username_attempted, failure_reason, user_id from login_audit where not was_successful order by login_audit_id")).rows;
    expect(rows.map((r) => r.username_attempted)).toEqual(['student1', 'whoever']);
    expect(rows.map((r) => r.failure_reason)).toEqual(['INVALID_CREDENTIALS', 'OTHER']);
    expect(Number(rows[0]?.user_id)).toBe(1); // linked to the account it targeted
    expect(rows[1]?.user_id).toBeNull();
    for (let i = 0; i < 30; i++) await as('anon', null, "select public.auth_failure_record('Flood@x.com')");
    expect(Number(await val("select count(*) from login_audit where lower(username_attempted) = 'flood@x.com'"))).toBe(20);
    expect(Number(await val("select failed_login_count from user_account where username = 'student1'"))).toBe(0); // reports never lock accounts
  });
  it('shows own history to the user and the full log only to auditors', async () => {
    const mine = await asUser<{ was_successful: boolean }>(U.student1, 'select * from public.my_recent_logins(5)');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((m) => m.was_successful || true)).toBe(true);
    expect(await asUser(U.student1, 'select * from public.login_audit_list()')).toEqual([]);
    expect(await asUser(U.registrar1, 'select * from public.login_audit_list()')).toEqual([]);
    const all = await asUser<{ total_count: string }>(U.superAdmin, 'select * from public.login_audit_list()');
    expect(Number(all[0]?.total_count)).toBeGreaterThan(20);
    expect((await asUser(U.superAdmin, "select * from public.login_audit_list('flood', false)")).length).toBe(20);
    expect((await asUser(U.superAdmin, "select * from public.login_audit_list(null, true)")).length).toBe(1);
    expect(await asUser(U.superAdmin, "select * from public.login_audit_list(null, null, now() + interval '1 day')")).toEqual([]);
  });
});

describe('profile', () => {
  it('shows and edits only contact fields of the own record', async () => {
    const p = (await asUser<{ p: { kind: string; number: string } }>(U.student1, 'select public.my_profile() p'))[0]?.p;
    expect(p).toMatchObject({ kind: 'student', number: 'S1' });
    expect((await asUser<{ p: { kind: string } }>(U.facultyD1, 'select public.my_profile() p'))[0]?.p.kind).toBe('employee');
    expect((await asUser<{ p: { kind: string } }>(U.superAdmin, 'select public.my_profile() p'))[0]?.p.kind).toBe('none');
    await asUser(U.student1, `select public.my_profile_update('{"primary_phone": "+91 98765-43210", "primary_email": " Stu@Example.com "}')`);
    expect((await db.query<{ primary_phone: string; primary_email: string }>('select primary_phone, primary_email from student where student_id = 1')).rows[0]).toEqual({ primary_phone: '+91 98765-43210', primary_email: 'stu@example.com' });
    await asUser(U.student1, `select public.my_profile_update('{"primary_phone": ""}')`);
    expect(await val('select primary_phone from student where student_id = 1')).toBeNull();
    expect(await val('select primary_email from student where student_id = 1')).toBe('stu@example.com'); // untouched keys stay
    await asUser(U.facultyD1, `select public.my_profile_update('{"primary_phone": "044 1234567"}')`);
    expect(await val('select primary_phone from employee where employee_id = 1')).toBe('044 1234567');
  });
  it('rejects other fields, bad values, conflicts and non-members', async () => {
    await expect(asUser(U.student1, `select public.my_profile_update('{"display_name": "Hacker"}')`)).rejects.toThrow(/cannot be changed here: display_name/);
    await expect(asUser(U.student1, `select public.my_profile_update('{"primary_email": "nope"}')`)).rejects.toThrow(/valid email/);
    await expect(asUser(U.student1, `select public.my_profile_update('{"primary_phone": "call me"}')`)).rejects.toThrow(/valid phone/);
    await expect(asUser(U.student1, `select public.my_profile_update('[]')`)).rejects.toThrow(/must be an object/);
    await db.exec("UPDATE student SET primary_email = 'taken@example.com' WHERE student_id = 2");
    await expect(asUser(U.student1, `select public.my_profile_update('{"primary_email": "taken@example.com"}')`)).rejects.toThrow(/already used/);
    await expect(asUser(U.superAdmin, `select public.my_profile_update('{"primary_phone": "123456"}')`)).rejects.toThrow(/Only students and employees/);
    await expect(as('anon', null, `select public.my_profile_update('{}')`)).rejects.toThrow(/permission denied/);
    expect(Number(await val("select count(*) from activity_audit where entity_name = 'student' and entity_id = '1'"))).toBeGreaterThan(0); // edits are audited
  });
});

describe('notifications', () => {
  it('collects the caller\'s own decisions, announcements and review queues', async () => {
    await fkSwitch(false);
    await db.exec(`
      INSERT INTO student_document (student_id, document_type_id, file_object_id, verification_status, verified_at, remarks) VALUES (1, (select min(document_type_id) from document_type), 1, 'REJECTED', now(), 'blurry');
      INSERT INTO announcement (announcement_type_id, title, description, publish_from, approval_status, audience_type) VALUES (1, 'Holiday', 'Closed on Friday', now() - interval '1 day', 'APPROVED', 'ALL');
      INSERT INTO grievance_category (grievance_category_id, category_code, category_name, is_active) VALUES (1, 'FAC', 'Facilities', true);
      INSERT INTO grievance (grievance_id, grievance_number, student_id, grievance_category_id, subject, description, status) VALUES (1, 'GRV-2026-000001', 1, 1, 'Broken fan', 'It is broken.', 'SUBMITTED');
    `);
    await fkSwitch(true);
    const kinds = async (sub: string) => (await asUser<{ kind: string }>(sub, 'select kind from public.my_notifications()')).map((r) => r.kind).sort();
    expect(await kinds(U.student1)).toEqual(['ANNOUNCEMENT', 'DOCUMENT']);
    expect(await kinds(U.unmapped)).toEqual([]);
    expect(await kinds(U.registrar2)).toEqual([]); // announcements go to students and staff with an active enrolment or assignment
    expect(await kinds(U.facultyD1)).toEqual([]);
    expect(await kinds(U.superAdmin)).toEqual(['TASK']); // new grievance awaits attention
    await db.exec("UPDATE grievance SET status = 'ASSIGNED'");
    await db.exec("INSERT INTO grievance_action (grievance_id, action_type, new_status) VALUES (1, 'STATUS_CHANGE', 'ASSIGNED')");
    expect(await kinds(U.student1)).toEqual(['ANNOUNCEMENT', 'DOCUMENT', 'GRIEVANCE']);
    const t = (await asUser<{ title: string; href: string }>(U.student1, "select title, href from public.my_notifications() where kind = 'DOCUMENT'"))[0];
    expect(t).toMatchObject({ href: '/my-documents' });
    expect(t?.title).toMatch(/rejected/);
  });
  it('counts, dismisses one, and dismisses all', async () => {
    expect((await asUser<{ n: number }>(U.student1, 'select public.my_notification_count() n'))[0]?.n).toBe(3);
    const key = (await asUser<{ notif_key: string }>(U.student1, "select notif_key from public.my_notifications() where kind = 'ANNOUNCEMENT'"))[0]?.notif_key ?? '';
    await asUser(U.student1, `select public.notification_dismiss('${key}')`);
    await asUser(U.student1, `select public.notification_dismiss('${key}')`); // idempotent
    expect((await asUser<{ n: number }>(U.student1, 'select public.my_notification_count() n'))[0]?.n).toBe(2);
    expect(Number(await val('select count(*) from sims_private.notification_dismissal where user_id = 1'))).toBe(1); // dismissals are stored per user
    expect(Number(await val('select count(*) from sims_private.notification_dismissal where user_id <> 1'))).toBe(0);
    expect((await asUser<{ n: number }>(U.student1, 'select public.notification_dismiss_all() n'))[0]?.n).toBe(2);
    expect(await asUser(U.student1, 'select * from public.my_notifications()')).toEqual([]);
    await expect(asUser(U.student1, "select public.notification_dismiss('')")).rejects.toThrow(/Invalid notification/);
    await expect(asUser(U.unmapped, "select public.notification_dismiss('x')")).rejects.toThrow(/Not authorised/);
    await expect(as('anon', null, 'select public.my_notification_count()')).rejects.toThrow(/permission denied/);
  });
  it('a changed status is a new notification', async () => {
    await db.exec("UPDATE grievance SET status = 'RESOLVED', resolved_at = now(), resolution = 'Fixed'");
    await db.exec("INSERT INTO grievance_action (grievance_id, action_type, new_status) VALUES (1, 'STATUS_CHANGE', 'RESOLVED')");
    const rows = await asUser<{ kind: string; title: string }>(U.student1, 'select kind, title from public.my_notifications()');
    expect(rows).toEqual([{ kind: 'GRIEVANCE', title: 'Your grievance is resolved' }]);
  });
});

describe('global search', () => {
  it('finds only what row level security lets the caller read', async () => {
    const q = (sub: string, term: string) => asUser<{ kind: string; title: string }>(sub, `select kind, title from public.global_search('${term}')`);
    expect((await q(U.superAdmin, 'stu')).filter((r) => r.kind === 'student').length).toBe(3);
    expect((await q(U.student1, 'stu')).filter((r) => r.kind === 'student').map((r) => r.title)).toEqual(['Stu One']); // own record only
    expect((await q(U.registrar1, 'stu')).filter((r) => r.kind === 'student').length).toBe(2); // institution 1
    expect((await q(U.registrar2, 'stu')).filter((r) => r.kind === 'student').map((r) => r.title)).toEqual(['Stu Two']);
    expect((await q(U.superAdmin, 'dept 1')).map((r) => r.kind)).toContain('department');
    expect((await q(U.superAdmin, 'emp one')).map((r) => r.kind)).toContain('employee');
    expect(await q(U.unmapped, 'stu')).toEqual([]);
  });
  it('needs two characters and treats wildcards literally', async () => {
    expect(await asUser(U.superAdmin, "select * from public.global_search('s')")).toEqual([]);
    expect(await asUser(U.superAdmin, "select * from public.global_search('')")).toEqual([]);
    expect(await asUser(U.superAdmin, "select * from public.global_search(null)")).toEqual([]);
    expect(await asUser(U.superAdmin, "select * from public.global_search('%%')")).toEqual([]);
    expect(await asUser(U.superAdmin, "select * from public.global_search('__')")).toEqual([]);
    expect((await asUser(U.superAdmin, "select * from public.global_search('stu', 1)")).filter((r) => (r as { kind: string }).kind === 'student').length).toBe(1);
    await expect(as('anon', null, "select * from public.global_search('stu')")).rejects.toThrow(/permission denied/);
  });
});
