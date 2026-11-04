import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

/** Certificate requests (migration 060). student1 owns student 1; registrar1 (institution 1) reads/creates; superAdmin approves; registrar2 is another institution. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const put = (key: string, size = 500) => db.exec(`insert into storage.objects (bucket_id, name, metadata) values ('sims-documents', '${key}', '{"size": ${size}}')`);
let T = 0;
let R = 0;
const create = (sub: string, purpose = 'Bank account opening', student: number | null = null) => asUser<{ id: string }>(sub, `select public.cert_request_create(${T}, '${purpose}', ${student ?? 'null'}) id`);
const status = async (id: number) => String(await val(`select request_status from certificate_request where certificate_request_id = ${id}`));

beforeAll(async () => {
  await createWorld();
  T = Number(await val("select certificate_type_id from certificate_type where certificate_code = 'BONAFIDE'"));
}, 180_000);

describe('requesting', () => {
  it('a student requests for themselves; staff on behalf; others cannot', async () => {
    await expect(as('anon', null, `select public.cert_request_create(${T}, 'abc')`)).rejects.toThrow(/permission denied/);
    await expect(asUser(U.facultyD1, `select public.cert_request_create(${T}, 'abc', 1)`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.student1, `select public.cert_request_create(${T}, 'abc', 3)`)).rejects.toThrow(/Not authorised/); // someone else's
    await expect(create(U.student1, 'x')).rejects.toThrow(/purpose/);
    await expect(asUser(U.student1, "select public.cert_request_create(999, 'abc')")).rejects.toThrow(/active certificate type/);
    R = Number((await create(U.student1))[0]?.id);
    expect(await status(R)).toBe('SUBMITTED');
    expect(String(await val(`select request_number from certificate_request where certificate_request_id = ${R}`))).toMatch(/^CR-\d{4}-\d{6}$/);
    expect(Number((await create(U.registrar1, 'Visa', 1))[0]?.id)).toBeGreaterThan(R);
  });
  it('allows at most five open requests', async () => {
    for (let i = 0; i < 3; i++) await create(U.student1, 'More');
    await expect(create(U.student1, 'One too many')).rejects.toThrow(/5 open requests/);
  });
});

describe('listing', () => {
  it('students see their own, staff see their scope, others nothing', async () => {
    expect((await asUser(U.student1, 'select * from public.cert_request_list()')).length).toBe(5);
    expect((await asUser(U.registrar1, 'select * from public.cert_request_list()')).length).toBe(5);
    expect(await asUser(U.registrar2, 'select * from public.cert_request_list()')).toEqual([]);
    expect(await asUser(U.facultyD1, 'select * from public.cert_request_list()')).toEqual([]);
    const row = (await asUser<{ can_approve: boolean; can_cancel: boolean }>(U.student1, `select * from public.cert_request_list(null, 'SUBMITTED') where certificate_request_id = ${R}`))[0];
    expect([row?.can_approve, row?.can_cancel]).toEqual([false, true]);
  });
});

describe('decision, issue and download', () => {
  it('only an approver decides; rejection needs a reason; a student can cancel while submitted', async () => {
    await expect(asUser(U.student1, `select public.cert_request_decide(${R}, true)`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.registrar2, `select public.cert_request_decide(${R}, true)`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.superAdmin, `select public.cert_request_decide(${R}, false)`)).rejects.toThrow(/reason is required/);
    const other = Number(await val(`select max(certificate_request_id) from certificate_request`));
    await asUser(U.student1, `select public.cert_request_cancel(${other})`);
    await asUser(U.student1, `select public.cert_request_cancel(${other})`); // idempotent
    await expect(asUser(U.superAdmin, `select public.cert_request_decide(${other}, true)`)).rejects.toThrow(/Only a submitted/);
    await asUser(U.superAdmin, `select public.cert_request_decide(${R}, true, 'ok')`);
    expect(await status(R)).toBe('APPROVED');
    await expect(asUser(U.student1, `select public.cert_request_cancel(${R})`)).rejects.toThrow(/Only a submitted/);
  });
  it('issuing needs an approved request, a PDF under the student folder and a unique number', async () => {
    await put('student/1/cert-1.pdf');
    const issue = (sub: string, key = 'student/1/cert-1.pdf', name = 'cert.pdf', num = 'BON/2026/001') => asUser(sub, `select public.cert_request_issue(${R}, '${num}', '${key}', '${name}', 500)`);
    await expect(issue(U.student1)).rejects.toThrow(/Not authorised/);
    await expect(issue(U.registrar2)).rejects.toThrow(/Not authorised/);
    await expect(issue(U.registrar1, 'student/3/cert-1.pdf')).rejects.toThrow(/not stored under this student/);
    await expect(issue(U.registrar1, 'student/1/cert-1.pdf', 'cert.png')).rejects.toThrow(/PDF/);
    await expect(issue(U.registrar1, 'student/1/cert-1.pdf', 'cert.pdf', ' ')).rejects.toThrow(/certificate number is required/);
    await issue(U.registrar1);
    expect(await status(R)).toBe('ISSUED');
    await expect(issue(U.registrar1)).rejects.toThrow(/Only an approved/);
  });
  it('the owner and staff with READ download an issued certificate, logged; nobody else', async () => {
    const info = (await asUser<{ i: { storage_key: string } }>(U.student1, `select public.cert_request_download_info(${R}) i`))[0]?.i;
    expect(info?.storage_key).toBe('student/1/cert-1.pdf');
    await asUser(U.registrar1, `select public.cert_request_download_info(${R})`);
    await expect(asUser(U.registrar2, `select public.cert_request_download_info(${R})`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.facultyD1, `select public.cert_request_download_info(${R})`)).rejects.toThrow(/Not authorised/);
    expect(Number(await val("select count(*) from activity_audit where entity_name = 'certificate_request' and action_code = 'DOWNLOAD'"))).toBe(2);
    const pending = Number(await val("select min(certificate_request_id) from certificate_request where request_status = 'SUBMITTED'"));
    await expect(asUser(U.student1, `select public.cert_request_download_info(${pending})`)).rejects.toThrow(/Not authorised/);
  });
});
