import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createWorld, db, U } from './world';

const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];

beforeAll(createWorld, 180_000);

describe('academic calendar (global reference data)', () => {
  it('a global administrator can create, edit and delete years, terms and semesters', async () => {
    await asUser(U.superAdmin, "insert into academic_year (year_code, start_date, end_date) values ('2025-26', '2025-06-01', '2026-05-31')");
    const y = Number(await val("select academic_year_id from academic_year where year_code='2025-26'"));
    await asUser(U.superAdmin, `insert into academic_term (academic_year_id, term_code, term_name, term_type, start_date, end_date) values (${y}, 'ODD', 'Odd term', 'ODD', '2025-08-01', '2025-12-31')`);
    await asUser(U.superAdmin, "insert into semester (semester_number, semester_name) values (1, 'Semester 1')");
    expect(await asUser(U.superAdmin, "update academic_year set status='ACTIVE' where year_code='2025-26' returning academic_year_id")).toHaveLength(1);
    expect(await val('select count(*) from academic_term')).toBe(1);
  });
  it('database checks reject inverted dates and bad enums', async () => {
    await expect(asUser(U.superAdmin, "insert into academic_year (year_code, start_date, end_date) values ('X', '2026-01-01', '2025-01-01')")).rejects.toThrow(/chk_academic_year_dates|check/i);
    await expect(asUser(U.superAdmin, "insert into academic_year (year_code, start_date, end_date, status) values ('Y', '2026-01-01', '2027-01-01', 'BOGUS')")).rejects.toThrow(/enum_status|check/i);
    await expect(asUser(U.superAdmin, "insert into academic_year (year_code, start_date, end_date) values ('2025-26', '2026-06-01', '2027-05-31')")).rejects.toThrow(/duplicate|unique/i);
    await expect(asUser(U.superAdmin, 'insert into semester (semester_number, semester_name) values (0, \'Zero\')')).rejects.toThrow(/chk_semester_number|check/i);
  });
  it('institution-level staff and students can read but not change it', async () => {
    for (const sub of [U.registrar1, U.student1]) {
      expect((await asUser(sub, 'select 1 from academic_year')).length).toBe(1);
      await expect(asUser(sub, "insert into academic_year (year_code, start_date, end_date) values ('Z', '2030-01-01', '2031-01-01')")).rejects.toThrow(/row-level security/i);
      expect(await asUser(sub, "update academic_year set status='CLOSED' returning academic_year_id")).toHaveLength(0);
      expect(await asUser(sub, 'delete from semester returning semester_id')).toHaveLength(0);
    }
  });
  it('an unmapped identity sees nothing', async () => {
    expect(await asUser(U.unmapped, 'select 1 from academic_year')).toHaveLength(0);
  });
  it('a year with terms cannot be deleted (foreign key)', async () => {
    await expect(asUser(U.superAdmin, "delete from academic_year where year_code='2025-26'")).rejects.toThrow(/foreign key|violates/i);
  });
  it('changes are audited with the acting user', async () => {
    const r = await db.query<{ entity_name: string; action_code: string }>(
      "select entity_name, action_code from activity_audit where module_code='ACADEMIC_CALENDAR' and user_id=8 order by activity_audit_id",
    );
    const keys = r.rows.map((x) => `${x.entity_name}:${x.action_code}`);
    expect(keys).toEqual(expect.arrayContaining(['academic_year:INSERT', 'academic_term:INSERT', 'semester:INSERT', 'academic_year:UPDATE']));
  });
});

describe('curriculum schemes (programme-scoped)', () => {
  const ins = (p: number, code: string) =>
    `insert into curriculum_scheme (programme_id, scheme_code, scheme_name, regulation_year, effective_from) values (${p}, '${code}', 'Scheme ${code}', 2024, '2024-06-01')`;
  it('staff can create schemes only for programmes in their scope', async () => {
    await asUser(U.registrar1, ins(1, 'S-P1'));
    await expect(asUser(U.registrar1, ins(3, 'S-P2'))).rejects.toThrow(/row-level security/i);
    await expect(asUser(U.student1, ins(1, 'S-X'))).rejects.toThrow(/row-level security/i);
    // seed catalogue: FACULTY holds CURRICULUM.CREATE, so department-scoped faculty may add schemes within their own department only
    await asUser(U.facultyD1, ins(1, 'S-F'));
    await expect(asUser(U.facultyD1, ins(2, 'S-F2'))).rejects.toThrow(/row-level security/i);
  });
  it('edit and status change stay inside scope; other institutions update nothing', async () => {
    expect(await asUser(U.registrar1, "update curriculum_scheme set status='ACTIVE' where scheme_code='S-P1' returning curriculum_scheme_id")).toHaveLength(1);
    expect(await asUser(U.registrar2, "update curriculum_scheme set status='RETIRED' where scheme_code='S-P1' returning curriculum_scheme_id")).toHaveLength(0);
    expect(await asUser(U.registrar2, 'select 1 from curriculum_scheme')).toHaveLength(0);
  });
  it('rejects bad values and duplicate codes', async () => {
    await expect(asUser(U.registrar1, "insert into curriculum_scheme (programme_id, scheme_code, scheme_name, regulation_year, effective_from, status) values (1,'S-B','b',2024,'2024-06-01','BOGUS')")).rejects.toThrow(/enum_status|check/i);
    await expect(asUser(U.registrar1, "insert into curriculum_scheme (programme_id, scheme_code, scheme_name, regulation_year, effective_from) values (1,'S-B','b',1800,'2024-06-01')")).rejects.toThrow(/u_year|check|violates/i);
    await expect(asUser(U.registrar1, ins(1, 'S-P1'))).rejects.toThrow(/duplicate|unique/i);
  });
  it('a scheme used by an enrolment cannot be deleted', async () => {
    const id = Number(await val("select curriculum_scheme_id from curriculum_scheme where scheme_code='S-P1'"));
    await db.exec(`INSERT INTO student_programme_enrolment (student_id, programme_id, curriculum_scheme_id, admission_academic_year_id, admission_date, admission_semester_id)
      SELECT 1, 1, ${id}, (SELECT academic_year_id FROM academic_year LIMIT 1), '2025-08-01', (SELECT semester_id FROM semester LIMIT 1)
      WHERE NOT EXISTS (SELECT 1 FROM student_programme_enrolment WHERE student_id = 1 AND programme_id = 1 AND admission_academic_year_id = (SELECT academic_year_id FROM academic_year LIMIT 1))`);
    // REGISTRAR has no CURRICULUM.DELETE: silently denied; a holder of DELETE hits the foreign key
    expect(await asUser(U.registrar1, "delete from curriculum_scheme where scheme_code='S-P1' returning curriculum_scheme_id")).toHaveLength(0);
    await expect(asUser(U.superAdmin, "delete from curriculum_scheme where scheme_code='S-P1'")).rejects.toThrow(/foreign key|violates/i);
  });
  it('scheme changes are audited', async () => {
    expect(Number(await val("select count(*) from activity_audit where module_code='CURRICULUM' and entity_name='curriculum_scheme' and user_id=2"))).toBeGreaterThanOrEqual(2);
  });
});
