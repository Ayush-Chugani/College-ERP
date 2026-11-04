import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, role, U } from './world';

/** Staff profile and research (migration 044). facultyD1 is employee 1 (institution 1, department 1 by role); superAdmin reviews; registrar2 is unrelated staff. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const lit = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const j = (o: Record<string, unknown>) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const put = (key: string, size = 500) => db.exec(`insert into storage.objects (bucket_id, name, metadata) values ('sims-documents', ${lit(key)}, '{"size": ${size}}')`);

let A_ID = 0; // the approved journal publication of the workflow tests
let T_JOURNAL = 0;
let T_OTHER = 0;
let PUBTYPE = 0;
let JOURNAL = 0;
let DOCT = 0;
let EVT = 0;
const common = (o: Record<string, unknown> = {}) => ({ activity_type_id: T_JOURNAL, activity_title: 'Deep learning for crops', start_date: '2026-01-05', ...o });
const detail = (o: Record<string, unknown> = {}) => ({ publication_type_id: PUBTYPE, journal_id: JOURNAL, paper_title: 'Deep learning for crops', publication_year: 2026, doi: '10.1/abc', ...o });
const save = (sub: string, c: Record<string, unknown> = {}, d: Record<string, unknown> | null = detail(), id: number | null = null, emp: number | null = null) =>
  asUser<{ id: string }>(sub, `select public.staff_activity_save(${id ?? 'null'}, ${emp ?? 'null'}, ${j(common(c))}, ${d === null ? 'null' : j(d)}) id`);
const review = (sub: string, id: number, step: string, d: string, remarks: string | null = null) => asUser(sub, `select public.staff_activity_review(${id}, '${step}', '${d}', ${lit(remarks)})`);
const evAdd = (sub: string, act: number, key: string, name = 'paper.pdf', size = 500) =>
  asUser<{ id: string }>(sub, `select public.staff_evidence_add(${act}, ${DOCT}, ${EVT}, 'Published paper', null, null, null, ${lit(key)}, ${lit(name)}, 'application/pdf', ${size}, null) id`);

beforeAll(async () => {
  await createWorld();
  T_JOURNAL = Number(await val("select activity_type_id from activity_type where activity_type_code = 'JOURNAL_PUBLICATION'"));
  PUBTYPE = Number(await val("select publication_type_id from publication_type where publication_type_code = 'JOURNAL_ARTICLE'"));
  await db.exec("INSERT INTO activity_type (activity_type_code, activity_type_name, activity_group) VALUES ('T_OTHER','Test other','OTHER')");
  T_OTHER = Number(await val("select activity_type_id from activity_type where activity_type_code = 'T_OTHER'"));
  await db.exec("INSERT INTO evidence_type (evidence_type_code, evidence_type_name) VALUES ('T_PAPER','Test paper')");
  await db.exec("INSERT INTO document_type (document_code, document_name) VALUES ('T_DOC2','Test doc 2')");
  EVT = Number(await val("select evidence_type_id from evidence_type where evidence_type_code = 'T_PAPER'"));
  DOCT = Number(await val("select document_type_id from document_type where document_code = 'T_DOC2'"));
  await db.exec(`INSERT INTO activity_evidence_requirement (activity_type_id, evidence_type_id, is_mandatory, minimum_files) VALUES (${T_JOURNAL}, ${EVT}, true, 1)`);
  JOURNAL = Number((await asUser<{ id: string }>(U.facultyD1, `select public.staff_lookup_add('journal', ${j({ journal_name: 'Journal of Testing', journal_type_id: 1, issn: '1234-5678' })}) id`))[0]?.id);
}, 180_000);

describe('lookups and form metadata', () => {
  it('describes the detail form from the catalogue', async () => {
    const s = (await asUser<{ s: { table: string; columns: { name: string; required: boolean; ref_table: string | null; type: string }[] } }>(U.facultyD1, `select public.staff_detail_schema(${T_JOURNAL}) s`))[0]?.s;
    expect(s?.table).toBe('journal_publication');
    const col = (n: string) => s?.columns.find((c) => c.name === n);
    expect(col('paper_title')?.required).toBe(true);
    expect(col('journal_id')?.ref_table).toBe('journal');
    expect(col('open_access')?.required).toBe(false);
    expect(col('staff_activity_id')).toBeUndefined();
    const none = (await asUser<{ s: { table: string | null } }>(U.facultyD1, `select public.staff_detail_schema(${T_OTHER}) s`))[0]?.s;
    expect(none?.table).toBeNull();
    await expect(as('anon', null, 'select public.staff_detail_schema(1)')).rejects.toThrow(/permission denied/);
    await expect(asUser(U.unmapped, 'select public.staff_detail_schema(1)')).rejects.toThrow(/Not authorised/);
  });
  it('describes the add-new form of a shared lookup (and nothing else)', async () => {
    const s = (await asUser<{ s: { table: string; columns: { name: string; required: boolean }[] } }>(U.facultyD1, "select public.staff_lookup_schema('journal') s"))[0]?.s;
    const names = s?.columns.map((c) => c.name) ?? [];
    expect(names).toContain('journal_name');
    expect(names).not.toContain('journal_id');
    expect(names).not.toContain('created_at');
    expect(s?.columns.find((c) => c.name === 'journal_name')?.required).toBe(true);
    await expect(asUser(U.facultyD1, "select public.staff_lookup_schema('student')")).rejects.toThrow(/cannot be extended/);
    await expect(asUser(U.unmapped, "select public.staff_lookup_schema('journal')")).rejects.toThrow(/Not authorised/);
  });
  it('offers choices for referenced lookups only', async () => {
    const opts = await asUser<{ id: string; label: string }>(U.facultyD1, "select * from public.staff_lookup_options('journal')");
    expect(opts.map((o) => o.label)).toContain('Journal of Testing');
    expect((await asUser(U.facultyD1, "select * from public.staff_lookup_options('publication_type')")).length).toBeGreaterThan(0);
    await expect(asUser(U.facultyD1, "select * from public.staff_lookup_options('user_account')")).rejects.toThrow(/Unknown lookup/);
    await expect(asUser(U.facultyD1, "select * from public.staff_lookup_options('student')")).rejects.toThrow(/Unknown lookup/);
    await expect(asUser(U.facultyD1, "select * from public.staff_lookup_options('x; drop table student')")).rejects.toThrow(/Unknown lookup/);
  });
  it('lets an employee add only allowed shared lookups, with readable errors', async () => {
    await expect(asUser(U.facultyD1, `select public.staff_lookup_add('student', ${j({ first_name: 'x' })})`)).rejects.toThrow(/cannot be extended/);
    await expect(asUser(U.student1, `select public.staff_lookup_add('publisher', ${j({ publisher_name: 'P' })})`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.facultyD1, `select public.staff_lookup_add('journal', ${j({ journal_type_id: 1 })})`)).rejects.toThrow(/field "journal_name" is required/);
    await expect(asUser(U.facultyD1, `select public.staff_lookup_add('journal', ${j({ journal_name: 'X', journal_type_id: 200 })})`)).rejects.toThrow(/selected options does not exist/);
    await expect(asUser(U.facultyD1, `select public.staff_lookup_add('journal', ${j({ journal_name: 'Dup', journal_type_id: 1, issn: '1234-5678' })})`)).rejects.toThrow(/already recorded/);
    await expect(asUser(U.facultyD1, `select public.staff_lookup_add('journal', ${j({ journal_name: 'Y', journal_type_id: 1, nonsense: 1 })})`)).rejects.toThrow(/Unknown field/);
  });
});

describe('creating and editing', () => {
  let A: number;
  it('is closed to anonymous, unrelated and direct writers', async () => {
    await expect(as('anon', null, `select public.staff_activity_save(null, 1, ${j(common())}, ${j(detail())})`)).rejects.toThrow(/permission denied/);
    await expect(save(U.student1)).rejects.toThrow(/Not authorised/);
    await expect(save(U.unmapped)).rejects.toThrow(/Not authorised/);
    await expect(save(U.registrar2, {}, detail(), null, 1)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.facultyD1, "update staff_activity set activity_title = 'x'")).rejects.toThrow(/permission denied/);
    await expect(asUser(U.facultyD1, "insert into journal_publication (staff_activity_id, publication_type_id, journal_id, paper_title, publication_year) values (1,1,1,'x',2026)")).rejects.toThrow(/permission denied/);
  });
  it('validates the common fields and the detail row with readable messages', async () => {
    await expect(save(U.facultyD1, { activity_title: ' ' })).rejects.toThrow(/title is required/);
    await expect(save(U.facultyD1, { activity_type_id: 99999 })).rejects.toThrow(/active activity type/);
    await expect(save(U.facultyD1, { start_date: '2026-03-01', end_date: '2026-01-01' })).rejects.toThrow(/end date/);
    await expect(save(U.facultyD1, {}, detail({ paper_title: undefined }))).rejects.toThrow(/field "paper_title" is required/);
    await expect(save(U.facultyD1, {}, detail({ journal_id: 99999 }))).rejects.toThrow(/selected options does not exist/);
    await expect(save(U.facultyD1, {}, detail({ publication_year: 'soon' }))).rejects.toThrow(/wrong format/);
    await expect(save(U.facultyD1, {}, detail({ bogus: 1 }))).rejects.toThrow(/Unknown detail field/);
    await expect(save(U.facultyD1, {}, null)).rejects.toThrow(/field "publication_type_id" is required/);
    expect(Number(await val('select count(*) from staff_activity'))).toBe(0); // failed saves leave nothing behind
    expect(Number(await val('select count(*) from journal_publication'))).toBe(0);
  });
  it('creates a draft with its detail row; scope comes from the employee', async () => {
    A = Number((await save(U.facultyD1))[0]?.id);
    A_ID = A;
    const r = (await db.query<{ institution_id: number; employee_id: string; a: string; paper_title: string; peer_reviewed: boolean }>(
      `select s.institution_id, s.employee_id, aps.status_code a, j.paper_title, j.peer_reviewed from staff_activity s join approval_status aps using (approval_status_id) join journal_publication j using (staff_activity_id) where s.staff_activity_id = ${A}`)).rows[0];
    expect(r).toMatchObject({ institution_id: 1, a: 'DRAFT', paper_title: 'Deep learning for crops', peer_reviewed: false });
    expect(Number(r?.employee_id)).toBe(1);
    expect(Number(await val("select count(*) from activity_audit where module_code = 'STAFF_PROFILE' and entity_name = 'staff_activity'"))).toBeGreaterThan(0);
  });
  it('a type without a detail table needs none; changing type swaps the detail row', async () => {
    const O = Number((await save(U.facultyD1, { activity_type_id: T_OTHER, activity_title: 'Misc' }, null))[0]?.id);
    expect(Number(await val(`select count(*) from journal_publication where staff_activity_id = ${O}`))).toBe(0);
    await save(U.facultyD1, { activity_type_id: T_JOURNAL, activity_title: 'Misc' }, detail({ doi: '10.1/misc' }), O);
    expect(Number(await val(`select count(*) from journal_publication where staff_activity_id = ${O}`))).toBe(1);
    await save(U.facultyD1, { activity_type_id: T_OTHER, activity_title: 'Misc' }, null, O);
    expect(Number(await val(`select count(*) from journal_publication where staff_activity_id = ${O}`))).toBe(0);
    await asUser(U.facultyD1, `select public.staff_activity_delete(${O}, 'test')`);
  });
  it('edits detail fields in place, including clearing one', async () => {
    await save(U.facultyD1, { activity_title: 'Renamed' }, detail({ paper_title: 'Better title', doi: null, volume_number: '12' }), A);
    const r = (await db.query<{ paper_title: string; doi: string | null; volume_number: string }>(`select paper_title, doi, volume_number from journal_publication where staff_activity_id = ${A}`)).rows[0];
    expect(r).toEqual({ paper_title: 'Better title', doi: null, volume_number: '12' });
    expect(await val(`select activity_title from staff_activity where staff_activity_id = ${A}`)).toBe('Renamed');
    await expect(save(U.registrar2, {}, detail(), A)).rejects.toThrow(/Not authorised/);
  });
});

describe('contributors', () => {
  it('adds employees and outsiders, refuses duplicates and bad shapes, removes', async () => {
    const A = A_ID;
    const add = (sub: string, emp: number | null, name: string | null, role = 'null') => asUser<{ id: string }>(sub, `select public.staff_contributor_add(${A}, ${emp ?? 'null'}, ${lit(name)}, null, 'Some Univ', ${role}, false, null) id`);
    const roleId = await val("select role_type_id from role_type where role_code = 'CO_AUTHOR'");
    const c = Number((await add(U.facultyD1, 2, null, String(roleId)))[0]?.id);
    await expect(add(U.facultyD1, 2, null, String(roleId))).rejects.toThrow(/already listed/);
    await expect(add(U.facultyD1, null, null)).rejects.toThrow(/either an employee or an external/);
    await expect(add(U.facultyD1, 2, 'Both')).rejects.toThrow(/either an employee or an external/);
    await expect(add(U.facultyD1, 999, null)).rejects.toThrow(/Unknown employee/);
    await add(U.facultyD1, null, 'Dr Outside');
    await expect(add(U.registrar2, null, 'x')).rejects.toThrow(/Not authorised/);
    await asUser(U.facultyD1, `select public.staff_contributor_remove(${c})`);
    expect(Number(await val(`select count(*) from staff_activity_contributor where staff_activity_id = ${A}`))).toBe(1);
  });
});

describe('evidence and workflow', () => {
  let A: number;
  let EV: number;
  it('submitting needs the mandatory evidence', async () => {
    A = A_ID;
    await expect(asUser(U.facultyD1, `select public.staff_activity_submit(${A})`)).rejects.toThrow(/Evidence required: Test paper/);
  });
  it('adds, replaces and downloads evidence under the employee prefix, with the file rules', async () => {
    await put('employee/1/p1-paper.pdf');
    await expect(evAdd(U.registrar2, A, 'employee/1/p1-paper.pdf')).rejects.toThrow(/Not authorised/);
    await expect(evAdd(U.facultyD1, A, 'student/1/p1.pdf')).rejects.toThrow(/not stored under this employee/);
    await expect(evAdd(U.facultyD1, A, 'employee/1/p1-paper.pdf', 'paper.exe')).rejects.toThrow(/does not match/);
    await expect(evAdd(U.facultyD1, A, 'employee/1/p1-paper.pdf', 'paper.pdf', 9)).rejects.toThrow(/size does not match/);
    await expect(evAdd(U.facultyD1, A, 'employee/1/none.pdf')).rejects.toThrow(/has not been uploaded/);
    EV = Number((await evAdd(U.facultyD1, A, 'employee/1/p1-paper.pdf'))[0]?.id);
    await put('employee/1/p2-paper.pdf', 800);
    const ver = (await asUser<{ v: number }>(U.facultyD1, `select public.staff_evidence_replace(${EV}, 'final copy', 'employee/1/p2-paper.pdf', 'paper2.pdf', 'application/pdf', 800, null) v`))[0]?.v;
    expect(Number(ver)).toBe(2);
    const dl = (await asUser<{ i: { storage_key: string } }>(U.facultyD1, `select public.staff_evidence_download_info(${EV}) i`))[0]?.i;
    expect(dl?.storage_key).toBe('employee/1/p2-paper.pdf');
    await expect(asUser(U.registrar2, `select public.staff_evidence_download_info(${EV})`)).rejects.toThrow(/Not authorised/);
    expect((await db.query<{ action_code: string }>(`select action_code from evidence_document_audit where evidence_document_id = ${EV} order by 1`)).rows.map((r) => r.action_code)).toEqual(['DOWNLOAD', 'REPLACE', 'UPLOAD']);
  });
  it('storage policies: owner and permitted staff only', async () => {
    await asUser(U.facultyD1, "insert into storage.objects (bucket_id, name) values ('sims-documents', 'employee/1/own.pdf')");
    await expect(asUser(U.facultyD1, "insert into storage.objects (bucket_id, name) values ('sims-documents', 'employee/2/other.pdf')")).rejects.toThrow(/row-level security/);
    await expect(asUser(U.student1, "insert into storage.objects (bucket_id, name) values ('sims-documents', 'employee/1/stu.pdf')")).rejects.toThrow(/row-level security/);
    expect((await asUser(U.facultyD1, "select name from storage.objects where name like 'employee/%'")).length).toBeGreaterThan(0);
    expect(await asUser(U.student1, "select name from storage.objects where name like 'employee/%'")).toEqual([]);
    await asUser(U.facultyD1, "delete from storage.objects where name = 'employee/1/own.pdf'");
    expect(Number(await val("select count(*) from storage.objects where name = 'employee/1/own.pdf'"))).toBe(0);
  });
  it('submits, locks, and requires an independent reviewer', async () => {
    await asUser(U.facultyD1, `select public.staff_activity_submit(${A})`);
    await asUser(U.facultyD1, `select public.staff_activity_submit(${A})`); // idempotent
    await expect(save(U.facultyD1, {}, detail(), A)).rejects.toThrow(/Only a draft/);
    await expect(evAdd(U.facultyD1, A, 'employee/1/p1-paper.pdf')).rejects.toThrow(/draft record/);
    await expect(review(U.facultyD1, A, 'VERIFY', 'VERIFIED')).rejects.toThrow(/STAFF_ACTIVITY.VERIFY/); // faculty hold no VERIFY
    await expect(review(U.registrar2, A, 'VERIFY', 'VERIFIED')).rejects.toThrow(/STAFF_ACTIVITY.VERIFY/);
    await expect(review(U.superAdmin, A, 'VERIFY', 'NEEDS_CORRECTION')).rejects.toThrow(/Remarks are required/);
    await expect(review(U.superAdmin, A, 'APPROVE', 'APPROVED')).rejects.toThrow(/verified record under review/);
    await review(U.superAdmin, A, 'VERIFY', 'NEEDS_CORRECTION', 'DOI missing');
    expect(await val(`select aps.status_code from staff_activity x join approval_status aps using (approval_status_id) where staff_activity_id = ${A}`)).toBe('DRAFT');
    await save(U.facultyD1, {}, detail({ doi: '10.1/fixed' }), A);
    await asUser(U.facultyD1, `select public.staff_activity_submit(${A})`);
    await review(U.superAdmin, A, 'VERIFY', 'VERIFIED');
    await review(U.superAdmin, A, 'APPROVE', 'APPROVED', 'ok');
    await review(U.superAdmin, A, 'APPROVE', 'APPROVED'); // idempotent
    expect(Number(await val(`select approved_by_user_id from staff_activity where staff_activity_id = ${A}`))).toBe(8);
  });
  it('nobody can review their own record', async () => {
    await db.exec(`INSERT INTO user_role_assignment (user_id, role_id, scope_type, department_id) VALUES (3, ${role('HEAD_DEPARTMENT')}, 'DEPARTMENT', 1)`);
    await fkSwitch(false);
    await db.exec("INSERT INTO employee_assignment (employee_id, campus_id, department_id, designation_id, start_date) VALUES (1,1,1,1,'2024-01-01')");
    await fkSwitch(true);
    const B = Number((await save(U.facultyD1, { activity_title: 'Second paper' }, detail({ doi: '10.1/second' })))[0]?.id);
    await put('employee/1/b-paper.pdf');
    await evAdd(U.facultyD1, B, 'employee/1/b-paper.pdf');
    await asUser(U.facultyD1, `select public.staff_activity_submit(${B})`);
    await expect(review(U.facultyD1, B, 'VERIFY', 'VERIFIED')).rejects.toThrow(/cannot review your own/);
    await review(U.superAdmin, B, 'VERIFY', 'REJECTED', 'duplicate');
    await asUser(U.facultyD1, `select public.staff_activity_delete(${B}, 'duplicate')`);
  });
});

describe('reading', () => {
  it('lists own records, staff-scope records, and nothing for others', async () => {
    expect((await asUser(U.facultyD1, 'select * from public.staff_activity_list()')).length).toBe(1);
    expect((await asUser(U.superAdmin, 'select * from public.staff_activity_list()')).length).toBe(1);
    expect(await asUser(U.registrar2, 'select * from public.staff_activity_list()')).toEqual([]);
    expect(await asUser(U.student1, 'select * from public.staff_activity_list()')).toEqual([]);
    expect((await asUser(U.superAdmin, "select * from public.staff_activity_list(null, 'crops', 'APPROVED', 'PUBLICATION')")).length).toBe(1);
    expect(await asUser(U.superAdmin, "select * from public.staff_activity_list(null, null, null, 'AWARD')")).toEqual([]);
  });
  it('returns detail, contributors and evidence with flags', async () => {
    const id = A_ID;
    const d = (await asUser<{ d: { detail: { paper_title: string }; detail_table: string; evidence: unknown[]; contributors: unknown[]; is_owner: boolean; can_edit: boolean; approval_status: string } }>(U.facultyD1, `select public.staff_activity_get(${id}) d`))[0]?.d;
    expect(d).toMatchObject({ detail_table: 'journal_publication', is_owner: true, can_edit: false, approval_status: 'APPROVED' });
    expect(d?.detail.paper_title).toBe('Deep learning for crops');
    expect(d?.evidence).toHaveLength(1);
    expect(d?.contributors).toHaveLength(1);
    await expect(asUser(U.registrar2, `select public.staff_activity_get(${id})`)).rejects.toThrow(/Not authorised/);
  });
  it('reports counts for staff with the report permission only', async () => {
    const rows = await asUser<{ activity_group: string; approval_status: string; records: string; employees: string }>(U.superAdmin, 'select * from public.staff_activity_report()');
    const row = rows.find((r) => r.activity_group === 'PUBLICATION' && r.approval_status === 'APPROVED');
    expect([Number(row?.records), Number(row?.employees)]).toEqual([1, 1]);
    expect(await asUser(U.student1, 'select * from public.staff_activity_report()')).toEqual([]);
  });
});
