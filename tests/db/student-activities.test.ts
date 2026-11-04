import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, role, U } from './world';

/** Student activities and evidence (migration 043). student1 is student 1 (dept 1); superAdmin has every permission; headD1 (user 3, faculty) is given HEAD_DEPARTMENT for department 1. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const lit = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const j = (o: Record<string, unknown>) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const put = (key: string, size = 500) => db.exec(`insert into storage.objects (bucket_id, name, metadata) values ('sims-documents', ${lit(key)}, '{"size": ${size}}')`);

let TYPE_FREE = 0; // no team details, no mandatory evidence
let TYPE_TEAM = 0; // requires team details, mandatory evidence
let DOCT = 0;
let EVT = 0;
const base = (over: Record<string, unknown> = {}) => ({ student_activity_type_id: TYPE_FREE, activity_title: 'State hackathon', start_date: '2026-01-10', achievement_type: 'WINNER', ...over });
const save = (sub: string, o: Record<string, unknown> = {}, id: number | null = null, student: number | null = null) =>
  asUser<{ id: string }>(sub, `select public.student_activity_save(${id ?? 'null'}, ${student ?? 'null'}, ${j(base(o))}) id`);
const review = (sub: string, id: number, step: string, d: string, remarks: string | null = null) => asUser(sub, `select public.student_activity_review(${id}, '${step}', '${d}', ${lit(remarks)})`);
const evAdd = (sub: string, act: number, key: string, name = 'cert.pdf', size = 500) =>
  asUser<{ id: string }>(sub, `select public.student_activity_evidence_add(${act}, ${DOCT}, ${EVT}, 'Certificate', null, 'Org', 'C-1', ${lit(key)}, ${lit(name)}, 'application/pdf', ${size}, null) id`);

beforeAll(async () => {
  await createWorld();
  await db.exec(`INSERT INTO student_activity_type (type_code, type_name, activity_group, requires_team_details) VALUES ('T_FREE','Test free','OTHER',false),('T_TEAM','Test team','HACKATHON',true)`);
  await db.exec(`INSERT INTO evidence_type (evidence_type_code, evidence_type_name) VALUES ('T_CERT','Test certificate')`);
  await db.exec(`INSERT INTO document_type (document_code, document_name) VALUES ('T_DOC','Test doc')`);
  TYPE_FREE = Number(await val("select student_activity_type_id from student_activity_type where type_code = 'T_FREE'"));
  TYPE_TEAM = Number(await val("select student_activity_type_id from student_activity_type where type_code = 'T_TEAM'"));
  EVT = Number(await val("select evidence_type_id from evidence_type where evidence_type_code = 'T_CERT'"));
  DOCT = Number(await val("select document_type_id from document_type where document_code = 'T_DOC'"));
  await db.exec(`INSERT INTO student_activity_evidence_requirement (student_activity_type_id, evidence_type_id, is_mandatory, minimum_files) VALUES (${TYPE_TEAM}, ${EVT}, true, 1)`);
  await db.exec(`INSERT INTO user_role_assignment (user_id, role_id, scope_type, department_id) VALUES (3, ${role('HEAD_DEPARTMENT')}, 'DEPARTMENT', 1)`);
}, 180_000);

describe('creating and editing', () => {
  let A: number;
  it('anon and unrelated users cannot call; clients cannot write tables', async () => {
    await expect(as('anon', null, `select public.student_activity_save(null, 1, ${j(base())})`)).rejects.toThrow(/permission denied/);
    await expect(save(U.unmapped)).rejects.toThrow(/Not authorised/);
    await expect(save(U.registrar2, {}, null, 1)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.student1, "update student_activity set activity_title = 'x'")).rejects.toThrow(/permission denied/);
    await expect(asUser(U.student1, "insert into student_activity_evidence_audit (student_activity_evidence_id, action_code) values (1, 'CREATE')")).rejects.toThrow(/permission denied/);
  });
  it('validates input', async () => {
    await expect(save(U.student1, { activity_title: ' ' })).rejects.toThrow(/title is required/);
    await expect(save(U.student1, { student_activity_type_id: 99999 })).rejects.toThrow(/active activity type/);
    await expect(save(U.student1, { start_date: '2026-02-01', end_date: '2026-01-01' })).rejects.toThrow(/end date/);
    await expect(save(U.student1, { achievement_type: 'GOLDEN' })).rejects.toThrow(/achievement type/);
    await expect(save(U.student1, { position_rank: 0 })).rejects.toThrow(/rank/);
    await expect(save(U.student1, { activity_url: 'javascript:alert(1)' })).rejects.toThrow(/http/);
    await expect(save(U.student1, { academic_year_id: 99999 })).rejects.toThrow(/academic year/);
    expect(Number(await val('select count(*) from student_activity'))).toBe(0);
  });
  it('a student creates a draft for themself; the organisational scope comes from the enrolment', async () => {
    A = Number((await save(U.student1))[0]?.id);
    const r = (await db.query<{ student_id: string; institution_id: number; department_id: number; programme_id: number; v: string; a: string }>(
      `select student_id, institution_id, department_id, programme_id, vs.status_code v, aps.status_code a from student_activity x join verification_status vs using (verification_status_id) join approval_status aps using (approval_status_id) where student_activity_id = ${A}`)).rows[0];
    expect(r).toMatchObject({ institution_id: 1, department_id: 1, programme_id: 1, v: 'NOT_SUBMITTED', a: 'DRAFT' });
    expect(Number(r?.student_id)).toBe(1);
    expect(Number(await val("select count(*) from activity_audit where module_code = 'STUDENT' and entity_name = 'student_activity'"))).toBeGreaterThan(0);
  });
  it('a student cannot create for someone else; a student without enrolment cannot create', async () => {
    await expect(save(U.student1, {}, null, 2)).rejects.toThrow(/Not authorised/);
  });
  it('edits only while draft, by the owner or authorised staff', async () => {
    await save(U.student1, { activity_title: 'Renamed' }, A);
    expect(await val(`select activity_title from student_activity where student_activity_id = ${A}`)).toBe('Renamed');
    await expect(save(U.registrar2, {}, A)).rejects.toThrow(/Not authorised/);
    await save(U.facultyD1, { activity_title: 'Edited by head' }, A); // HEAD_DEPARTMENT for department 1 holds UPDATE
    expect(await val(`select activity_title from student_activity where student_activity_id = ${A}`)).toBe('Edited by head');
  });
});

describe('team members', () => {
  it('adds, rejects duplicates and bad shapes, and removes', async () => {
    const A = Number(await val('select student_activity_id from student_activity limit 1'));
    const add = (sub: string, student: number | null, name: string | null) => asUser<{ id: string }>(sub, `select public.student_activity_team_add(${A}, ${student ?? 'null'}, ${lit(name)}, null, 'Member', false) id`);
    const m = Number((await add(U.student1, 2, null))[0]?.id);
    await expect(add(U.student1, 2, null)).rejects.toThrow(/already a team member/);
    await expect(add(U.student1, null, null)).rejects.toThrow(/either a student or an external/);
    await expect(add(U.student1, 2, 'Both')).rejects.toThrow(/either a student or an external/);
    await expect(add(U.student1, 999, null)).rejects.toThrow(/Unknown student/);
    await add(U.student1, null, 'Outside Person');
    await expect(add(U.registrar2, null, 'x')).rejects.toThrow(/Not authorised/);
    await asUser(U.student1, `select public.student_activity_team_remove(${m})`);
    expect(Number(await val(`select count(*) from student_activity_team_member where student_activity_id = ${A}`))).toBe(1);
  });
});

describe('workflow with mandatory evidence', () => {
  let B: number;
  let EV: number;
  it('submitting needs the start date, team name and mandatory evidence', async () => {
    B = Number((await save(U.student1, { student_activity_type_id: TYPE_TEAM, activity_title: 'Team event', start_date: null }))[0]?.id);
    await expect(asUser(U.student1, `select public.student_activity_submit(${B})`)).rejects.toThrow(/start date/);
    await save(U.student1, { student_activity_type_id: TYPE_TEAM, activity_title: 'Team event', start_date: '2026-02-01' }, B);
    await expect(asUser(U.student1, `select public.student_activity_submit(${B})`)).rejects.toThrow(/team name/);
    await save(U.student1, { student_activity_type_id: TYPE_TEAM, activity_title: 'Team event', start_date: '2026-02-01', team_name: 'Alpha' }, B);
    await expect(asUser(U.student1, `select public.student_activity_submit(${B})`)).rejects.toThrow(/Evidence required: Test certificate/);
  });
  it('adds, downloads (logged), replaces (new version) and soft-deletes evidence', async () => {
    await put('student/1/e1-cert.pdf');
    await expect(evAdd(U.registrar2, B, 'student/1/e1-cert.pdf')).rejects.toThrow(/Not authorised/);
    await expect(evAdd(U.student1, B, 'student/2/x.pdf')).rejects.toThrow(/not stored under this student/);
    await expect(evAdd(U.student1, B, 'student/1/e1-cert.pdf', 'cert.exe')).rejects.toThrow(/does not match/);
    await expect(evAdd(U.student1, B, 'student/1/e1-cert.pdf', 'cert.pdf', 501)).rejects.toThrow(/size does not match/);
    await expect(evAdd(U.student1, B, 'student/1/nope.pdf')).rejects.toThrow(/has not been uploaded/);
    EV = Number((await evAdd(U.student1, B, 'student/1/e1-cert.pdf'))[0]?.id);
    await expect(evAdd(U.student1, B, 'student/1/e1-cert.pdf')).rejects.toThrow(/already registered/);
    const info = await asUser<{ i: { storage_key: string } }>(U.student1, `select public.student_activity_evidence_download_info(${EV}) i`);
    expect(info[0]?.i.storage_key).toBe('student/1/e1-cert.pdf');
    await expect(asUser(U.registrar2, `select public.student_activity_evidence_download_info(${EV})`)).rejects.toThrow(/Not authorised/);
    await put('student/1/e2-cert-v2.pdf', 700);
    const ver = (await asUser<{ v: number }>(U.student1, `select public.student_activity_evidence_replace(${EV}, 'clearer scan', 'student/1/e2-cert-v2.pdf', 'cert2.pdf', 'application/pdf', 700, null) v`))[0]?.v;
    expect(Number(ver)).toBe(2);
    expect(Number(await val(`select count(*) from student_activity_evidence_version where student_activity_evidence_id = ${EV}`))).toBe(2);
    expect(Number(await val(`select count(*) from student_activity_evidence_version where student_activity_evidence_id = ${EV} and is_current`))).toBe(1);
    const dl = await asUser<{ i: { storage_key: string } }>(U.student1, `select public.student_activity_evidence_download_info(${EV}) i`);
    expect(dl[0]?.i.storage_key).toBe('student/1/e2-cert-v2.pdf'); // the current version
    const actions = (await db.query<{ action_code: string }>(`select action_code from student_activity_evidence_audit where student_activity_evidence_id = ${EV} order by 1`)).rows.map((r) => r.action_code);
    expect(actions).toEqual(['DOWNLOAD', 'DOWNLOAD', 'REPLACE', 'UPLOAD']);
  });
  it('submits, then locks editing', async () => {
    await asUser(U.student1, `select public.student_activity_submit(${B})`);
    await asUser(U.student1, `select public.student_activity_submit(${B})`); // idempotent
    expect(await val(`select aps.status_code from student_activity x join approval_status aps using (approval_status_id) where student_activity_id = ${B}`)).toBe('SUBMITTED');
    expect(await val(`select vs.status_code from student_activity x join verification_status vs using (verification_status_id) where student_activity_id = ${B}`)).toBe('PENDING');
    await expect(save(U.student1, { student_activity_type_id: TYPE_TEAM, team_name: 'Beta' }, B)).rejects.toThrow(/Only a draft/);
    await expect(evAdd(U.student1, B, 'student/1/e1-cert.pdf')).rejects.toThrow(/draft activity/);
    await expect(asUser(U.student1, `select public.student_activity_evidence_delete(${EV})`)).rejects.toThrow(/draft activity/);
    await expect(asUser(U.student1, `select public.student_activity_delete(${B})`)).rejects.toThrow(/draft or rejected/);
  });
  it('only verifiers verify; corrections go back to draft; verification precedes approval', async () => {
    await expect(review(U.student1, B, 'VERIFY', 'VERIFIED')).rejects.toThrow(/STUDENT_ACTIVITY.VERIFY/);
    await expect(review(U.registrar2, B, 'VERIFY', 'VERIFIED')).rejects.toThrow(/STUDENT_ACTIVITY.VERIFY/);
    await expect(review(U.superAdmin, B, 'WRONG', 'VERIFIED')).rejects.toThrow(/VERIFY or APPROVE/);
    await expect(review(U.superAdmin, B, 'VERIFY', 'MAYBE')).rejects.toThrow(/decision must be/);
    await expect(review(U.superAdmin, B, 'VERIFY', 'NEEDS_CORRECTION')).rejects.toThrow(/Remarks are required/);
    await expect(review(U.superAdmin, B, 'APPROVE', 'APPROVED')).rejects.toThrow(/verified activity under review/);
    await review(U.superAdmin, B, 'VERIFY', 'NEEDS_CORRECTION', 'Certificate unreadable');
    expect(await val(`select aps.status_code from student_activity x join approval_status aps using (approval_status_id) where student_activity_id = ${B}`)).toBe('DRAFT');
    await asUser(U.student1, `select public.student_activity_submit(${B})`);
    await review(U.facultyD1, B, 'VERIFY', 'VERIFIED'); // head of department 1 may verify and approve
    await review(U.facultyD1, B, 'VERIFY', 'VERIFIED'); // idempotent
    expect(await val(`select aps.status_code from student_activity x join approval_status aps using (approval_status_id) where student_activity_id = ${B}`)).toBe('UNDER_REVIEW');
    await expect(review(U.superAdmin, B, 'APPROVE', 'REJECTED')).rejects.toThrow(/Remarks are required/);
    await review(U.superAdmin, B, 'APPROVE', 'APPROVED', 'Well done');
    await review(U.superAdmin, B, 'APPROVE', 'APPROVED'); // idempotent
    const r = (await db.query<{ approved_by_user_id: string; approved_at: string | null }>(`select approved_by_user_id, approved_at from student_activity where student_activity_id = ${B}`)).rows[0];
    expect(Number(r?.approved_by_user_id)).toBe(8);
    expect(r?.approved_at).not.toBeNull();
    await expect(review(U.superAdmin, B, 'APPROVE', 'REJECTED', 'late')).rejects.toThrow(/under review/);
  });
  it('a rejected verification ends as rejected and can be soft-deleted', async () => {
    const C = Number((await save(U.student1, { activity_title: 'Dubious' }))[0]?.id);
    await asUser(U.student1, `select public.student_activity_submit(${C})`);
    await review(U.superAdmin, C, 'VERIFY', 'REJECTED', 'Not genuine');
    expect(await val(`select rejection_reason from student_activity where student_activity_id = ${C}`)).toBe('Not genuine');
    await asUser(U.student1, `select public.student_activity_delete(${C}, 'mistake')`);
    expect(await val(`select deleted_at is not null from student_activity where student_activity_id = ${C}`)).toBe(true);
    await expect(asUser(U.student1, `select public.student_activity_get(${C})`)).rejects.toThrow(/Not authorised/);
  });
});

describe('reading', () => {
  it('lists own activities for the student, in-scope for staff, nothing for others', async () => {
    const mine = await asUser<{ approval_status: string; total_count: string }>(U.student1, 'select approval_status, total_count from public.student_activity_list()');
    expect(mine.length).toBe(2);
    expect(Number(mine[0]?.total_count)).toBe(2);
    expect((await asUser(U.facultyD1, 'select * from public.student_activity_list()')).length).toBe(2);
    expect(await asUser(U.registrar2, 'select * from public.student_activity_list()')).toEqual([]);
    expect(await asUser(U.unmapped, 'select * from public.student_activity_list()')).toEqual([]);
    expect((await asUser(U.student1, "select * from public.student_activity_list(null, 'team')")).length).toBe(1);
    expect((await asUser(U.student1, "select * from public.student_activity_list(null, null, 'APPROVED')")).length).toBe(1);
  });
  it('returns the full detail with permissions flags', async () => {
    const id = Number(await val("select student_activity_id from student_activity where activity_title = 'Team event'"));
    const d = (await asUser<{ d: { evidence: unknown[]; team: unknown[]; is_owner: boolean; can_edit: boolean; approval_status: string } }>(U.student1, `select public.student_activity_get(${id}) d`))[0]?.d;
    expect(d?.approval_status).toBe('APPROVED');
    expect(d?.is_owner).toBe(true);
    expect(d?.can_edit).toBe(false);
    expect(d?.evidence).toHaveLength(1);
    await expect(asUser(U.registrar2, `select public.student_activity_get(${id})`)).rejects.toThrow(/Not authorised/);
  });
  it('reports counts by type and status for staff with the report permission', async () => {
    const rows = await asUser<{ type_name: string; approval_status: string; activities: string; winners: string }>(U.superAdmin, 'select * from public.student_activity_report()');
    const row = rows.find((r) => r.type_name === 'Test team' && r.approval_status === 'APPROVED');
    expect([Number(row?.activities), Number(row?.winners)]).toEqual([1, 1]);
    expect(await asUser(U.student1, 'select * from public.student_activity_report()')).toEqual([]);
  });
});
