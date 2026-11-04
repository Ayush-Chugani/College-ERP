import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, role, U } from './world';

/** Competencies, document access rules and student service requests (migration 063). HR1/HR2 are HR administrators of institution 1; facultyD1 is employee 1; student1 is student 1. */
const HR1 = '00000000-0000-0000-0000-0000000000c1';
const HR2 = '00000000-0000-0000-0000-0000000000c2';
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const put = (key: string) => db.exec(`insert into storage.objects (bucket_id, name, metadata) values ('sims-documents', '${key}', '{"size": 500}')`);
let COURSE = 0;
let TERM = 0;

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO user_account (user_id, username, password_hash) VALUES (21, 'hr1', 'x'), (22, 'hr2', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES (21, ${role('HR_ADMIN')}, 'INSTITUTION', 1), (22, ${role('HR_ADMIN')}, 'INSTITUTION', 1);
    INSERT INTO auth.users (id) VALUES ('${HR1}'), ('${HR2}');
    SELECT sims_private.link_auth_user('${HR1}', 21, 'test');
    SELECT sims_private.link_auth_user('${HR2}', 22, 'test');
    INSERT INTO course_catalog (course_id, owning_department_id, course_category_id, course_code, course_title, course_type) VALUES (700, 1, 1, 'CS101', 'Intro to computing', 'THEORY');
    INSERT INTO academic_year (academic_year_id, year_code, start_date, end_date) VALUES (1, '2025-26', '2025-04-01', '2026-03-31') ON CONFLICT DO NOTHING;
    INSERT INTO academic_term (academic_term_id, academic_year_id, term_code, term_name, term_type, start_date, end_date) VALUES (800, 1, 'ODD25', 'Odd semester 2025', 'ODD', '2025-08-01', '2025-12-31');
    INSERT INTO programme_term_offering (programme_term_offering_id, academic_term_id, programme_id, curriculum_scheme_id, semester_id) VALUES (900, 800, 1, 1, 1);
    INSERT INTO student_term_registration (enrolment_id, programme_term_offering_id, registration_date, registration_status) VALUES (1, 900, '2025-08-01', 'REGISTERED');
    INSERT INTO document_type (document_type_id, document_code, document_name, is_active) VALUES (1, 'ID', 'ID', true) ON CONFLICT DO NOTHING;
    INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('sims-documents', 'employee/1/r-letter.pdf', '{"size": 500}');
  `);
  COURSE = 700;
  TERM = 800;
}, 180_000);

describe('competencies', () => {
  const save = (sub: string, level = 'ADVANCED', from: string | null = null, to: string | null = null) =>
    asUser(sub, `select public.emp_competency_save(1, ${COURSE}, '${level}', ${from ? `'${from}'` : 'null'}, ${to ? `'${to}'` : 'null'})`);
  it('HR maintains them; the employee only reads', async () => {
    await expect(as('anon', null, `select public.emp_competency_list(1)`)).rejects.toThrow(/permission denied/);
    await expect(save(U.facultyD1)).rejects.toThrow(/Not authorised/);
    await expect(save(U.student1)).rejects.toThrow(/Not authorised/);
    await expect(save(U.registrar2)).rejects.toThrow(/Not authorised/);
    await expect(save(HR1, 'GURU')).rejects.toThrow(/Choose a level/);
    await expect(save(HR1, 'EXPERT', '2026-01-01', '2025-01-01')).rejects.toThrow(/cannot be before/);
    await expect(asUser(HR1, `select public.emp_competency_save(1, 999, 'EXPERT')`)).rejects.toThrow(/Unknown course/);
    await save(HR1);
    await save(HR2, 'EXPERT'); // update
    const l = (await asUser<{ l: { rows: { course_code: string; level: string; active: boolean }[]; can_edit: boolean } }>(U.facultyD1, 'select public.emp_competency_list(1) l'))[0]?.l;
    expect([l?.rows.length, l?.rows[0]?.course_code, l?.rows[0]?.level, l?.can_edit]).toEqual([1, 'CS101', 'EXPERT', false]);
    await expect(asUser(U.student1, 'select public.emp_competency_list(1)')).rejects.toThrow(/Not authorised/);
    expect(Number(await val("select count(*) from activity_audit where entity_name = 'employee_competency'"))).toBe(2);
  });
  it('deleting is audited and needs DELETE', async () => {
    await expect(asUser(U.facultyD1, `select public.emp_competency_delete(1, ${COURSE})`)).rejects.toThrow(/Not authorised/);
    await asUser(HR1, `select public.emp_competency_delete(1, ${COURSE})`);
    await expect(asUser(HR1, `select public.emp_competency_delete(1, ${COURSE})`)).rejects.toThrow(/Unknown competency/);
  });
});

describe('document access rules', () => {
  let DOC = 0;
  it('a rule lets one named user or role view / download that document only', async () => {
    DOC = Number((await asUser<{ id: string }>(U.facultyD1, "select public.employee_document_register(1, (select employee_document_category_id from employee_document_category limit 1), 1, 'Letter', 'employee/1/r-letter.pdf', 'letter.pdf', 'application/pdf', 500, null) id"))[0]?.id);
    // the dean of the department has no EMPLOYEE_DOCUMENT permission at all
    await expect(asUser(U.registrar2, `select public.employee_document_download_info(${DOC})`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.facultyD1, `select public.emp_doc_rule_set(${DOC}, null, 'registrar2', true, false)`)).rejects.toThrow(/Not authorised/); // the owner cannot grant
    await expect(asUser(HR1, `select public.emp_doc_rule_set(${DOC}, null, null, true, false)`)).rejects.toThrow(/either a role or a user|either/i);
    await expect(asUser(HR1, `select public.emp_doc_rule_set(${DOC}, null, 'registrar2', false, false)`)).rejects.toThrow(/viewing, downloading/);
    await expect(asUser(HR1, `select public.emp_doc_rule_set(${DOC}, null, 'student1', true, false)`)).rejects.toThrow(/student/);
    await expect(asUser(HR1, `select public.emp_doc_rule_set(${DOC}, 'STUDENT', null, true, false)`)).rejects.toThrow(/cannot be shared/);
    await expect(asUser(HR1, `select public.emp_doc_rule_set(${DOC}, 'NOPE', null, true, false)`)).rejects.toThrow(/Unknown role/);
    await asUser(HR1, `select public.emp_doc_rule_set(${DOC}, null, 'registrar2', true, false)`); // view only
    expect((await asUser(U.registrar2, 'select * from public.employee_document_list(1)')).length).toBe(1);
    await expect(asUser(U.registrar2, `select public.employee_document_download_info(${DOC})`)).rejects.toThrow(/Not authorised/); // view is not download
    await asUser(HR1, `select public.emp_doc_rule_set(${DOC}, null, 'registrar2', true, true)`);
    expect((await asUser<{ i: { storage_key: string } }>(U.registrar2, `select public.employee_document_download_info(${DOC}) i`))[0]?.i.storage_key).toBe('employee/1/r-letter.pdf');
    // other users, and review rights, stay as they were
    await expect(asUser(U.registrar1, `select public.employee_document_review(${DOC}, 'VERIFIED')`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.registrar2, `select public.employee_document_review(${DOC}, 'VERIFIED')`)).rejects.toThrow(/Not authorised/);
    expect(await asUser(U.student1, 'select * from public.employee_document_list(1)')).toEqual([]);
  });
  it('the Storage policy follows the rule; ending the rule withdraws access', async () => {
    await asUser(U.registrar2, "select 1 from storage.objects where name = 'employee/1/r-letter.pdf'");
    expect((await asUser(U.registrar2, "select name from storage.objects where name = 'employee/1/r-letter.pdf'")).length).toBe(1);
    const rules = (await asUser<{ l: { id: number; who: string; active: boolean }[] }>(HR1, `select public.emp_doc_rule_list(${DOC}) l`))[0]!.l;
    expect(rules.length).toBe(2);
    for (const r of rules) { await asUser(HR1, `select public.emp_doc_rule_end(${r.id})`); await asUser(HR1, `select public.emp_doc_rule_end(${r.id})`); }
    expect(await asUser(U.registrar2, 'select * from public.employee_document_list(1)')).toEqual([]);
    expect(await asUser(U.registrar2, "select name from storage.objects where name = 'employee/1/r-letter.pdf'")).toEqual([]);
    await expect(asUser(U.registrar2, `select public.emp_doc_rule_list(${DOC})`)).rejects.toThrow(/Not authorised/);
  });
});

describe('service requests and fee holds', () => {
  const create = (sub: string, kind: string, term: number | null = null, date: string | null = null, student: number | null = null) =>
    asUser<{ id: string }>(sub, `select public.svc_request_create('${kind}', ${term ?? 'null'}, ${date ? `'${date}'` : 'null'}, null, ${student ?? 'null'}) id`);
  const decide = (sub: string, id: number, a: string, rem: string | null = null) => asUser<{ r: string | null }>(sub, `select public.svc_request_decide(${id}, '${a}', ${rem ? `'${rem}'` : 'null'}) r`);
  const hold = async (type: string) => Number((await asUser<{ id: string }>(U.finance1, `select public.fin_hold_place(1, '${type}', 'dues') id`))[0]?.id);
  const release = (id: number) => asUser(U.finance1, `select public.fin_hold_release(${id}, 'paid')`);
  beforeAll(async () => {
    await db.exec("INSERT INTO student_financial_account (student_account_id, student_id, account_number) VALUES (1, 1, 'ACC1')");
  });

  it('validates who may ask and what for', async () => {
    await expect(as('anon', null, "select public.svc_request_create('GRADUATION')")).rejects.toThrow(/permission denied/);
    await expect(create(U.facultyD1, 'GRADUATION')).rejects.toThrow(/Not authorised/);
    await expect(create(U.student1, 'GRADUATION', null, null, 3)).rejects.toThrow(/Not authorised/);
    await expect(create(U.student1, 'PARTY')).rejects.toThrow(/Unknown request kind/);
    await expect(create(U.student1, 'HALL_TICKET')).rejects.toThrow(/registration in that academic term/);
    await expect(create(U.student1, 'HALL_TICKET', 12345)).rejects.toThrow(/registration in that academic term/);
    await expect(create(U.student1, 'HOSTEL_CHECKOUT')).rejects.toThrow(/planned check-out date/);
    await expect(create(U.student1, 'HOSTEL_CHECKOUT', null, '2000-01-01')).rejects.toThrow(/planned check-out date/);
    expect((await asUser<{ term_name: string }>(U.student1, 'select * from public.svc_my_terms()')).map((t) => t.term_name)).toEqual(['Odd semester 2025']);
  });
  it('an EXAMINATION hold blocks asking for a hall ticket; a HALL_TICKET hold blocks approving and issuing it', async () => {
    const e = await hold('EXAMINATION');
    await expect(create(U.student1, 'HALL_TICKET', TERM)).rejects.toThrow(/fee hold \(examination\)/);
    await release(e);
    const id = Number((await create(U.student1, 'HALL_TICKET', TERM))[0]?.id);
    await expect(create(U.student1, 'HALL_TICKET', TERM)).rejects.toThrow(/already an open request/);
    const h = await hold('HALL_TICKET');
    await expect(decide(U.superAdmin, id, 'APPROVE')).rejects.toThrow(/fee hold \(hall ticket\)/);
    expect((await asUser<{ hold_blocked: boolean }>(U.student1, `select hold_blocked from public.svc_request_list('HALL_TICKET') where service_request_id = ${id}`))[0]?.hold_blocked).toBe(true);
    await release(h);
    await expect(decide(U.student1, id, 'APPROVE')).rejects.toThrow(/Not authorised/);
    await expect(decide(U.superAdmin, id, 'COMPLETE')).rejects.toThrow(/Only an approved/);
    await decide(U.superAdmin, id, 'APPROVE');
    const h2 = await hold('HALL_TICKET');
    await expect(decide(U.superAdmin, id, 'COMPLETE')).rejects.toThrow(/fee hold/);
    await release(h2);
    const ref = (await decide(U.superAdmin, id, 'COMPLETE'))[0]?.r;
    expect(ref).toMatch(/^HT-\d{4}-\d{6}$/);
    expect(String(await val(`select request_status from sims_private.student_service_request where service_request_id = ${id}`))).toBe('COMPLETED');
  });
  it('hostel check-out and graduation follow their own holds; a student can cancel while submitted', async () => {
    const hc = Number((await create(U.student1, 'HOSTEL_CHECKOUT', null, '2099-05-01'))[0]?.id);
    const gr = Number((await create(U.registrar1, 'GRADUATION', null, null, 1))[0]?.id); // staff on behalf
    const h = await hold('HOSTEL_CHECKOUT');
    await expect(decide(U.superAdmin, hc, 'APPROVE')).rejects.toThrow(/hostel checkout/);
    await decide(U.superAdmin, gr, 'APPROVE'); // a different hold type does not matter
    await release(h);
    await expect(decide(U.superAdmin, hc, 'REJECT')).rejects.toThrow(/reason is required/);
    await decide(U.superAdmin, hc, 'REJECT', 'rooms not cleared');
    await expect(decide(U.superAdmin, hc, 'APPROVE')).rejects.toThrow(/Only a submitted/);
    const g = await hold('GRADUATION');
    await expect(decide(U.superAdmin, gr, 'COMPLETE')).rejects.toThrow(/graduation/);
    await release(g);
    expect((await decide(U.superAdmin, gr, 'COMPLETE'))[0]?.r).toMatch(/^GR-/);
    const hc2 = Number((await create(U.student1, 'HOSTEL_CHECKOUT', null, '2099-06-01'))[0]?.id);
    await asUser(U.student1, `select public.svc_request_cancel(${hc2})`);
    await asUser(U.student1, `select public.svc_request_cancel(${hc2})`);
    await expect(asUser(U.registrar2, `select public.svc_request_cancel(${hc2})`)).rejects.toThrow(/Not authorised/);
  });
  it('lists are scoped', async () => {
    expect((await asUser(U.student1, 'select * from public.svc_request_list()')).length).toBeGreaterThan(0);
    expect((await asUser(U.registrar1, 'select * from public.svc_request_list()')).length).toBeGreaterThan(0);
    expect(await asUser(U.registrar2, 'select * from public.svc_request_list()')).toEqual([]);
    expect(await asUser(U.facultyD1, 'select * from public.svc_request_list()')).toEqual([]);
    await expect(asUser(U.student1, 'select * from sims_private.student_service_request')).rejects.toThrow(/permission denied/);
  });
});
