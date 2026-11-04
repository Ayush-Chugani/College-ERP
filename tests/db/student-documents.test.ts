import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

/** Student documents on Storage (migration 042). student1 owns student 1; student 2 is in another department; registrar1 (institution 1) reads/creates; superAdmin verifies. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const lit = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const put = (key: string, size = 1000) => db.exec(`insert into storage.objects (bucket_id, name, metadata) values ('sims-documents', ${lit(key)}, '{"size": ${size}}')`);
const register = (sub: string, o: { student?: number; key?: string; name?: string; mime?: string; size?: number; number?: string | null; issue?: string | null; expiry?: string | null; type?: number } = {}) =>
  asUser<{ id: string }>(sub, `select public.student_document_register(${o.student ?? 1}, ${o.type ?? OK}, ${lit(o.key ?? 'student/1/a1-passport.pdf')}, ${lit(o.name ?? 'passport.pdf')}, ${lit(o.mime ?? 'application/pdf')}, ${o.size ?? 1000}, null, ${lit(o.number ?? null)}, ${lit(o.issue ?? null)}, ${lit(o.expiry ?? null)}) id`);
const review = (sub: string, id: number, d: string, remarks: string | null = null) => asUser(sub, `select public.student_document_review(${id}, '${d}', ${lit(remarks)})`);

let D1: number;
let OK = 0;
let OLD = 0;

beforeAll(async () => {
  await createWorld();
  await db.exec("INSERT INTO document_type (document_code, document_name) VALUES ('T_OK','Test identity proof'),('T_OLD','Test retired type')");
  await db.exec("UPDATE document_type SET is_active = false WHERE document_code = 'T_OLD'");
  OK = Number(await val("select document_type_id from document_type where document_code = 'T_OK'"));
  OLD = Number(await val("select document_type_id from document_type where document_code = 'T_OLD'"));
}, 180_000);

describe('bucket and storage policies', () => {
  it('creates a private, size-limited bucket', async () => {
    const b = (await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'sims-documents'")).rows[0];
    expect(b?.public).toBe(false);
    expect(Number(b?.file_size_limit)).toBe(10485760);
    expect(b?.allowed_mime_types).toEqual(['application/pdf', 'image/jpeg', 'image/png']);
  });
  it('lets a student upload only under their own folder; others cannot read', async () => {
    await asUser(U.student1, "insert into storage.objects (bucket_id, name) values ('sims-documents', 'student/1/own.pdf')");
    await expect(asUser(U.student1, "insert into storage.objects (bucket_id, name) values ('sims-documents', 'student/2/other.pdf')")).rejects.toThrow(/row-level security/);
    await expect(asUser(U.student1, "insert into storage.objects (bucket_id, name) values ('sims-documents', 'elsewhere/1/x.pdf')")).rejects.toThrow(/row-level security/);
    await expect(asUser(U.student1, "insert into storage.objects (bucket_id, name) values ('sims-documents', 'student/1/a/b.pdf')")).rejects.toThrow(/row-level security/);
    await expect(as('anon', null, "insert into storage.objects (bucket_id, name) values ('sims-documents', 'student/1/anon.pdf')")).rejects.toThrow();
    expect((await asUser(U.student1, "select name from storage.objects where bucket_id = 'sims-documents'")).map((r) => (r as { name: string }).name)).toEqual(['student/1/own.pdf']);
    expect(await asUser(U.unmapped, "select name from storage.objects")).toEqual([]);
    expect(await asUser(U.registrar2, "select name from storage.objects")).toEqual([]); // other institution
    expect((await asUser(U.registrar1, "select name from storage.objects")).length).toBe(1); // institution 1 staff
  });
  it('allows removing an orphan but not a registered object', async () => {
    await asUser(U.student1, "delete from storage.objects where name = 'student/1/own.pdf'");
    expect(Number(await val("select count(*) from storage.objects"))).toBe(0);
  });
});

describe('registering', () => {
  it('validates the file and the student', async () => {
    await put('student/1/a1-passport.pdf');
    await expect(register(U.registrar2)).rejects.toThrow(/DOCUMENT.ALL.CREATE/);
    await expect(register(U.unmapped)).rejects.toThrow(/DOCUMENT.ALL.CREATE/);
    await expect(register(U.student1, { key: 'student/2/a.pdf' })).rejects.toThrow(/not stored under this student/);
    await expect(register(U.student1, { mime: 'text/html' })).rejects.toThrow(/PDF, JPEG and PNG/);
    await expect(register(U.student1, { name: 'passport.exe' })).rejects.toThrow(/does not match its type/);
    await expect(register(U.student1, { name: 'noextension' })).rejects.toThrow(/does not match its type/);
    await expect(register(U.student1, { size: 0 })).rejects.toThrow(/between 1 byte and 10 MB/);
    await expect(register(U.student1, { size: 10485761 })).rejects.toThrow(/between 1 byte and 10 MB/);
    await expect(register(U.student1, { size: 999 })).rejects.toThrow(/size does not match/);
    await expect(register(U.student1, { type: OLD })).rejects.toThrow(/active document type/);
    await expect(register(U.student1, { issue: '2024-02-01', expiry: '2024-01-01' })).rejects.toThrow(/expiry date/);
    await expect(register(U.student1, { key: 'student/1/missing.pdf' })).rejects.toThrow(/has not been uploaded/);
    expect(Number(await val('select count(*) from student_document'))).toBe(0);
  });
  it('registers a pending document; double registration is refused; metadata is not client-writable', async () => {
    D1 = Number((await register(U.student1, { number: 'P123', issue: '2020-01-01', expiry: '2099-01-01' }))[0]?.id);
    const row = (await db.query<{ verification_status: string; confidentiality_level: string; storage_provider: string }>(
      `select d.verification_status, f.confidentiality_level, f.storage_provider from student_document d join file_object f using (file_object_id) where student_document_id = ${D1}`)).rows[0];
    expect(row).toEqual({ verification_status: 'PENDING', confidentiality_level: 'CONFIDENTIAL', storage_provider: 'supabase-storage' });
    await expect(register(U.student1, { number: 'P123' })).rejects.toThrow(/already registered/);
    await expect(asUser(U.student1, "insert into file_object (storage_provider, storage_key, original_file_name, mime_type, file_size_bytes) values ('x','y','z.pdf','application/pdf',1)")).rejects.toThrow(/row-level security|permission denied/);
    await asUser(U.student1, `update student_document set verification_status = 'VERIFIED' where student_document_id = ${D1}`).catch(() => undefined); // RLS: matches no row, or the VERIFY guard fires
    expect(await val(`select verification_status from student_document where student_document_id = ${D1}`)).toBe('PENDING');
    expect(Number(await val("select count(*) from activity_audit where module_code = 'DOCUMENT'"))).toBeGreaterThanOrEqual(2);
  });
  it('lets staff with CREATE register for a student', async () => {
    await put('student/1/b2-marks.png', 2000);
    const id = Number((await register(U.registrar1, { key: 'student/1/b2-marks.png', name: 'Marks.PNG', mime: 'image/png', size: 2000 }))[0]?.id);
    expect(id).toBeGreaterThan(D1);
  });
  it('registered objects can no longer be deleted by the client', async () => {
    await expect(asUser(U.student1, "delete from storage.objects where name = 'student/1/a1-passport.pdf'").then(() => val("select count(*) from storage.objects where name = 'student/1/a1-passport.pdf'"))).resolves.toBe(1);
  });
});

describe('listing and downloading', () => {
  it('shows the owner and in-scope staff, nobody else', async () => {
    const own = await asUser<{ student_document_id: string; effective_status: string }>(U.student1, 'select student_document_id, effective_status from public.student_document_list(1)');
    expect(own.length).toBe(2);
    expect((await asUser(U.registrar1, 'select * from public.student_document_list(1)')).length).toBe(2);
    expect(await asUser(U.registrar2, 'select * from public.student_document_list(1)')).toEqual([]);
    expect(await asUser(U.unmapped, 'select * from public.student_document_list(1)')).toEqual([]);
    await expect(as('anon', null, 'select * from public.student_document_list(1)')).rejects.toThrow(/permission denied/);
  });
  it('authorises, returns the key and logs each download', async () => {
    const info = await asUser<{ i: { storage_key: string; file_name: string } }>(U.student1, `select public.student_document_download_info(${D1}) i`);
    expect(info[0]?.i).toMatchObject({ storage_key: 'student/1/a1-passport.pdf', file_name: 'passport.pdf' });
    await asUser(U.registrar1, `select public.student_document_download_info(${D1})`);
    await expect(asUser(U.registrar2, `select public.student_document_download_info(${D1})`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.unmapped, `select public.student_document_download_info(${D1})`)).rejects.toThrow(/Not authorised/);
    expect(Number(await val("select count(*) from activity_audit where action_code = 'DOWNLOAD'"))).toBe(2);
  });
});

describe('review and delete', () => {
  it('only a verifier can review; rejecting needs remarks; decisions are final', async () => {
    await expect(review(U.student1, D1, 'VERIFIED')).rejects.toThrow(/DOCUMENT.ALL.VERIFY/);
    await expect(review(U.superAdmin, D1, 'MAYBE')).rejects.toThrow(/VERIFIED or REJECTED/);
    await expect(review(U.superAdmin, D1, 'REJECTED')).rejects.toThrow(/Remarks are required/);
    await review(U.superAdmin, D1, 'VERIFIED');
    await review(U.superAdmin, D1, 'VERIFIED'); // idempotent
    expect(await val(`select verification_status from student_document where student_document_id = ${D1}`)).toBe('VERIFIED');
    expect(await val(`select verified_at is not null from student_document where student_document_id = ${D1}`)).toBe(true);
    await expect(review(U.superAdmin, D1, 'REJECTED', 'changed my mind')).rejects.toThrow(/Only a pending document/);
  });
  it('shows a verified document as EXPIRED once its expiry date has passed', async () => {
    await db.exec(`update student_document set expiry_date = '2000-01-01', issue_date = '1999-01-01' where student_document_id = ${D1}`);
    expect(await val(`select effective_status from (select * from public.student_document_list(1)) x where student_document_id = ${D1}`)).toBe('EXPIRED');
  });
  it('lets the owner delete a pending document but not a verified one; the object is then an orphan', async () => {
    const pending = Number(await val('select student_document_id from student_document where verification_status = \'PENDING\' limit 1'));
    await expect(asUser(U.registrar2, `select public.student_document_delete(${pending})`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.student1, `select public.student_document_delete(${D1})`)).rejects.toThrow(/verified document cannot be deleted/);
    const key = (await asUser<{ k: string }>(U.student1, `select public.student_document_delete(${pending}) k`))[0]?.k;
    expect(key).toBe('student/1/b2-marks.png');
    expect(Number(await val(`select count(*) from student_document where student_document_id = ${pending}`))).toBe(0);
    await asUser(U.student1, `delete from storage.objects where name = '${key}'`);
    expect(Number(await val(`select count(*) from storage.objects where name = '${key}'`))).toBe(0);
  });
});
