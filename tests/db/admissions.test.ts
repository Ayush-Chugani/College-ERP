import { beforeAll, describe, expect, it } from 'vitest';
import { ACTION_FOR, APPLICATION_STATUSES, TRANSITIONS } from '@/lib/admission-validation';
import { as, asUser, createWorld, db, role, U } from './world';

const ADM1 = '00000000-0000-0000-0000-0000000000e1';
const ADM2 = '00000000-0000-0000-0000-0000000000e2';
const LIMITED = '00000000-0000-0000-0000-0000000000e3'; // READ + UPDATE only (no VERIFY / APPROVE)

const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const apply = (sub: string, applicant: object | null, application: object) =>
  asUser<{ id: string }>(sub, `select public.admission_apply(${applicant ? j(applicant) : "'{}'::jsonb"}, ${j(application)}) id`);
const setStatus = (sub: string, id: number | string, status: string) => asUser(sub, `select public.admission_set_status(${id}, '${status}')`);
const admit = (sub: string, id: number | string, stu: object, enr: object = ENR) => asUser<{ id: string }>(sub, `select public.admission_admit(${id}, ${j(stu)}, ${j(enr)}) id`);

const A = { first_name: 'Meera', last_name: 'Nair', primary_email: 'meera@example.org', date_of_birth: '2007-02-03' };
const APP = { programme_id: 1, academic_year_id: 1, application_date: '2025-05-01' };
const ENR = { curriculum_scheme_id: 100, admission_academic_year_id: 1, admission_semester_id: 1, admission_date: '2025-08-01' };

async function advance(sub: string, id: number | string, path: string[]) {
  for (const s of path) await setStatus(sub, id, s);
}

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO academic_year (academic_year_id, year_code, start_date, end_date) VALUES (1, '2025-26', '2025-06-01', '2026-05-31');
    INSERT INTO semester (semester_id, semester_number, semester_name) VALUES (1, 1, 'Semester 1');
    INSERT INTO curriculum_scheme (curriculum_scheme_id, programme_id, scheme_code, scheme_name, regulation_year, effective_from) VALUES (100, 1, 'S1', 'Scheme 1', 2024, '2024-06-01');
    INSERT INTO user_account (user_id, username, password_hash) VALUES (50, 'adm1', 'x'), (51, 'adm2', 'x'), (52, 'limited', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES (50, ${role('ADMISSION_OFFICER')}, 'INSTITUTION', 1), (51, ${role('ADMISSION_OFFICER')}, 'INSTITUTION', 2);
    INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
      SELECT 52, permission_id, 'ALLOW', 'INSTITUTION', 1, 'test' FROM permission WHERE permission_code IN ('ADMISSION.ALL.READ', 'ADMISSION.ALL.UPDATE');
    INSERT INTO auth.users (id) VALUES ('${ADM1}'), ('${ADM2}'), ('${LIMITED}');
    SELECT sims_private.link_auth_user('${ADM1}', 50, 'test');
    SELECT sims_private.link_auth_user('${ADM2}', 51, 'test');
    SELECT sims_private.link_auth_user('${LIMITED}', 52, 'test');`);
}, 180_000);

describe('applying', () => {
  it('registers an applicant and a DRAFT application atomically; display_name is computed', async () => {
    const [r] = await apply(ADM1, { ...A, display_name: 'FORGED' }, { ...APP, application_number: 'APP-1' });
    expect(Number(r?.id)).toBeGreaterThan(0);
    expect(await val("select display_name from admission_applicant where first_name='Meera'")).toBe('Meera Nair');
    expect(await val("select application_status || '/' || eligibility_status from admission_application where application_number='APP-1'")).toBe('DRAFT/PENDING');
  });
  it('is programme-scoped: other institution, read-only roles, students and anon are refused', async () => {
    await expect(apply(ADM2, A, { ...APP, application_number: 'APP-X' })).rejects.toThrow(/Not authorised/);
    await expect(apply(ADM1, A, { ...APP, programme_id: 3, application_number: 'APP-X' })).rejects.toThrow(/Not authorised/);
    for (const sub of [U.registrar1, U.student1, U.facultyD1, U.unmapped]) await expect(apply(sub, A, { ...APP, application_number: 'APP-X' })).rejects.toThrow(/Not authorised/);
    await expect(as('anon', null, "select public.admission_apply('{}'::jsonb,'{}'::jsonb)")).rejects.toThrow(/permission denied/i);
    expect(await val("select count(*) from admission_application where application_number='APP-X'")).toBe(0);
  });
  it('validates input and refuses a reused application number without partial writes', async () => {
    const before = Number(await val('select count(*) from admission_applicant'));
    await expect(apply(ADM1, { ...A, primary_email: 'bad' }, { ...APP, application_number: 'APP-2' })).rejects.toThrow(/valid email/);
    await expect(apply(ADM1, { first_name: ' ' }, { ...APP, application_number: 'APP-2' })).rejects.toThrow(/first_name/);
    await expect(apply(ADM1, A, { ...APP })).rejects.toThrow(/required/);
    await expect(apply(ADM1, { ...A, date_of_birth: '2999-01-01' }, { ...APP, application_number: 'APP-2' })).rejects.toThrow(/plausible/);
    await expect(apply(ADM1, A, { ...APP, application_number: 'APP-1' })).rejects.toThrow(/already in use/);
    expect(Number(await val('select count(*) from admission_applicant'))).toBe(before); // the applicant insert was rolled back too
  });
  it('an existing applicant can get another application only by someone who may see them', async () => {
    const aid = Number(await val("select admission_applicant_id from admission_applicant where first_name='Meera'"));
    await apply(ADM1, null, { ...APP, admission_applicant_id: aid, application_number: 'APP-3' });
    await expect(apply(ADM2, null, { ...APP, programme_id: 3, admission_applicant_id: aid, application_number: 'APP-4' })).rejects.toThrow(/Not authorised/);
  });
});

describe('visibility and direct writes', () => {
  it('staff see applications and applicants of their own institution only', async () => {
    const n = async (sub: string, t: string) => (await asUser(sub, `select 1 from ${t}`)).length;
    expect(await n(ADM1, 'admission_application')).toBe(2);
    expect(await n(ADM1, 'admission_applicant')).toBe(1);
    expect(await n(U.registrar1, 'admission_application')).toBe(2); // READ at institution scope
    for (const sub of [ADM2, U.registrar2, U.facultyD1, U.student1, U.unmapped]) {
      expect(await n(sub, 'admission_application')).toBe(0);
      expect(await n(sub, 'admission_applicant')).toBe(0);
    }
    expect(await n(U.superAdmin, 'admission_application')).toBe(2);
  });
  it('direct writes are closed: only the RPCs can change admissions data', async () => {
    await expect(asUser(ADM1, "update admission_application set application_status='ADMITTED'")).rejects.toThrow(/permission denied/i);
    await expect(asUser(U.superAdmin, "insert into admission_application (application_number, admission_applicant_id, programme_id, academic_year_id, application_date) values ('Z',1,1,1,now())")).rejects.toThrow(/permission denied/i);
    await expect(asUser(ADM1, 'delete from admission_applicant')).rejects.toThrow(/permission denied/i);
  });
});

describe('status workflow', () => {
  let id: number;
  beforeAll(async () => {
    id = Number(await val("select application_id from admission_application where application_number='APP-1'"));
  });
  it('enforces the transition matrix', async () => {
    await expect(setStatus(ADM1, id, 'ELIGIBLE')).rejects.toThrow(/cannot move from DRAFT to ELIGIBLE/);
    await expect(setStatus(ADM1, id, 'ADMITTED')).rejects.toThrow(/admission_admit/);
    await expect(setStatus(ADM1, id, 'BOGUS')).rejects.toThrow(/Unknown/);
    await setStatus(ADM1, id, 'SUBMITTED');
    await setStatus(ADM1, id, 'SUBMITTED'); // idempotent replay
    expect(await val(`select application_status from admission_application where application_id=${id}`)).toBe('SUBMITTED');
  });
  it('permissions differ per target: UPDATE-only users cannot verify or approve, other institutions cannot act', async () => {
    await setStatus(LIMITED, id, 'UNDER_REVIEW');
    await expect(setStatus(LIMITED, id, 'ELIGIBLE')).rejects.toThrow(/ADMISSION.ALL.VERIFY/);
    await setStatus(ADM1, id, 'ELIGIBLE');
    expect(await val(`select eligibility_status from admission_application where application_id=${id}`)).toBe('ELIGIBLE');
    await expect(setStatus(LIMITED, id, 'SELECTED')).rejects.toThrow(/ADMISSION.ALL.APPROVE/);
    await expect(setStatus(ADM2, id, 'SELECTED')).rejects.toThrow(/Not authorised/);
    await expect(setStatus(U.student1, id, 'SELECTED')).rejects.toThrow(/Not authorised/);
  });
  it('cannot admit before SELECTED, and only with APPROVE + STUDENT.CREATE in scope', async () => {
    await expect(admit(ADM1, id, { student_number: 'ADM-001' })).rejects.toThrow(/Only a SELECTED/);
    await setStatus(ADM1, id, 'SELECTED');
    await expect(admit(LIMITED, id, { student_number: 'ADM-001' })).rejects.toThrow(/Not authorised/);
    await expect(admit(ADM2, id, { student_number: 'ADM-001' })).rejects.toThrow(/Not authorised/);
    await expect(admit(ADM1, id, {})).rejects.toThrow(/student_number is required/);
    expect(await val(`select application_status from admission_application where application_id=${id}`)).toBe('SELECTED');
  });
  it('admits atomically: creates the student and enrolment from the applicant and marks the application ADMITTED', async () => {
    const [r] = await admit(ADM1, id, { student_number: 'ADM-001' });
    const sid = Number(r?.id);
    expect(sid).toBeGreaterThan(0);
    expect(await val(`select first_name || ' ' || last_name from student where student_id=${sid}`)).toBe('Meera Nair');
    expect(await val(`select primary_email from student where student_id=${sid}`)).toBe('meera@example.org');
    expect(await val(`select count(*) from student_programme_enrolment where student_id=${sid} and programme_id=1`)).toBe(1);
    expect(await val(`select application_status || ':' || admitted_student_id from admission_application where application_id=${id}`)).toBe(`ADMITTED:${sid}`);
    expect(Number((await admit(ADM1, id, { student_number: 'ADM-001' }))[0]?.id)).toBe(sid); // idempotent replay
    expect(await val("select count(*) from student where student_number='ADM-001'")).toBe(1);
  });
  it('a failed admission rolls back completely (duplicate student number keeps the application SELECTED)', async () => {
    const [r] = await apply(ADM1, { first_name: 'Dev', primary_email: 'dev@example.org' }, { ...APP, application_number: 'APP-5' });
    const id2 = Number(r?.id);
    await advance(ADM1, id2, ['SUBMITTED', 'UNDER_REVIEW', 'ELIGIBLE', 'SELECTED']);
    await expect(admit(ADM1, id2, { student_number: 'ADM-001' })).rejects.toThrow(/already registered/);
    expect(await val(`select application_status from admission_application where application_id=${id2}`)).toBe('SELECTED');
    expect(await val(`select admitted_student_id is null from admission_application where application_id=${id2}`)).toBe(true);
    await expect(admit(ADM1, id2, { student_number: 'ADM-002' }, { ...ENR, curriculum_scheme_id: 999 })).rejects.toThrow();
    expect(await val("select count(*) from student where student_number='ADM-002'")).toBe(0);
  });
  it('terminal applications cannot be edited and cannot change status', async () => {
    await expect(setStatus(ADM1, id, 'CANCELLED')).rejects.toThrow(/cannot move from ADMITTED/);
    await expect(asUser(ADM1, `select public.admission_update_application(${id}, '{"remarks":"late"}'::jsonb)`)).rejects.toThrow(/can no longer be edited/);
  });
});

describe('updates', () => {
  it('applicant and application edits are scoped, partial and recomputed', async () => {
    const id = Number(await val("select application_id from admission_application where application_number='APP-3'"));
    const aid = Number(await val(`select admission_applicant_id from admission_application where application_id=${id}`));
    await asUser(ADM1, `select public.admission_update_applicant(${aid}, ${j({ last_name: 'Menon', primary_phone: '555-0101' })})`);
    expect(await val(`select display_name from admission_applicant where admission_applicant_id=${aid}`)).toBe('Meera Menon');
    expect(await val(`select primary_email from admission_applicant where admission_applicant_id=${aid}`)).toBe('meera@example.org'); // untouched
    await expect(asUser(ADM2, `select public.admission_update_applicant(${aid}, '{"phone":"1"}'::jsonb)`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(ADM1, `select public.admission_update_applicant(${aid}, '{"first_name":" "}'::jsonb)`)).rejects.toThrow(/cannot be blank/);
    await asUser(ADM1, `select public.admission_update_application(${id}, '{"remarks":"documents received"}'::jsonb)`);
    expect(await val(`select remarks from admission_application where application_id=${id}`)).toBe('documents received');
    await expect(asUser(ADM2, `select public.admission_update_application(${id}, '{"remarks":"x"}'::jsonb)`)).rejects.toThrow(/Not authorised/);
  });
  it('every change is audited against the acting user', async () => {
    const r = await db.query<{ entity_name: string; action_code: string }>("select entity_name, action_code from activity_audit where module_code='ADMISSION' and user_id=50");
    const keys = new Set(r.rows.map((x) => `${x.entity_name}:${x.action_code}`));
    for (const k of ['admission_applicant:INSERT', 'admission_application:INSERT', 'admission_application:UPDATE', 'admission_applicant:UPDATE']) expect(keys.has(k)).toBe(true);
  });
});

describe('TypeScript and database agree on the workflow', () => {
  it('the transition matrix is identical for every status pair', async () => {
    for (const from of APPLICATION_STATUSES) {
      for (const to of APPLICATION_STATUSES) {
        const ts = (TRANSITIONS[from] as readonly string[]).includes(to);
        expect(await val(`select sims_private.admission_transition_ok('${from}', '${to}')`), `${from}->${to}`).toBe(ts);
      }
    }
  });
  it('the permission action per target status is identical', async () => {
    for (const to of APPLICATION_STATUSES) {
      expect(await val(`select sims_private.admission_action_for('${to}')`), to).toBe(ACTION_FOR[to] ?? null);
    }
  });
});
