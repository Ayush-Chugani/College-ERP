import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

/** Record sections and reference data (migration 046). registrar1 holds STUDENT.* for institution 1; superAdmin holds everything globally; registrar2 is the other institution. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const save = (sub: string, kind: string, parent: number, section: string, id: number | null, p: Record<string, unknown>) =>
  asUser<{ id: string }>(sub, `select public.section_save('${kind}', ${parent}, '${section}', ${id ?? 'null'}, ${j(p)}) id`);
const rows = async (sub: string, kind: string, parent: number, section: string) =>
  (await asUser<{ r: { rows: Record<string, unknown>[]; can_create: boolean; can_update: boolean; can_delete: boolean } }>(sub, `select public.section_rows('${kind}', ${parent}, '${section}') r`))[0]?.r;

let COUNTRY = 0;
const addr = (o: Record<string, unknown> = {}) => ({ address_type: 'PERMANENT', address_line_1: '12 Main Road', city: 'Haveri', country_id: COUNTRY, ...o });

beforeAll(async () => {
  await createWorld();
  await db.exec("INSERT INTO country (iso_code, country_name) VALUES ('ZX','Testland')");
  COUNTRY = Number(await val("select country_id from country where iso_code = 'ZX'"));
}, 180_000);

describe('section metadata', () => {
  it('lists sections and describes forms without keys, audit or user columns', async () => {
    expect((await asUser<{ section: string }>(U.student1, "select section from public.record_sections('student')")).map((r) => r.section)).toEqual(['address', 'guardian', 'previous_education', 'entrance_exam', 'residence']);
    expect((await asUser<{ section: string }>(U.student1, "select section from public.record_sections('employee')")).map((r) => r.section)).toEqual(['address', 'qualification', 'experience']);
    expect(await asUser(U.student1, "select section from public.record_sections('nope')")).toEqual([]);
    const s = (await asUser<{ s: { table: string; columns: { name: string; required: boolean; ref_table: string | null }[] } }>(U.registrar1, "select public.section_schema('student', 'address') s"))[0]?.s;
    const names = s?.columns.map((c) => c.name) ?? [];
    expect(s?.table).toBe('student_address');
    expect(names).toEqual(expect.arrayContaining(['address_type', 'address_line_1', 'city', 'country_id']));
    for (const hidden of ['student_address_id', 'student_id', 'created_at', 'updated_at']) expect(names).not.toContain(hidden);
    expect(s?.columns.find((c) => c.name === 'country_id')).toMatchObject({ required: true, ref_table: 'country' });
    const q = (await asUser<{ s: { columns: { name: string }[] } }>(U.superAdmin, "select public.section_schema('employee', 'experience') s"))[0]?.s.columns.map((c) => c.name) ?? [];
    expect(q.filter((n) => n.endsWith('_by_user_id'))).toEqual([]);
    await expect(asUser(U.registrar1, "select public.section_schema('student', 'x')")).rejects.toThrow(/Unknown section/);
    await expect(asUser(U.unmapped, "select public.section_schema('student', 'address')")).rejects.toThrow(/Not authorised/);
    await expect(as('anon', null, "select public.record_sections('student')")).rejects.toThrow(/permission denied/);
  });
  it('offers only the section lookups', async () => {
    expect((await asUser<{ label: string }>(U.registrar1, "select label from public.section_lookup_options('country')")).map((r) => r.label)).toContain('Testland');
    await expect(asUser(U.registrar1, "select * from public.section_lookup_options('student')")).rejects.toThrow(/Unknown lookup/);
    await expect(asUser(U.registrar1, "select * from public.section_lookup_options('country; drop table student')")).rejects.toThrow(/Unknown lookup/);
    await expect(asUser(U.unmapped, "select * from public.section_lookup_options('country')")).rejects.toThrow(/Not authorised/);
  });
});

describe('student sections', () => {
  let A: number;
  it('creates, reads, edits and deletes a row within scope, with audit', async () => {
    A = Number((await save(U.registrar1, 'student', 1, 'address', null, addr()))[0]?.id);
    const r = await rows(U.registrar1, 'student', 1, 'address');
    expect(r?.rows).toHaveLength(1);
    expect(r?.rows[0]).toMatchObject({ city: 'Haveri', address_line_1: '12 Main Road' });
    expect(Number(r?.rows[0]?.student_id)).toBe(1);
    expect(r).toMatchObject({ can_create: true, can_update: true });
    await save(U.registrar1, 'student', 1, 'address', A, { city: 'Dharwad', address_line_2: null });
    expect(await val(`select city from student_address where student_address_id = ${A}`)).toBe('Dharwad');
    const audit = (await db.query<{ action_code: string }>("select action_code from activity_audit where entity_name = 'student_address' order by activity_audit_id")).rows.map((x) => x.action_code);
    expect(audit).toEqual(['INSERT', 'UPDATE']);
    await expect(asUser(U.registrar1, `select public.section_delete('student', 1, 'address', ${A})`)).rejects.toThrow(/STUDENT.ALL.DELETE/); // the registrar cannot delete
    await asUser(U.superAdmin, `select public.section_delete('student', 1, 'address', ${A})`);
    expect(Number(await val('select count(*) from student_address'))).toBe(0);
    expect((await db.query<{ action_code: string }>("select action_code from activity_audit where entity_name = 'student_address' order by activity_audit_id desc limit 1")).rows[0]?.action_code).toBe('DELETE');
  });
  it('the owner reads but cannot write; other institutions see and change nothing', async () => {
    const id = Number((await save(U.registrar1, 'student', 1, 'address', null, addr({ address_type: 'CURRENT' })))[0]?.id);
    const own = await rows(U.student1, 'student', 1, 'address').catch((e: Error) => e.message);
    if (typeof own === 'string') expect(own).toMatch(/Not authorised/); else { expect(own?.can_create).toBe(false); expect(own?.can_update).toBe(false); }
    await expect(save(U.student1, 'student', 1, 'address', null, addr())).rejects.toThrow(/Not authorised/);
    await expect(save(U.student1, 'student', 1, 'address', id, { city: 'X' })).rejects.toThrow(/Not authorised/);
    await expect(rows(U.registrar2, 'student', 1, 'address')).rejects.toThrow(/Not authorised/);
    await expect(save(U.registrar2, 'student', 1, 'address', null, addr())).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.registrar2, `select public.section_delete('student', 1, 'address', ${id})`)).rejects.toThrow(/Not authorised/);
    await expect(rows(U.unmapped, 'student', 1, 'address')).rejects.toThrow(/Not authorised/);
    await expect(as('anon', null, `select public.section_rows('student', 1, 'address')`)).rejects.toThrow(/permission denied/);
  });
  it('rows cannot be moved to or read through another student', async () => {
    const id = Number(await val('select student_address_id from student_address limit 1'));
    await expect(asUser(U.superAdmin, `select public.section_delete('student', 2, 'address', ${id})`)).rejects.toThrow(/Unknown row/); // belongs to student 1
    await expect(save(U.registrar1, 'student', 2, 'address', id, { city: 'Y' })).rejects.toThrow(/Unknown row/);
    await expect(save(U.registrar1, 'student', 1, 'address', id, { student_id: 2 })).rejects.toThrow(/Unknown field/);
    await expect(save(U.registrar1, 'student', 999, 'address', null, addr())).rejects.toThrow(/Not authorised|Unknown student/);
  });
  it('translates validation problems into readable messages', async () => {
    await expect(save(U.registrar1, 'student', 1, 'address', null, addr({ city: null }))).rejects.toThrow(/field "city" is required/);
    await expect(save(U.registrar1, 'student', 1, 'address', null, addr({ country_id: 9999 }))).rejects.toThrow(/does not exist/);
    await expect(save(U.registrar1, 'student', 1, 'address', null, addr({ address_type: 'MOON' }))).rejects.toThrow(/not allowed/);
    await expect(save(U.registrar1, 'student', 1, 'address', null, addr({ valid_from: 'not a date' }))).rejects.toThrow(/wrong format/);
    await expect(save(U.registrar1, 'student', 1, 'address', null, addr({ postal_code: '1'.repeat(40) }))).rejects.toThrow(/wrong format or is too long/);
    await expect(save(U.registrar1, 'student', 1, 'address', null, addr({ student_address_id: 5 }))).rejects.toThrow(/Unknown field/);
    await expect(save(U.registrar1, 'student', 1, 'address', null, addr({ created_at: '2000-01-01' }))).rejects.toThrow(/Unknown field/);
    await expect(save(U.registrar1, 'student', 1, 'address', null, {})).rejects.toThrow(/Nothing to save|required/);
    await expect(asUser(U.registrar1, `select public.section_save('student', 1, 'address', null, '[]')`)).rejects.toThrow(/must be an object/);
  });
  it('covers the other student sections', async () => {
    const g = Number((await save(U.registrar1, 'student', 1, 'guardian', null, { relationship_type: 'FATHER', full_name: 'Ravi Kumar', is_primary_contact: true }))[0]?.id);
    expect(g).toBeGreaterThan(0);
    await save(U.registrar1, 'student', 1, 'residence', null, { residence_type: 'HOSTEL', start_date: '2026-06-01' });
    expect((await rows(U.registrar1, 'student', 1, 'guardian'))?.rows).toHaveLength(1);
    expect((await rows(U.registrar1, 'student', 1, 'residence'))?.rows).toHaveLength(1);
    expect((await rows(U.registrar1, 'student', 1, 'entrance_exam'))?.rows).toHaveLength(0);
  });
});

describe('employee sections', () => {
  it('authorises with the section\'s own permission and keeps off the sensitive tables', async () => {
    const id = Number((await save(U.superAdmin, 'employee', 1, 'address', null, addr()))[0]?.id);
    expect(Number(await val(`select employee_id from employee_address where employee_address_id = ${id}`))).toBe(1);
    await expect(save(U.registrar1, 'employee', 1, 'address', null, addr())).rejects.toThrow(/EMPLOYEE.ALL.CREATE/);
    await expect(save(U.facultyD1, 'employee', 1, 'address', null, addr())).rejects.toThrow(/EMPLOYEE.ALL.CREATE/); // the owner cannot edit their own administrative record
    await expect(asUser(U.superAdmin, "select public.section_schema('employee', 'pan')")).rejects.toThrow(/Unknown section/);
    await expect(asUser(U.superAdmin, "select public.section_schema('employee', 'bank_account')")).rejects.toThrow(/Unknown section/);
    await expect(save(U.superAdmin, 'employee', 999, 'address', null, addr())).rejects.toThrow(/Unknown employee/);
  });
});

describe('reference data', () => {
  it('lists only what the caller may configure', async () => {
    // SUPER_ADMIN holds FEES.FEE_STRUCTURE.CONFIGURE since M052, so all 32 lists are offered.
    expect((await asUser<{ tbl: string }>(U.superAdmin, 'select tbl from public.ref_list()')).length).toBe(35);
    expect(await asUser(U.student1, 'select * from public.ref_list()')).toEqual([]);
    expect(await asUser(U.registrar1, 'select * from public.ref_list()')).toEqual([]);
    await expect(as('anon', null, 'select * from public.ref_list()')).rejects.toThrow(/permission denied/);
    await expect(asUser(U.registrar1, "select public.ref_schema('country')")).rejects.toThrow(/IAM.ALL.CONFIGURE/);
    await expect(asUser(U.registrar1, "select public.ref_rows('country')")).rejects.toThrow(/IAM.ALL.CONFIGURE/);
    await expect(asUser(U.superAdmin, "select public.ref_rows('student')")).rejects.toThrow(/Unknown reference table/);
    await expect(asUser(U.superAdmin, "select public.ref_rows('country; drop table student')")).rejects.toThrow(/Unknown reference table/);
  });
  it('adds, edits and deletes a row; in-use rows cannot be deleted; all audited', async () => {
    const id = Number((await asUser<{ id: string }>(U.superAdmin, `select public.ref_save('religion', null, ${j({ religion_code: 'TST', religion_name: 'Test faith' })}) id`))[0]?.id);
    const list = (await asUser<{ r: { religion_name: string }[] }>(U.superAdmin, "select public.ref_rows('religion') r"))[0]?.r ?? [];
    expect(list.map((x) => x.religion_name)).toContain('Test faith');
    await asUser(U.superAdmin, `select public.ref_save('religion', ${id}, ${j({ religion_name: 'Test faith 2' })})`);
    expect(await val(`select religion_name from religion where religion_id = ${id}`)).toBe('Test faith 2');
    await expect(asUser(U.registrar1, `select public.ref_save('religion', ${id}, ${j({ religion_name: 'x' })})`)).rejects.toThrow(/IAM.ALL.CONFIGURE/);
    await expect(asUser(U.superAdmin, `select public.ref_save('religion', null, ${j({ religion_code: 'TST', religion_name: 'Dup' })})`)).rejects.toThrow(/already recorded/);
    await expect(asUser(U.superAdmin, `select public.ref_save('religion', null, ${j({ religion_code: 'NN' })})`)).rejects.toThrow(/field "religion_name" is required/);
    await expect(asUser(U.superAdmin, `select public.ref_save('religion', 999999, ${j({ religion_name: 'x' })})`)).rejects.toThrow(/Unknown row/);
    await expect(asUser(U.superAdmin, `select public.ref_save('religion', ${id}, ${j({ religion_id: 5 })})`)).rejects.toThrow(/Unknown field/);
    await db.exec(`UPDATE student SET religion_id = ${id} WHERE student_id = 1`).catch(() => undefined);
    if (Number(await val(`select count(*) from student where religion_id = ${id}`)) > 0) {
      await expect(asUser(U.superAdmin, `select public.ref_delete('religion', ${id})`)).rejects.toThrow(/still in use/);
      await db.exec('UPDATE student SET religion_id = NULL WHERE student_id = 1');
    }
    await asUser(U.superAdmin, `select public.ref_delete('religion', ${id})`);
    expect(Number(await val(`select count(*) from religion where religion_id = ${id}`))).toBe(0);
    expect((await db.query<{ action_code: string }>("select action_code from activity_audit where entity_name = 'religion' order by activity_audit_id")).rows.map((x) => x.action_code)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
  });
  it('each table is configured with the permission its own policy requires (drift test)', async () => {
    const tables = (await asUser<{ tbl: string }>(U.superAdmin, 'select tbl from public.ref_list()')).map((r) => r.tbl);
    for (const t of tables) {
      const perm = String(await val(`select perm from sims_private.ref_def('${t}')`));
      const policy = await val(`select with_check from pg_policies where schemaname = 'public' and tablename = '${t}' and cmd = 'INSERT'`);
      if (policy === undefined || policy === null) expect(perm, `${t} has no write policy: only the FEES configuration tables may rely on the RPC permission`).toBe('FEES.FEE_STRUCTURE.CONFIGURE');
      else expect(String(policy), t).toContain(perm);
    }
  });
});

describe('permission codes used by policies', () => {
  it('every permission code that a row level security policy or workflow guard asks for exists', async () => {
    const used = new Set<string>();
    const sources = [
      ...(await db.query<{ q: string }>("select coalesce(qual, '') || ' ' || coalesce(with_check, '') q from pg_policies where schemaname = 'public'")).rows.map((r) => r.q),
      ...(await db.query<{ q: string }>("select prosrc q from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'sims_guard_%'")).rows.map((r) => r.q),
    ];
    for (const q of sources) for (const m of q.matchAll(/'([A-Z_]+\.[A-Z_]+\.[A-Z_]+)'/g)) used.add(m[1] as string);
    const known = new Set((await db.query<{ permission_code: string }>('select permission_code from permission')).rows.map((r) => r.permission_code));
    expect([...used].filter((c) => !known.has(c)).sort()).toEqual([]);
    expect(used.size).toBeGreaterThan(50);
  });
});
