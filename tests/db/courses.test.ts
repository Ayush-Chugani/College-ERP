import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createWorld, db, U } from './world';

const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const course = (dept: number, code: string, extra = '') =>
  `insert into course_catalog (owning_department_id, course_category_id, course_code, course_title, course_type ${extra ? ', ' + extra.split('|')[0] : ''}) values (${dept}, 1, '${code}', 'Title ${code}', 'THEORY' ${extra ? ', ' + extra.split('|')[1] : ''})`;

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO academic_year (academic_year_id, year_code, start_date, end_date) VALUES (1, '2025-26', '2025-06-01', '2026-05-31');
    INSERT INTO semester (semester_id, semester_number, semester_name) VALUES (1, 1, 'Semester 1');
    INSERT INTO curriculum_scheme (curriculum_scheme_id, programme_id, scheme_code, scheme_name, regulation_year, effective_from) VALUES (100, 1, 'S1', 'Scheme 1', 2024, '2024-06-01'), (300, 3, 'S3', 'Scheme 3', 2024, '2024-06-01');`);
}, 180_000);

describe('course categories (global reference data)', () => {
  it('only a global CONFIGURE holder can manage categories; everyone signed in can read', async () => {
    await asUser(U.superAdmin, "insert into course_category (course_category_id, category_code, category_name) values (1, 'CORE', 'Core')");
    await expect(asUser(U.registrar1, "insert into course_category (category_code, category_name) values ('X', 'X')")).rejects.toThrow(/row-level security/i);
    expect(await asUser(U.registrar1, "update course_category set category_name='y' returning course_category_id")).toHaveLength(0);
    expect(await asUser(U.student1, 'select 1 from course_category')).toHaveLength(1);
    await expect(asUser(U.superAdmin, "insert into course_category (category_code, category_name) values ('CORE', 'Dup')")).rejects.toThrow(/duplicate|unique/i);
  });
});

describe('course catalogue (department scope)', () => {
  it('staff add courses only to departments inside their scope', async () => {
    await asUser(U.registrar1, course(1, 'CS101'));
    await expect(asUser(U.registrar1, course(3, 'CS301'))).rejects.toThrow(/row-level security/i);
    await expect(asUser(U.student1, course(1, 'CS102'))).rejects.toThrow(/row-level security/i);
    expect(await asUser(U.registrar2, 'select 1 from course_catalog')).toHaveLength(0); // other institution sees nothing
    expect(await asUser(U.registrar1, 'select 1 from course_catalog')).toHaveLength(1);
  });
  it('database rules: unique code, non-negative values, date order, enum', async () => {
    await expect(asUser(U.registrar1, course(1, 'CS101'))).rejects.toThrow(/duplicate|unique/i);
    await expect(asUser(U.registrar1, course(1, 'CS103', 'credits|-1'))).rejects.toThrow(/chk_course_nonnegative_values|check/i);
    await expect(asUser(U.registrar1, course(1, 'CS104', "effective_from, effective_to|'2025-02-01', '2025-01-01'"))).rejects.toThrow(/chk_course_effective_dates|check/i);
    await expect(asUser(U.registrar1, "insert into course_catalog (owning_department_id, course_category_id, course_code, course_title, course_type) values (1,1,'CS105','x','MAGIC')")).rejects.toThrow(/enum_course_type|check/i);
    await expect(asUser(U.registrar1, course(1, 'CS106', 'credits|1000'))).rejects.toThrow(/numeric|overflow|out of range/i);
  });
  it('edits stay in scope', async () => {
    expect(await asUser(U.registrar1, "update course_catalog set credits=4, lecture_hours=3 where course_code='CS101' returning course_id")).toHaveLength(1);
    expect(await asUser(U.registrar2, "update course_catalog set credits=9 where course_code='CS101' returning course_id")).toHaveLength(0);
  });
});

describe('prerequisites', () => {
  let a: number, b: number;
  beforeAll(async () => {
    await asUser(U.registrar1, course(1, 'CS102'));
    a = Number(await val("select course_id from course_catalog where course_code='CS101'"));
    b = Number(await val("select course_id from course_catalog where course_code='CS102'"));
  });
  it('can be added and removed in scope; a course cannot require itself; duplicates are refused', async () => {
    await asUser(U.registrar1, `insert into course_prerequisite (course_id, prerequisite_course_id, minimum_grade) values (${b}, ${a}, 'C')`);
    await expect(asUser(U.registrar1, `insert into course_prerequisite (course_id, prerequisite_course_id) values (${b}, ${b})`)).rejects.toThrow(/chk_prerequisite_not_self|check/i);
    await expect(asUser(U.registrar1, `insert into course_prerequisite (course_id, prerequisite_course_id) values (${b}, ${a})`)).rejects.toThrow(/duplicate|unique|pkey/i);
    expect(await asUser(U.registrar2, `delete from course_prerequisite where course_id=${b} returning course_id`)).toHaveLength(0);
    // REGISTRAR has no CURRICULUM.DELETE (silently denied); a holder of DELETE may remove it
    expect(await asUser(U.registrar1, `delete from course_prerequisite where course_id=${b} returning course_id`)).toHaveLength(0);
    expect(await asUser(U.superAdmin, `delete from course_prerequisite where course_id=${b} returning course_id`)).toHaveLength(1);
  });
});

describe('courses inside a curriculum scheme', () => {
  const add = (sub: string, scheme: number, course: string, extra = '') =>
    asUser(sub, `insert into curriculum_course (curriculum_scheme_id, semester_id, course_id, course_category_id, internal_max_marks, external_max_marks, passing_marks ${extra}) select ${scheme}, 1, course_id, 1, 40, 60, 40 from course_catalog where course_code='${course}'`);
  it('is scoped by the scheme\'s programme and unique per scheme/semester/course', async () => {
    await add(U.registrar1, 100, 'CS101');
    await expect(add(U.registrar1, 100, 'CS101')).rejects.toThrow(/duplicate|unique|uq_curriculum_course/i);
    await expect(add(U.registrar1, 300, 'CS101')).rejects.toThrow(/row-level security/i); // scheme belongs to another institution's programme
    const cid = Number(await val("select course_id from course_catalog where course_code='CS102'"));
    await expect(asUser(U.student1, `insert into curriculum_course (curriculum_scheme_id, semester_id, course_id, course_category_id) values (100, 1, ${cid}, 1)`)).rejects.toThrow(/row-level security/i);
    expect(await asUser(U.registrar2, 'select 1 from curriculum_course')).toHaveLength(0);
  });
  it('a course used by a scheme cannot be deleted', async () => {
    await expect(asUser(U.superAdmin, "delete from course_catalog where course_code='CS101'")).rejects.toThrow(/foreign key|violates/i);
  });
  it('changes are audited with the acting user', async () => {
    const r = await db.query<{ entity_name: string; action_code: string }>("select entity_name, action_code from activity_audit where module_code='CURRICULUM' and user_id in (2, 8) order by activity_audit_id");
    const keys = r.rows.map((x) => `${x.entity_name}:${x.action_code}`);
    expect(keys).toEqual(expect.arrayContaining(['course_category:INSERT', 'course_catalog:INSERT', 'course_catalog:UPDATE', 'course_prerequisite:INSERT', 'course_prerequisite:DELETE', 'curriculum_course:INSERT']));
  });
});
