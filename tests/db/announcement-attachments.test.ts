import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

/** Announcement attachments (migration 059). facultyD1 authors (department 1), registrar1 approves, student1 is in the audience once it is published. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const put = (key: string, size = 500) => db.exec(`insert into storage.objects (bucket_id, name, metadata) values ('sims-documents', '${key}', '{"size": ${size}}')`);
let A = 0;
const reg = (sub: string, key: string, name = 'notice.pdf', mime = 'application/pdf', size = 500) =>
  asUser<{ id: string }>(sub, `select public.announcement_attachment_register(${A}, '${key}', '${name}', '${mime}', ${size}) id`);

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO announcement_type (announcement_type_id, type_code, type_name, is_active) VALUES (50, 'T_ATT', 'Attachments', true);
    INSERT INTO employee_assignment (employee_id, campus_id, department_id, designation_id, start_date) VALUES (1, 1, 1, 1, '2020-01-01');
    INSERT INTO student_programme_enrolment (student_id, programme_id, curriculum_scheme_id, admission_academic_year_id, admission_date, admission_semester_id) SELECT 1, 1, 1, 1, '2024-08-01', 1 WHERE NOT EXISTS (SELECT 1 FROM student_programme_enrolment WHERE student_id = 1 AND programme_id = 1);
  `);
  A = Number((await asUser<{ id: string }>(U.facultyD1, "select public.announcement_save(null, 50, 1, 'Exam notice', 'Timetable attached', now() - interval '1 hour', null, 'STUDENTS') id"))[0]?.id);
  await put(`announcement/${A}/x1-notice.pdf`);
  await put(`announcement/${A}/x2-poster.png`);
  await put(`announcement/${A}/x3-bad.pdf`, 999);
}, 180_000);

describe('adding files', () => {
  it('only the author or an updater of a draft can add, with type, size and location checks', async () => {
    await expect(reg(U.student1, `announcement/${A}/x1-notice.pdf`)).rejects.toThrow(/Not authorised/);
    await expect(reg(U.registrar2, `announcement/${A}/x1-notice.pdf`)).rejects.toThrow(/Not authorised/);
    await expect(as('anon', null, `select public.announcement_attachment_register(${A}, 'x', 'a.pdf', 'application/pdf', 1)`)).rejects.toThrow(/permission denied/);
    await expect(reg(U.facultyD1, `announcement/${A + 1}/x1-notice.pdf`)).rejects.toThrow(/not stored under this announcement/);
    await expect(reg(U.facultyD1, `announcement/${A}/x1-notice.pdf`, 'notice.exe', 'application/pdf')).rejects.toThrow(/does not match/);
    await expect(reg(U.facultyD1, `announcement/${A}/x1-notice.pdf`, 'notice.zip', 'application/zip')).rejects.toThrow(/Only PDF/);
    await expect(reg(U.facultyD1, `announcement/${A}/missing.pdf`)).rejects.toThrow(/not been uploaded/);
    await expect(reg(U.facultyD1, `announcement/${A}/x3-bad.pdf`, 'bad.pdf', 'application/pdf', 5)).rejects.toThrow(/size does not match/);
    await reg(U.facultyD1, `announcement/${A}/x1-notice.pdf`);
    await expect(reg(U.facultyD1, `announcement/${A}/x1-notice.pdf`)).rejects.toThrow(/already registered/);
    await reg(U.registrar1, `announcement/${A}/x2-poster.png`, 'poster.png', 'image/png'); // an updater of the department
    expect(Number(await val(`select count(*) from announcement_attachment where announcement_id = ${A}`))).toBe(2);
  });
  it('is limited to ten files', async () => {
    for (let i = 3; i <= 10; i++) { await put(`announcement/${A}/f${i}.pdf`); await reg(U.facultyD1, `announcement/${A}/f${i}.pdf`, `f${i}.pdf`); }
    await put(`announcement/${A}/f11.pdf`);
    await expect(reg(U.facultyD1, `announcement/${A}/f11.pdf`)).rejects.toThrow(/at most 10/);
  });
});

describe('who can see and download', () => {
  it('managers see a draft; the audience sees nothing until approval', async () => {
    const list = async (sub: string) => (await asUser<{ l: { files: { name: string }[] } }>(sub, `select public.announcement_attachment_list(${A}) l`))[0]?.l.files.length;
    expect(await list(U.facultyD1)).toBe(10);
    await expect(asUser(U.student1, `select public.announcement_attachment_list(${A})`)).rejects.toThrow(/Unknown announcement/);
    await asUser(U.facultyD1, `select public.announcement_submit(${A})`);
    await asUser(U.registrar1, `select public.announcement_decide(${A}, true)`);
    expect(await list(U.student1)).toBe(10);
    await expect(asUser(U.unmapped, `select public.announcement_attachment_list(${A})`)).rejects.toThrow();
    await expect(asUser(U.registrar2, `select public.announcement_attachment_list(${A})`)).rejects.toThrow(/Unknown announcement/);
  });
  it('downloads are authorised and logged; files are locked once submitted', async () => {
    const fid = Number(await val(`select file_object_id from announcement_attachment where announcement_id = ${A} order by display_order limit 1`));
    const info = (await asUser<{ i: { storage_key: string } }>(U.student1, `select public.announcement_attachment_download_info(${A}, ${fid}) i`))[0]?.i;
    expect(info?.storage_key).toBe(`announcement/${A}/x1-notice.pdf`);
    await expect(asUser(U.registrar2, `select public.announcement_attachment_download_info(${A}, ${fid})`)).rejects.toThrow(/Unknown announcement or file/);
    await expect(asUser(U.student1, `select public.announcement_attachment_download_info(${A}, 99999)`)).rejects.toThrow(/Unknown announcement or file/);
    expect(Number(await val("select count(*) from activity_audit where entity_name = 'announcement_attachment' and action_code = 'DOWNLOAD'"))).toBe(1);
    await expect(asUser(U.facultyD1, `select public.announcement_attachment_remove(${A}, ${fid})`)).rejects.toThrow(/can no longer be edited/);
    await put(`announcement/${A}/late.pdf`);
    await expect(reg(U.facultyD1, `announcement/${A}/late.pdf`)).rejects.toThrow(/can no longer be edited/);
  });
  it('removing a file on a draft returns its key', async () => {
    const B = Number((await asUser<{ id: string }>(U.facultyD1, "select public.announcement_save(null, 50, 1, 'Draft', 'text', now(), null, 'ALL') id"))[0]?.id);
    await put(`announcement/${B}/d.pdf`);
    const fid = Number((await asUser<{ id: string }>(U.facultyD1, `select public.announcement_attachment_register(${B}, 'announcement/${B}/d.pdf', 'd.pdf', 'application/pdf', 500) id`))[0]?.id);
    await expect(asUser(U.student1, `select public.announcement_attachment_remove(${B}, ${fid})`)).rejects.toThrow(/Not authorised/);
    expect((await asUser<{ k: string }>(U.facultyD1, `select public.announcement_attachment_remove(${B}, ${fid}) k`))[0]?.k).toBe(`announcement/${B}/d.pdf`);
    await expect(asUser(U.facultyD1, `select public.announcement_attachment_remove(${B}, ${fid})`)).rejects.toThrow(/Unknown file/);
    expect(Number(await val(`select count(*) from announcement_attachment where announcement_id = ${B}`))).toBe(0);
  });
});
