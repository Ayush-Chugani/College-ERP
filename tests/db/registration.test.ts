import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createWorld, db, U } from './world';

const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const id = async (sql: string) => Number(await val(sql));

const pto = (programme: number, semester: number, extra = '') =>
  `insert into programme_term_offering (academic_term_id, programme_id, curriculum_scheme_id, semester_id ${extra ? ',' + extra.split('|')[0] : ''}) values (1, ${programme}, ${programme === 1 ? 100 : 300}, ${semester} ${extra ? ',' + extra.split('|')[1] : ''}) returning programme_term_offering_id`;

let PTO: number, PTO2: number, SEC: number, CO1: number, CO2: number, CO_OTHER: number;

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO academic_year (academic_year_id, year_code, start_date, end_date) VALUES (1, '2025-26', '2025-06-01', '2026-05-31');
    INSERT INTO academic_term (academic_term_id, academic_year_id, term_code, term_name, term_type, start_date, end_date) VALUES (1, 1, 'ODD', 'Odd', 'ODD', '2025-08-01', '2025-12-31');
    INSERT INTO semester (semester_id, semester_number, semester_name) VALUES (1, 1, 'Semester 1'), (2, 2, 'Semester 2');
    INSERT INTO curriculum_scheme (curriculum_scheme_id, programme_id, scheme_code, scheme_name, regulation_year, effective_from) VALUES (100, 1, 'S1', 'Scheme 1', 2024, '2024-06-01'), (300, 3, 'S3', 'Scheme 3', 2024, '2024-06-01');
    INSERT INTO course_category (course_category_id, category_code, category_name) VALUES (1, 'CORE', 'Core');
    INSERT INTO course_catalog (course_id, owning_department_id, course_category_id, course_code, course_title, course_type) VALUES (1, 1, 1, 'CS101', 'Intro', 'THEORY'), (2, 1, 1, 'CS102', 'Data', 'THEORY'), (3, 1, 1, 'CS201', 'Next', 'THEORY');
    INSERT INTO curriculum_course (curriculum_scheme_id, semester_id, course_id, course_category_id) VALUES (100, 1, 1, 1), (100, 1, 2, 1), (100, 2, 3, 1);
    INSERT INTO programme_specialization (specialization_id, programme_id, specialization_code, specialization_name) VALUES (1, 1, 'AI', 'AI');
    -- a second programme-1 student (enrolment 4) and a withdrawn one (enrolment 5)
    INSERT INTO student (student_id, student_number, first_name, display_name) VALUES (4, 'S4', 'Four', 'Four'), (5, 'S5', 'Five', 'Five');
    INSERT INTO student_programme_enrolment (enrolment_id, student_id, programme_id, curriculum_scheme_id, admission_academic_year_id, admission_date, admission_semester_id, enrolment_status)
      VALUES (4, 4, 1, 100, 1, '2025-08-01', 1, 'ACTIVE'), (5, 5, 1, 100, 1, '2025-08-01', 1, 'WITHDRAWN');
    UPDATE student_programme_enrolment SET curriculum_scheme_id = 100, admission_academic_year_id = 1, admission_semester_id = 1 WHERE enrolment_id IN (1, 2);
    UPDATE student_programme_enrolment SET curriculum_scheme_id = 300, admission_academic_year_id = 1, admission_semester_id = 1 WHERE enrolment_id = 3;`);
}, 180_000);

describe('offering setup', () => {
  it('is programme-scoped and unique per term/programme/specialisation/semester', async () => {
    PTO = Number((await asUser<{ programme_term_offering_id: string }>(U.registrar1, pto(1, 1)))[0]?.programme_term_offering_id);
    expect(PTO).toBeGreaterThan(0);
    await expect(asUser(U.registrar1, pto(3, 1))).rejects.toThrow(/row-level security/i);
    await expect(asUser(U.student1, pto(1, 2))).rejects.toThrow(/row-level security/i);
    await expect(asUser(U.registrar1, pto(1, 1))).rejects.toThrow(/duplicate|unique|uq_programme_term/i);
    expect(await asUser(U.registrar2, 'select 1 from programme_term_offering')).toHaveLength(0);
    PTO2 = Number((await asUser<{ programme_term_offering_id: string }>(U.registrar1, pto(1, 2)))[0]?.programme_term_offering_id);
  });
  it('sections and batches follow the same scope; department faculty can add them in their own department', async () => {
    const r = await asUser<{ class_section_id: string }>(U.registrar1, `insert into class_section (programme_term_offering_id, section_code, capacity) values (${PTO}, 'A', 1) returning class_section_id`);
    SEC = Number(r[0]?.class_section_id);
    await asUser(U.facultyD1, `insert into class_section (programme_term_offering_id, section_code) values (${PTO}, 'B')`);
    await expect(asUser(U.registrar2, `insert into class_section (programme_term_offering_id, section_code) values (${PTO}, 'C')`)).rejects.toThrow(/row-level security/i);
    await expect(asUser(U.registrar1, `insert into class_section (programme_term_offering_id, section_code) values (${PTO}, 'A')`)).rejects.toThrow(/duplicate|unique/i);
  });
  it('offering_generate_courses builds course offerings from the scheme, idempotently and with authorisation', async () => {
    const n = (await asUser<{ n: number }>(U.registrar1, `select public.offering_generate_courses(${PTO}) n`))[0]?.n;
    expect(Number(n)).toBe(2);
    expect(Number((await asUser<{ n: number }>(U.registrar1, `select public.offering_generate_courses(${PTO}) n`))[0]?.n)).toBe(0);
    for (const sub of [U.registrar2, U.student1, U.unmapped]) await expect(asUser(sub, `select public.offering_generate_courses(${PTO})`)).rejects.toThrow(/Not authorised/);
    expect(await val(`select count(*) from course_offering where programme_term_offering_id=${PTO} and offering_code like '${PTO}-CS10%'`)).toBe(2);
    CO1 = await id(`select course_offering_id from course_offering where programme_term_offering_id=${PTO} and course_id=1`);
    CO2 = await id(`select course_offering_id from course_offering where programme_term_offering_id=${PTO} and course_id=2`);
    await asUser(U.registrar1, `select public.offering_generate_courses(${PTO2})`);
    CO_OTHER = await id(`select course_offering_id from course_offering where programme_term_offering_id=${PTO2}`);
  });
});

describe('term registration integrity', () => {
  const reg = (sub: string, enrolment: number, extra = '') =>
    asUser<{ term_registration_id: string }>(sub, `insert into student_term_registration (enrolment_id, programme_term_offering_id, registration_date ${extra ? ',' + extra.split('|')[0] : ''}) values (${enrolment}, ${PTO}, '2025-08-01' ${extra ? ',' + extra.split('|')[1] : ''}) returning term_registration_id`);

  it('registers an enrolled student; the enrolment must be in the offering\'s programme', async () => {
    const [r] = await reg(U.registrar1, 1, `class_section_id|${SEC}`);
    expect(Number(r?.term_registration_id)).toBeGreaterThan(0);
    await expect(reg(U.registrar1, 3)).rejects.toThrow(/Not authorised|row-level|different programme/i); // programme 3 enrolment is outside registrar1's scope and programme
    await expect(reg(U.superAdmin, 2)).rejects.toThrow(/different programme/); // enrolment 2 is in programme 2
    await expect(reg(U.superAdmin, 3)).rejects.toThrow(/different programme/);
  });
  it('is scope-checked and never open to students themselves', async () => {
    await expect(reg(U.registrar2, 4)).rejects.toThrow(/row-level security/i);
    await expect(reg(U.student1, 4)).rejects.toThrow(/row-level security/i);
    await expect(reg(U.unmapped, 4)).rejects.toThrow(/row-level security|permission/i);
  });
  it('only ACTIVE enrolments can register, and not into finished offerings', async () => {
    await expect(reg(U.superAdmin, 5)).rejects.toThrow(/ACTIVE enrolment/);
    await db.exec(`update programme_term_offering set status='COMPLETED' where programme_term_offering_id=${PTO2}`);
    await expect(asUser(U.superAdmin, `insert into student_term_registration (enrolment_id, programme_term_offering_id, registration_date) values (4, ${PTO2}, '2025-08-01')`)).rejects.toThrow(/COMPLETED/);
    await db.exec(`update programme_term_offering set status='PLANNED' where programme_term_offering_id=${PTO2}`);
  });
  it('a specialisation offering only takes students of that specialisation', async () => {
    const spec = Number((await db.query<{ i: string }>(`insert into programme_term_offering (academic_term_id, programme_id, specialization_id, curriculum_scheme_id, semester_id) values (1, 1, 1, 100, 1) returning programme_term_offering_id i`)).rows[0]?.i);
    await expect(asUser(U.superAdmin, `insert into student_term_registration (enrolment_id, programme_term_offering_id, registration_date) values (4, ${spec}, '2025-08-01')`)).rejects.toThrow(/specialisation/);
  });
  it('section capacity is enforced and freed when a registration is cancelled', async () => {
    await expect(reg(U.registrar1, 4, `class_section_id|${SEC}`)).rejects.toThrow(/section is full/);
    expect(await asUser(U.registrar1, `update student_term_registration set registration_status='CANCELLED' where enrolment_id=1 returning term_registration_id`)).toHaveLength(1);
    const [r] = await reg(U.registrar1, 4, `class_section_id|${SEC}`);
    expect(Number(r?.term_registration_id)).toBeGreaterThan(0);
    await expect(asUser(U.registrar1, `update student_term_registration set registration_status='REGISTERED' where enrolment_id=1`)).rejects.toThrow(/section is full/); // cannot reinstate into a full section
  });
  it('regression: a writer with no read access to the intermediate table (faculty cannot read enrolments) is still authorised by scope', async () => {
    expect(await asUser(U.facultyD1, 'select 1 from student_programme_enrolment')).toHaveLength(0); // no ADMISSION.READ
    await db.exec("insert into student (student_id, student_number, first_name, display_name) values (6, 'S6', 'Six', 'Six')");
    await db.exec("insert into student_programme_enrolment (enrolment_id, student_id, programme_id, curriculum_scheme_id, admission_academic_year_id, admission_date, admission_semester_id) values (6, 6, 1, 100, 1, '2025-08-01', 1)");
    const [r] = await reg(U.facultyD1, 6); // department-scoped faculty: REGISTRATION.CREATE, resolves student via the enrolment they cannot read
    expect(Number(r?.term_registration_id)).toBeGreaterThan(0);
    expect((await asUser(U.facultyD1, 'select 1 from student_term_registration where enrolment_id = 6')).length).toBe(1);
    await expect(reg(U.registrar2, 6)).rejects.toThrow(/row-level security/i); // still scoped
  });
  it('approval needs the APPROVE permission', async () => {
    const t = await id('select term_registration_id from student_term_registration where enrolment_id=4');
    await expect(asUser(U.facultyD1, `update student_term_registration set registration_status='APPROVED' where term_registration_id=${t}`)).rejects.toThrow(/Not authorised to APPROVE/);
    expect(await asUser(U.registrar1, `update student_term_registration set registration_status='APPROVED' where term_registration_id=${t} returning term_registration_id`)).toHaveLength(1);
  });
});

describe('course registration integrity', () => {
  let T4: number;
  beforeAll(async () => {
    T4 = await id('select term_registration_id from student_term_registration where enrolment_id=4');
    await asUser(U.registrar1, `insert into student_term_registration (enrolment_id, programme_term_offering_id, registration_date) values (1, ${PTO}, '2025-08-02')`).catch(() => undefined);
  });
  const addCourse = (sub: string, term: number, offering: number, extra = '') =>
    asUser(sub, `insert into student_course_registration (term_registration_id, course_offering_id, registration_date ${extra ? ',' + extra.split('|')[0] : ''}) values (${term}, ${offering}, '2025-08-05' ${extra ? ',' + extra.split('|')[1] : ''})`);

  it('registers into offerings of the same programme term only', async () => {
    await addCourse(U.registrar1, T4, CO1);
    await expect(addCourse(U.registrar1, T4, CO_OTHER)).rejects.toThrow(/same programme term/);
    await expect(addCourse(U.registrar1, T4, CO1)).rejects.toThrow(/duplicate|unique/i);
    await expect(addCourse(U.registrar2, T4, CO2)).rejects.toThrow(/row-level security/i);
    await expect(addCourse(U.student1, T4, CO2)).rejects.toThrow(/row-level security/i);
    await expect(addCourse(U.registrar1, T4, CO2, "registration_type|'MAGIC'")).rejects.toThrow(/enum_registration_type|check/i);
  });
  it('course capacity is enforced and freed by dropping', async () => {
    await db.exec(`update course_offering set registration_capacity = 1 where course_offering_id = ${CO2}`);
    await addCourse(U.registrar1, T4, CO2);
    const t1 = await id(`select term_registration_id from student_term_registration where enrolment_id=1 and registration_status='REGISTERED' limit 1`).catch(() => 0);
    if (t1) await expect(addCourse(U.registrar1, t1, CO2)).rejects.toThrow(/course offering is full/);
    expect(await asUser(U.registrar1, `update student_course_registration set registration_status='DROPPED' where term_registration_id=${T4} and course_offering_id=${CO2} returning course_registration_id`)).toHaveLength(1);
    if (t1) await addCourse(U.registrar1, t1, CO2);
  });
  it('courses cannot be added to a cancelled term registration; approval needs APPROVE', async () => {
    await expect(asUser(U.facultyD1, `update student_course_registration set registration_status='APPROVED' where term_registration_id=${T4} and course_offering_id=${CO1}`)).rejects.toThrow(/Not authorised to APPROVE/);
    await db.exec(`update student_term_registration set registration_status='CANCELLED' where term_registration_id=${T4}`);
    await expect(addCourse(U.superAdmin, T4, CO2)).rejects.toThrow(/term registration is CANCELLED/);
  });
});

describe('read helpers for the registration screens', () => {
  it('roster and term info return names for authorised staff only, even without STUDENT/ADMISSION read access', async () => {
    const roster = await asUser<{ display_name: string; student_number: string }>(U.facultyD1, `select * from public.registration_roster(${PTO})`);
    expect(roster.length).toBeGreaterThan(0);
    expect(roster.every((r) => typeof r.display_name === 'string' && r.display_name.length > 0)).toBe(true);
    const t = await id('select term_registration_id from student_term_registration where enrolment_id=4');
    expect((await asUser<{ student_number: string }>(U.facultyD1, `select * from public.registration_term_info(${t})`))[0]?.student_number).toBe('S4');
    for (const sub of [U.registrar2, U.student1, U.unmapped]) {
      await expect(asUser(sub, `select * from public.registration_roster(${PTO})`)).rejects.toThrow(/Not authorised/);
      await expect(asUser(sub, `select * from public.registration_term_info(${t})`)).rejects.toThrow(/Not authorised/);
      await expect(asUser(sub, `select * from public.registration_candidates(${PTO})`)).rejects.toThrow(/Not authorised/);
    }
  });
  it('candidates are ACTIVE, in the programme, not yet registered, searchable, and the search is not a pattern injection', async () => {
    const all = await asUser<{ student_number: string }>(U.registrar1, `select * from public.registration_candidates(${PTO})`);
    const nums = all.map((c) => c.student_number);
    expect(nums).not.toContain('S5'); // WITHDRAWN enrolment
    expect(nums).not.toContain('S2'); // other programme
    expect(nums).not.toContain('S4'); // already registered
    await db.exec("insert into student (student_id, student_number, first_name, display_name) values (7, 'SEARCH7', 'Seven', 'Seven Searchable')");
    await db.exec("insert into student_programme_enrolment (enrolment_id, student_id, programme_id, curriculum_scheme_id, admission_academic_year_id, admission_date, admission_semester_id) values (7, 7, 1, 100, 1, '2025-08-01', 1)");
    expect((await asUser(U.registrar1, `select * from public.registration_candidates(${PTO}, 'SEARCH7')`)).length).toBe(1);
    expect((await asUser(U.registrar1, `select * from public.registration_candidates(${PTO}, 'searchable')`)).length).toBe(1);
    expect((await asUser(U.registrar1, `select * from public.registration_candidates(${PTO}, 'S6')`)).length).toBe(0); // S6 is already registered
    expect(await asUser(U.registrar1, `select * from public.registration_candidates(${PTO}, '%')`)).toHaveLength(0); // wildcard is literal
  });
});

describe('audit', () => {
  it('registration changes are audited with the acting user', async () => {
    const r = await db.query<{ entity_name: string }>("select distinct entity_name from activity_audit where module_code in ('REGISTRATION','TEACHING') and user_id = 2");
    const names = r.rows.map((x) => x.entity_name);
    for (const n of ['programme_term_offering', 'class_section', 'course_offering', 'student_term_registration', 'student_course_registration']) expect(names).toContain(n);
  });
});
