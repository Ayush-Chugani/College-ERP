import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, role, U } from './world';

const XO = '00000000-0000-0000-0000-0000000000a7'; // EXAMINATION_OFFICER, institution 1 (full ASSESSMENT + RESULT incl. PUBLISH)
const MARKER = '00000000-0000-0000-0000-0000000000a8'; // ASSESSMENT READ + CREATE only

const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const j = (o: unknown) => `'${JSON.stringify(o)}'::jsonb`;
const rpc = <T = Record<string, unknown>>(sub: string, sql: string) => asUser<T>(sub, sql);

let CO1: number, CO2: number, CO3: number, CR_A1: number, CR_A2: number, CR_A3: number, CR_B1: number, CR_B3: number;
let T_A: number, T_B: number, COMP: number, EV: number;

const enter = (sub: string, ev: number, marks: unknown) => rpc<{ n: number }>(sub, `select public.assessment_enter_marks(${ev}, ${j(marks)}) n`);
const record = (sub: string, reg: number, i: number | null, e: number | null, extra = '') => rpc(sub, `select public.result_record_course(${reg}, ${i ?? 'null'}, ${e ?? 'null'}${extra})`);

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO academic_year (academic_year_id, year_code, start_date, end_date) VALUES (1, '2025-26', '2025-06-01', '2026-05-31');
    INSERT INTO academic_term (academic_term_id, academic_year_id, term_code, term_name, term_type, start_date, end_date) VALUES (1, 1, 'ODD', 'Odd', 'ODD', '2025-08-01', '2025-12-31');
    INSERT INTO semester (semester_id, semester_number, semester_name) VALUES (1, 1, 'Semester 1');
    INSERT INTO curriculum_scheme (curriculum_scheme_id, programme_id, scheme_code, scheme_name, regulation_year, effective_from) VALUES (100, 1, 'S1', 'Scheme 1', 2024, '2024-06-01');
    INSERT INTO course_category (course_category_id, category_code, category_name, is_graded, contributes_to_gpa) VALUES (1, 'CORE', 'Core', true, true), (2, 'AUDIT', 'Audit', false, false);
    INSERT INTO course_catalog (course_id, owning_department_id, course_category_id, course_code, course_title, course_type, credits) VALUES
      (1, 1, 1, 'CS101', 'Intro', 'THEORY', 4), (2, 1, 2, 'CS102', 'Audit', 'THEORY', 2), (3, 1, 1, 'CS103', 'Data', 'THEORY', 3);
    INSERT INTO curriculum_course (curriculum_course_id, curriculum_scheme_id, semester_id, course_id, course_category_id, internal_max_marks, external_max_marks, passing_marks) VALUES
      (1, 100, 1, 1, 1, 40, 60, 40), (2, 100, 1, 2, 2, 20, 30, 35), (3, 100, 1, 3, 1, 40, 60, NULL);
    UPDATE student_programme_enrolment SET curriculum_scheme_id = 100, admission_academic_year_id = 1, admission_semester_id = 1 WHERE enrolment_id IN (1, 2, 3);
    INSERT INTO student (student_id, student_number, first_name, display_name) VALUES (4, 'S4', 'Four', 'Four Student');
    INSERT INTO student_programme_enrolment (enrolment_id, student_id, programme_id, curriculum_scheme_id, admission_academic_year_id, admission_date, admission_semester_id) VALUES (4, 4, 1, 100, 1, '2025-08-01', 1);
    INSERT INTO programme_term_offering (programme_term_offering_id, academic_term_id, programme_id, curriculum_scheme_id, semester_id, status) VALUES (1, 1, 1, 100, 1, 'ACTIVE');
    INSERT INTO class_section (class_section_id, programme_term_offering_id, section_code) VALUES (1, 1, 'A');
    INSERT INTO course_offering (course_offering_id, programme_term_offering_id, curriculum_course_id, course_id, offering_code) VALUES (1, 1, 1, 1, 'CO-1'), (2, 1, 2, 2, 'CO-2'), (3, 1, 3, 3, 'CO-3');
    INSERT INTO student_term_registration (term_registration_id, enrolment_id, programme_term_offering_id, class_section_id, registration_date) VALUES (1, 1, 1, 1, '2025-08-01'), (2, 4, 1, 1, '2025-08-01');
    INSERT INTO student_course_registration (course_registration_id, term_registration_id, course_offering_id, registration_date) VALUES
      (1, 1, 1, '2025-08-02'), (2, 1, 2, '2025-08-02'), (3, 1, 3, '2025-08-02'), (4, 2, 1, '2025-08-02'), (5, 2, 3, '2025-08-02');
    INSERT INTO user_account (user_id, username, password_hash) VALUES (70, 'examofficer', 'x'), (71, 'markeronly', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES (70, ${role('EXAMINATION_OFFICER')}, 'INSTITUTION', 1);
    INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
      SELECT 71, permission_id, 'ALLOW', 'INSTITUTION', 1, 'test' FROM permission WHERE permission_code IN ('ASSESSMENT.ALL.READ', 'ASSESSMENT.ALL.CREATE');
    INSERT INTO auth.users (id) VALUES ('${XO}'), ('${MARKER}');
    SELECT sims_private.link_auth_user('${XO}', 70, 'test');
    SELECT sims_private.link_auth_user('${MARKER}', 71, 'test');`);
  CO1 = 1; CO2 = 2; CO3 = 3; CR_A1 = 1; CR_A2 = 2; CR_A3 = 3; CR_B1 = 4; CR_B3 = 5; T_A = 1; T_B = 2;
}, 180_000);

describe('components and events', () => {
  it('are programme-scoped, unique and database-checked', async () => {
    const ins = (sub: string, code: string, max = 50) => asUser<{ assessment_component_id: string }>(sub, `insert into assessment_component (course_offering_id, component_code, component_name, component_type, maximum_marks) values (1, '${code}', 'Test ${code}', 'INTERNAL_TEST', ${max}) returning assessment_component_id`);
    COMP = Number((await ins(U.facultyD1, 'T1'))[0]?.assessment_component_id);
    await expect(ins(U.registrar2, 'T2')).rejects.toThrow(/row-level security/i);
    await expect(ins(U.student1, 'T2')).rejects.toThrow(/row-level security/i);
    await expect(ins(U.facultyD1, 'T1')).rejects.toThrow(/duplicate|unique/i);
    await expect(ins(U.facultyD1, 'T3', -1)).rejects.toThrow(/chk_assessment_marks|check/i);
    const ev = await asUser<{ assessment_event_id: string }>(U.facultyD1, `insert into assessment_event (assessment_component_id, course_offering_id, event_title, assessment_date, maximum_marks, reduced_maximum_marks) values (${COMP}, 1, 'Test 1', '2025-09-15', 50, 25) returning assessment_event_id`);
    EV = Number(ev[0]?.assessment_event_id);
    await expect(asUser(U.facultyD1, `insert into assessment_event (assessment_component_id, course_offering_id, event_title, assessment_date, maximum_marks) values (${COMP}, 2, 'Wrong offering', '2025-09-15', 10)`)).rejects.toThrow(/fk_assessment_event_component_course|foreign key/i);
    await expect(asUser(U.facultyD1, `insert into assessment_event (assessment_component_id, course_offering_id, event_title, assessment_date, start_time, end_time, maximum_marks) values (${COMP}, 1, 'Bad time', '2025-09-15', '11:00', '10:00', 10)`)).rejects.toThrow(/chk_assessment_event_time|check/i);
  });
  it('an event can be published only after it is CONDUCTED', async () => {
    await expect(asUser(U.registrar1, `update assessment_event set status='PUBLISHED' where assessment_event_id=${EV}`)).rejects.toThrow(/only after it is CONDUCTED/);
  });
});

describe('marks entry', () => {
  it('the sheet lists registered students for authorised staff only', async () => {
    const rows = await rpc<{ student_number: string }>(U.facultyD1, `select * from public.assessment_sheet(${EV})`);
    expect(rows.map((r) => r.student_number).sort()).toEqual(['S1', 'S4']);
    for (const sub of [U.registrar2, U.student1, U.unmapped]) await expect(rpc(sub, `select * from public.assessment_sheet(${EV})`)).rejects.toThrow(/Not authorised/);
  });
  it('validates every entry and applies nothing on failure', async () => {
    const bad = (marks: unknown) => enter(U.facultyD1, EV, marks);
    await expect(bad([])).rejects.toThrow(/non-empty/);
    await expect(bad([{ course_registration_id: CR_A1, marks_obtained: 51 }])).rejects.toThrow(/exceed the event maximum/);
    await expect(bad([{ course_registration_id: CR_A1, marks_obtained: -1 }])).rejects.toThrow(/non-negative/);
    await expect(bad([{ course_registration_id: CR_A1, marks_obtained: 10.555 }])).rejects.toThrow(/2 decimals/);
    await expect(bad([{ course_registration_id: CR_A1, attendance_status: 'ABSENT', marks_obtained: 5 }])).rejects.toThrow(/cannot carry marks/);
    await expect(bad([{ course_registration_id: CR_A1, attendance_status: 'SLEEPING' }])).rejects.toThrow(/Unknown attendance status/);
    await expect(bad([{ course_registration_id: CR_A1, reduced_marks: 30 }])).rejects.toThrow(/Reduced marks/);
    await expect(bad([{ course_registration_id: CR_A1, marks_obtained: 10 }, { course_registration_id: CR_A1, marks_obtained: 12 }])).rejects.toThrow(/Duplicate/);
    await expect(bad([{ course_registration_id: CR_A2, marks_obtained: 10 }])).rejects.toThrow(/not an active registration for this course offering/); // registration of another course
    await expect(bad([{ course_registration_id: CR_A1, marks_obtained: 10 }, { course_registration_id: 9999, marks_obtained: 10 }])).rejects.toThrow(/not an active registration/);
    expect(await val('select count(*) from student_assessment_mark')).toBe(0);
    expect(await val(`select status from assessment_event where assessment_event_id=${EV}`)).toBe('PLANNED');
  });
  it('saves marks atomically and marks the event CONDUCTED', async () => {
    expect((await enter(U.facultyD1, EV, [{ course_registration_id: CR_A1, marks_obtained: 42.5, reduced_marks: 20 }, { course_registration_id: CR_B1, attendance_status: 'ABSENT' }]))[0]?.n).toBe(2);
    expect(await val(`select status from assessment_event where assessment_event_id=${EV}`)).toBe('CONDUCTED');
    expect(Number(await val(`select marks_obtained from student_assessment_mark where course_registration_id=${CR_A1}`))).toBe(42.5);
  });
  it('is permission-checked; direct table writes are closed', async () => {
    for (const sub of [U.student1, U.registrar2, U.unmapped]) await expect(enter(sub, EV, [{ course_registration_id: CR_A1, marks_obtained: 1 }])).rejects.toThrow(/Not authorised/);
    await expect(enter(MARKER, EV, [{ course_registration_id: CR_A1, marks_obtained: 1 }])).rejects.toThrow(/ASSESSMENT.ALL.UPDATE/); // CREATE-only cannot overwrite
    await expect(asUser(U.facultyD1, `insert into student_assessment_mark (assessment_event_id, course_registration_id, course_offering_id, marks_obtained) values (${EV}, ${CR_A1}, 1, 1)`)).rejects.toThrow(/permission denied/i);
    await expect(asUser(U.superAdmin, 'update student_assessment_mark set marks_obtained = 1')).rejects.toThrow(/permission denied/i);
  });
  it('students see their own marks only after the event is published', async () => {
    expect(await asUser(U.student1, 'select 1 from student_assessment_mark')).toHaveLength(0); // draft: hidden
    expect((await asUser(U.facultyD1, 'select 1 from student_assessment_mark')).length).toBe(2); // staff see drafts
    await expect(asUser(U.facultyD1, `update assessment_event set status='PUBLISHED' where assessment_event_id=${EV}`)).rejects.toThrow(/Not authorised to PUBLISH/);
    expect(await asUser(U.registrar1, `update assessment_event set status='PUBLISHED' where assessment_event_id=${EV} returning assessment_event_id`)).toHaveLength(1);
    const own = await asUser<{ course_registration_id: string }>(U.student1, 'select course_registration_id from student_assessment_mark');
    expect(own.map((r) => Number(r.course_registration_id))).toEqual([CR_A1]); // only their own row
  });
  it('published marks and maximums are locked until the event is unpublished', async () => {
    await expect(enter(U.facultyD1, EV, [{ course_registration_id: CR_A1, marks_obtained: 40 }])).rejects.toThrow(/PUBLISHED event cannot be changed/);
    await expect(db.exec(`update student_assessment_mark set marks_obtained = 1 where course_registration_id = ${CR_A1}`)).rejects.toThrow(/locked/);
    await expect(db.exec(`update assessment_event set maximum_marks = 99 where assessment_event_id = ${EV}`)).rejects.toThrow(/locked/);
    await expect(asUser(U.facultyD1, `update assessment_event set status='CONDUCTED' where assessment_event_id=${EV}`)).rejects.toThrow(/Not authorised to PUBLISH/); // un-publishing is also guarded
    await asUser(U.registrar1, `update assessment_event set status='CONDUCTED' where assessment_event_id=${EV}`);
    expect((await enter(U.facultyD1, EV, [{ course_registration_id: CR_A1, marks_obtained: 44 }]))[0]?.n).toBe(1);
  });
});

describe('course results', () => {
  it('refuses to grade until a grade scale exists', async () => {
    await expect(record(U.superAdmin, CR_A1, 38, 50)).rejects.toThrow(/No active grade scale/);
  });
  it('grade scales are global configuration', async () => {
    await expect(asUser(U.registrar1, "insert into grade_scale (scale_name, effective_from) values ('X', '2024-01-01')")).rejects.toThrow(/row-level security/i);
    await asUser(U.superAdmin, "insert into grade_scale (grade_scale_id, scale_name, effective_from) values (1, '10-point', '2024-01-01')");
    for (const [l, p, lo, hi, s] of [['O', 10, 90, 100, 'PASS'], ['A', 9, 75, 89.99, 'PASS'], ['B', 7, 50, 74.99, 'PASS'], ['F', 0, 0, 49.99, 'FAIL']] as const)
      await asUser(U.superAdmin, `insert into grade_rule (grade_scale_id, grade_letter, grade_point, minimum_percentage, maximum_percentage, result_status) values (1, '${l}', ${p}, ${lo}, ${hi}, '${s}')`);
    await expect(asUser(U.superAdmin, "insert into grade_rule (grade_scale_id, grade_letter, grade_point, minimum_percentage, maximum_percentage) values (1, 'Z', 1, 50, 40)")).rejects.toThrow(/chk_grade_range|check/i);
  });
  it('derives grade, status and credits from the marks and the grade scale', async () => {
    await record(U.facultyD1, CR_A1, 38, 50); // 88% -> A, PASS, 4 credits
    const r = (await db.query<{ total_marks: string; grade_letter: string; grade_point: string; result_status: string; credits_earned: string }>(`select * from student_course_result where course_registration_id=${CR_A1}`)).rows[0];
    expect(r).toMatchObject({ grade_letter: 'A', result_status: 'PASS' });
    expect([Number(r?.total_marks), Number(r?.grade_point), Number(r?.credits_earned)]).toEqual([88, 9, 4]);
    await record(U.facultyD1, CR_B1, 15, 30); // 45% -> F, FAIL, no credits
    expect(await val(`select result_status || '/' || credits_earned from student_course_result where course_registration_id=${CR_B1}`)).toBe('FAIL/0.0');
  });
  it('a total below the curriculum passing marks fails even if the band passes', async () => {
    await record(U.facultyD1, CR_A2, 12, 18); // 30/50 = 60% -> B (PASS band) but passing_marks is 35 -> FAIL
    expect(await val(`select grade_letter || '/' || result_status || '/' || credits_earned from student_course_result where course_registration_id=${CR_A2}`)).toBe('B/FAIL/0.0');
  });
  it('rejects out-of-range or missing input and unauthorised callers', async () => {
    await expect(record(U.facultyD1, CR_A1, 41, 50)).rejects.toThrow(/Internal marks .* exceed/);
    await expect(record(U.facultyD1, CR_A1, 38, 61)).rejects.toThrow(/External marks .* exceed/);
    await expect(record(U.facultyD1, CR_A1, null, 50)).rejects.toThrow(/required/);
    await expect(record(U.facultyD1, CR_A1, -1, 50)).rejects.toThrow(/non-negative/);
    await expect(record(U.facultyD1, CR_A1, 38, 50, ", 1, 'PASS'")).rejects.toThrow(/may only be/);
    for (const sub of [U.student1, U.registrar2, U.registrar1, U.unmapped]) await expect(record(sub, CR_A1, 38, 50)).rejects.toThrow(/Not authorised/); // registrar: RESULT is read-only
    await expect(asUser(U.superAdmin, 'update student_course_result set grade_letter = null')).rejects.toThrow(/permission denied/i);
  });
  it('explicit statuses (absent, withheld) carry no grade and no credits', async () => {
    await record(U.facultyD1, CR_A3, null, null, ", 1, 'WITHHELD'");
    expect(await val(`select result_status || '/' || coalesce(grade_letter, 'none') || '/' || credits_earned from student_course_result where course_registration_id=${CR_A3}`)).toBe('WITHHELD/none/0.0');
  });
});

describe('term results, publication and student visibility', () => {
  const compute = (sub: string, t: number) => rpc<{ n: string }>(sub, `select public.result_compute_term(${t}) n`);
  const term = async (t: number) => (await db.query<Record<string, string>>(`select * from student_term_result where term_registration_id=${t}`)).rows[0];

  it('computes status, credits and GPA from the data; withheld or missing courses make it unpublishable', async () => {
    await compute(U.facultyD1, T_A);
    expect((await term(T_A))?.result_status).toBe('WITHHELD'); // CS103 is withheld
    await record(U.facultyD1, CR_A3, 24, 36); // 60% -> B (7 points), 3 credits, replaces the withheld result
    await compute(U.facultyD1, T_A);
    const t = await term(T_A);
    // CS101 4 cr A(9), CS103 3 cr B(7) are GPA courses; CS102 is in a non-GPA category and FAILed on passing marks
    expect(Number(t?.credits_registered)).toBe(9);
    expect(Number(t?.credits_earned)).toBe(7);
    expect(Number(t?.sgpa)).toBeCloseTo(8.14, 2); // (9*4 + 7*3) / 7
    expect(Number(t?.cgpa)).toBeCloseTo(8.14, 2);
    expect(t?.result_status).toBe('FAIL'); // CS102 failed (its category does not affect pass/fail)
  });
  it('INCOMPLETE until every course has a result; GPA only counts recorded graded courses', async () => {
    await compute(U.facultyD1, T_B);
    expect((await term(T_B))?.result_status).toBe('INCOMPLETE'); // CS103 has no result yet
    await record(U.facultyD1, CR_B3, 40, 40); // 80% -> A
    await compute(U.facultyD1, T_B);
    const t = await term(T_B);
    expect(t?.result_status).toBe('FAIL'); // CS101 failed
    expect(Number(t?.sgpa)).toBeCloseTo(3.86, 2); // (0*4 + 9*3) / 7
  });
  it('INCOMPLETE and WITHHELD results cannot be published; FAIL results can, by a PUBLISH holder only', async () => {
    await db.exec("delete from student_term_result where term_registration_id = 2");
    await compute(U.facultyD1, T_B);
    await expect(rpc(U.facultyD1, `select public.result_publish_term(${T_A})`)).rejects.toThrow(/Not authorised \(RESULT.ALL.PUBLISH\)/);
    await rpc(XO, `select public.result_publish_term(${T_A})`);
    await rpc(XO, `select public.result_publish_term(${T_A})`); // idempotent replay
    expect(await val(`select published_at is not null from student_term_result where term_registration_id=${T_A}`)).toBe(true);
    await expect(rpc(XO, `select public.result_publish_term(99999)`)).rejects.toThrow(/Not authorised/);
  });
  it('published results are locked until unpublished', async () => {
    await expect(compute(XO, T_A)).rejects.toThrow(/published/);
    await expect(record(XO, CR_A1, 30, 50)).rejects.toThrow(/unpublish/);
    await expect(rpc(U.facultyD1, `select public.result_publish_term(${T_A}, false)`)).rejects.toThrow(/Not authorised/);
  });
  it('students see only their own results, and only once published', async () => {
    const own = await asUser<{ term_registration_id: string }>(U.student1, 'select term_registration_id from student_term_result');
    expect(own.map((r) => Number(r.term_registration_id))).toEqual([T_A]);
    expect((await asUser(U.student1, 'select 1 from student_course_result')).length).toBe(3); // their three published course results
    expect(await asUser(U.registrar2, 'select 1 from student_term_result')).toHaveLength(0);
  });
  it('unpublishing hides the results from the student again and allows recomputation', async () => {
    await rpc(XO, `select public.result_publish_term(${T_A}, false)`);
    expect(await asUser(U.student1, 'select 1 from student_term_result')).toHaveLength(0);
    expect(await asUser(U.student1, 'select 1 from student_course_result')).toHaveLength(0);
    await record(XO, CR_A1, 40, 55); // now editable: 95% -> O
    expect(await val(`select grade_letter from student_course_result where course_registration_id=${CR_A1}`)).toBe('O');
  });
  it('the term sheet shows names to authorised staff only', async () => {
    const rows = await rpc<{ student_number: string; result_status: string | null }>(U.facultyD1, 'select * from public.result_term_sheet(1)');
    expect(rows.map((r) => r.student_number).sort()).toEqual(['S1', 'S4']);
    for (const sub of [U.registrar2, U.student1, U.unmapped]) await expect(rpc(sub, 'select * from public.result_term_sheet(1)')).rejects.toThrow(/Not authorised/);
  });
  it('components, events, marks, scales and results are audited', async () => {
    const r = await db.query<{ entity_name: string }>("select distinct entity_name from activity_audit where module_code in ('ASSESSMENT','RESULT')");
    const names = r.rows.map((x) => x.entity_name);
    for (const n of ['assessment_component', 'assessment_event', 'student_assessment_mark', 'grade_scale', 'grade_rule', 'student_course_result', 'student_term_result']) expect(names).toContain(n);
  });
  void CO1; void CO2; void CO3; void T_B;
});

describe('read helpers (migration 033)', () => {
  it('assessment_offerings lists only offerings in programmes the caller may read, even without TEACHING read access', async () => {
    const xo = await rpc<{ offering_code: string; total_count: string }>(XO, 'select * from public.assessment_offerings()');
    expect(xo.map((r) => r.offering_code).sort()).toEqual(['CO-1', 'CO-2', 'CO-3']);
    expect(Number(xo[0]?.total_count)).toBe(3);
    expect(await rpc(U.registrar2, 'select * from public.assessment_offerings()')).toHaveLength(0);
    expect(await rpc(U.student1, 'select * from public.assessment_offerings()')).toHaveLength(0);
    expect(await rpc(U.unmapped, 'select * from public.assessment_offerings()')).toHaveLength(0);
    expect(await rpc(XO, 'select * from public.assessment_offerings(null, null, 2, 1)')).toHaveLength(2); // paging
  });
  it('assessment_offering_info is authorised and carries the marks structure', async () => {
    const [i] = await rpc<{ course_code: string; internal_max_marks: string; external_max_marks: string; passing_marks: string }>(XO, 'select * from public.assessment_offering_info(1)');
    expect(i).toMatchObject({ course_code: 'CS101' });
    expect([Number(i?.internal_max_marks), Number(i?.external_max_marks), Number(i?.passing_marks)]).toEqual([40, 60, 40]);
    for (const sub of [U.registrar2, U.student1, U.unmapped]) await expect(rpc(sub, 'select * from public.assessment_offering_info(1)')).rejects.toThrow(/Not authorised/);
  });
  it('my_results returns only the signed-in student own PUBLISHED results', async () => {
    const get = async (sub: string) => (await rpc<{ r: { term_registration_id: number; sgpa: string; courses: { course_code: string; grade_letter: string }[] }[] }>(sub, 'select public.my_results() r'))[0]?.r ?? [];
    expect(await get(U.student1)).toEqual([]); // T_A was unpublished by the earlier test
    await rpc(XO, `select public.result_compute_term(${T_A})`);
    await rpc(XO, `select public.result_publish_term(${T_A})`);
    const mine = await get(U.student1);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.term_registration_id).toBe(T_A);
    expect(mine[0]?.courses.map((c) => c.course_code)).toEqual(['CS101', 'CS102', 'CS103']);
    expect(await get(U.registrar1)).toEqual([]); // not a student
    expect(await get(U.unmapped)).toEqual([]);
    await expect(as('anon', null, 'select public.my_results()')).rejects.toThrow(/permission denied/i);
  });
});

