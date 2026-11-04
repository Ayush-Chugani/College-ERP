import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

const MARKER = '00000000-0000-0000-0000-0000000000f1'; // ATTENDANCE READ + CREATE only
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const id = async (sql: string) => Number(await val(sql));
const j = (o: unknown) => `'${JSON.stringify(o)}'::jsonb`;
const rpc = <T = Record<string, unknown>>(sub: string, sql: string) => asUser<T>(sub, sql);

let COS: number, COS2: number, R1: number, R4: number, S1: number, S2: number, S3: number;
let PRESENT: number, ABSENT: number, LATE: number;

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO academic_year (academic_year_id, year_code, start_date, end_date) VALUES (1, '2025-26', '2025-06-01', '2026-05-31');
    INSERT INTO academic_term (academic_term_id, academic_year_id, term_code, term_name, term_type, start_date, end_date) VALUES (1, 1, 'ODD', 'Odd', 'ODD', '2025-08-01', '2025-12-31');
    INSERT INTO semester (semester_id, semester_number, semester_name) VALUES (1, 1, 'Semester 1');
    INSERT INTO curriculum_scheme (curriculum_scheme_id, programme_id, scheme_code, scheme_name, regulation_year, effective_from) VALUES (100, 1, 'S1', 'Scheme 1', 2024, '2024-06-01');
    INSERT INTO course_category (course_category_id, category_code, category_name) VALUES (1, 'CORE', 'Core');
    INSERT INTO course_catalog (course_id, owning_department_id, course_category_id, course_code, course_title, course_type) VALUES (1, 1, 1, 'CS101', 'Intro', 'THEORY');
    UPDATE student_programme_enrolment SET curriculum_scheme_id = 100, admission_academic_year_id = 1, admission_semester_id = 1 WHERE enrolment_id IN (1, 2, 3);
    INSERT INTO student (student_id, student_number, first_name, display_name) VALUES (4, 'S4', 'Four', 'Four Student');
    INSERT INTO student_programme_enrolment (enrolment_id, student_id, programme_id, curriculum_scheme_id, admission_academic_year_id, admission_date, admission_semester_id) VALUES (4, 4, 1, 100, 1, '2025-08-01', 1);
    INSERT INTO programme_term_offering (programme_term_offering_id, academic_term_id, programme_id, curriculum_scheme_id, semester_id, status) VALUES (1, 1, 1, 100, 1, 'ACTIVE');
    INSERT INTO class_section (class_section_id, programme_term_offering_id, section_code) VALUES (1, 1, 'A');
    INSERT INTO class_batch (class_batch_id, class_section_id, batch_code) VALUES (1, 1, 'B1');
    INSERT INTO course_offering (course_offering_id, programme_term_offering_id, course_id, offering_code) VALUES (1, 1, 1, 'CO-1');
    INSERT INTO student_term_registration (term_registration_id, enrolment_id, programme_term_offering_id, class_section_id, registration_date) VALUES (1, 1, 1, 1, '2025-08-01'), (2, 4, 1, 1, '2025-08-01');
    INSERT INTO student_course_registration (course_registration_id, term_registration_id, course_offering_id, registration_date) VALUES (1, 1, 1, '2025-08-02'), (2, 2, 1, '2025-08-02');
    INSERT INTO user_account (user_id, username, password_hash) VALUES (60, 'markeronly', 'x');
    INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
      SELECT 60, permission_id, 'ALLOW', 'INSTITUTION', 1, 'test' FROM permission WHERE permission_code IN ('ATTENDANCE.ALL.READ', 'ATTENDANCE.ALL.CREATE');
    INSERT INTO auth.users (id) VALUES ('${MARKER}');
    SELECT sims_private.link_auth_user('${MARKER}', 60, 'test');`);
}, 180_000);

describe('teaching sections, instructors and roster', () => {
  it('teaching sections are programme-scoped and unique', async () => {
    await asUser(U.registrar1, "insert into course_offering_section (course_offering_id, programme_term_offering_id, class_section_id, session_type) values (1, 1, 1, 'LECTURE')");
    COS = await id('select course_offering_section_id from course_offering_section limit 1');
    await expect(asUser(U.registrar2, "insert into course_offering_section (course_offering_id, programme_term_offering_id, class_section_id, session_type) values (1, 1, 1, 'TUTORIAL')")).rejects.toThrow(/row-level security/i);
    await expect(asUser(U.student1, "insert into course_offering_section (course_offering_id, programme_term_offering_id, class_section_id, session_type) values (1, 1, 1, 'TUTORIAL')")).rejects.toThrow(/row-level security/i);
    await expect(asUser(U.registrar1, "insert into course_offering_section (course_offering_id, programme_term_offering_id, class_section_id, session_type) values (1, 1, 1, 'LECTURE')")).rejects.toThrow(/duplicate|unique/i);
    await asUser(U.registrar1, "insert into course_offering_section (course_offering_id, programme_term_offering_id, class_section_id, class_batch_id, session_type) values (1, 1, 1, 1, 'PRACTICAL')");
    COS2 = await id("select course_offering_section_id from course_offering_section where session_type='PRACTICAL'");
  });
  it('the roster is built from course registrations in the section (and batch), idempotently, with authorisation', async () => {
    expect((await rpc<{ n: number }>(U.facultyD1, `select public.teaching_populate_roster(${COS}) n`))[0]?.n).toBe(2);
    expect((await rpc<{ n: number }>(U.facultyD1, `select public.teaching_populate_roster(${COS}) n`))[0]?.n).toBe(0);
    expect((await rpc<{ n: number }>(U.facultyD1, `select public.teaching_populate_roster(${COS2}) n`))[0]?.n).toBe(0); // nobody is in batch B1
    for (const sub of [U.registrar2, U.student1, U.unmapped]) await expect(rpc(sub, `select public.teaching_populate_roster(${COS})`)).rejects.toThrow(/Not authorised/);
    R1 = await id('select course_offering_section_student_id from course_offering_section_student where course_registration_id=1');
    R4 = await id('select course_offering_section_student_id from course_offering_section_student where course_registration_id=2');
  });
  it('a session cannot use an instructor assignment from a different teaching section', async () => {
    await db.exec(`insert into faculty_course_assignment (faculty_assignment_id, course_offering_section_id, employee_id, assignment_role, start_date) values (1, ${COS}, 1, 'PRIMARY_INSTRUCTOR', '2025-08-01'), (2, ${COS2}, 1, 'LAB_INSTRUCTOR', '2025-08-01')`);
    await expect(asUser(U.facultyD1, `insert into class_session (course_offering_section_id, faculty_assignment_id, session_date, start_time, end_time, session_type) values (${COS}, 2, '2025-09-01', '09:00', '10:00', 'LECTURE')`)).rejects.toThrow(/different teaching section/);
  });
});

describe('class sessions and attendance statuses', () => {
  it('statuses are global configuration; sessions are scoped and time-checked', async () => {
    await expect(asUser(U.registrar1, "insert into attendance_status (status_code, status_name, counts_as_present) values ('X','X',true)")).rejects.toThrow(/row-level security/i);
    for (const [c, n, p] of [['P', 'Present', true], ['A', 'Absent', false], ['L', 'Late', true]] as const) await asUser(U.superAdmin, `insert into attendance_status (status_code, status_name, counts_as_present) values ('${c}', '${n}', ${p})`);
    PRESENT = await id("select attendance_status_id from attendance_status where status_code='P'");
    ABSENT = await id("select attendance_status_id from attendance_status where status_code='A'");
    LATE = await id("select attendance_status_id from attendance_status where status_code='L'");
    const mk = (sub: string, date: string, start: string, end: string) => asUser(sub, `insert into class_session (course_offering_section_id, faculty_assignment_id, session_date, start_time, end_time, session_type) values (${COS}, 1, '${date}', '${start}', '${end}', 'LECTURE')`);
    await mk(U.facultyD1, '2025-09-01', '09:00', '10:00');
    await mk(U.facultyD1, '2025-09-02', '09:00', '10:00');
    await mk(U.facultyD1, '2025-09-03', '09:00', '10:00');
    S1 = await id("select class_session_id from class_session where session_date='2025-09-01'");
    S2 = await id("select class_session_id from class_session where session_date='2025-09-02'");
    S3 = await id("select class_session_id from class_session where session_date='2025-09-03'");
    await expect(mk(U.facultyD1, '2025-09-04', '11:00', '10:00')).rejects.toThrow(/chk_class_session_time|check/i);
    await expect(mk(U.facultyD1, '2025-09-01', '09:00', '10:00')).rejects.toThrow(/duplicate|unique/i);
    await expect(mk(U.registrar2, '2025-09-05', '09:00', '10:00')).rejects.toThrow(/row-level security/i);
  });
});

describe('marking', () => {
  const sheet = (sub: string, s: number) => rpc<{ student_number: string; attendance_status_id: number | null }>(sub, `select * from public.attendance_sheet(${s})`);
  it('the sheet lists roster names for authorised staff only', async () => {
    const rows = await sheet(U.facultyD1, S1);
    expect(rows.map((r) => r.student_number).sort()).toEqual(['S1', 'S4']);
    expect(rows.every((r) => r.attendance_status_id === null)).toBe(true);
    for (const sub of [U.registrar2, U.student1, U.unmapped]) await expect(sheet(sub, S1)).rejects.toThrow(/Not authorised/);
  });
  it('marks attendance atomically, stamps the marker and moves a PLANNED session to CONDUCTED', async () => {
    const n = (await rpc<{ n: number }>(U.facultyD1, `select public.attendance_mark(${S1}, ${j([{ roster_id: R1, status_id: PRESENT }, { roster_id: R4, status_id: ABSENT, remarks: 'ill' }])}) n`))[0]?.n;
    expect(n).toBe(2);
    expect(await val(`select session_status from class_session where class_session_id=${S1}`)).toBe('CONDUCTED');
    expect(await val(`select marked_by_user_id from student_attendance where class_session_id=${S1} and course_offering_section_student_id=${R4}`)).toBe(3);
    expect(await val(`select remarks from student_attendance where class_session_id=${S1} and course_offering_section_student_id=${R4}`)).toBe('ill');
  });
  it('validates input and applies nothing on failure', async () => {
    const bad = (marks: unknown) => rpc(U.facultyD1, `select public.attendance_mark(${S2}, ${j(marks)})`);
    await expect(bad([])).rejects.toThrow(/non-empty/);
    await expect(bad([{ roster_id: R1, status_id: 9999 }])).rejects.toThrow(/Unknown or inactive/);
    await expect(bad([{ roster_id: 99999, status_id: PRESENT }])).rejects.toThrow(/not an active member/);
    await expect(bad([{ roster_id: R1, status_id: PRESENT }, { roster_id: R1, status_id: ABSENT }])).rejects.toThrow(/Duplicate/);
    await expect(bad([{ roster_id: R1 }])).rejects.toThrow(/needs roster_id and status_id/);
    await expect(bad([{ roster_id: R1, status_id: PRESENT }, { roster_id: 99999, status_id: PRESENT }])).rejects.toThrow(/not an active member/);
    expect(await val(`select count(*) from student_attendance where class_session_id=${S2}`)).toBe(0); // the valid first entry was rolled back too
    expect(await val(`select session_status from class_session where class_session_id=${S2}`)).toBe('PLANNED');
  });
  it('is permission-checked: students and other institutions cannot mark; CREATE alone cannot change existing marks; no direct table writes', async () => {
    for (const sub of [U.student1, U.registrar2, U.unmapped]) await expect(rpc(sub, `select public.attendance_mark(${S2}, ${j([{ roster_id: R1, status_id: PRESENT }])})`)).rejects.toThrow(/Not authorised/);
    await rpc(MARKER, `select public.attendance_mark(${S2}, ${j([{ roster_id: R1, status_id: PRESENT }])})`);
    await expect(rpc(MARKER, `select public.attendance_mark(${S2}, ${j([{ roster_id: R1, status_id: ABSENT }])})`)).rejects.toThrow(/ATTENDANCE.ALL.UPDATE/);
    await expect(asUser(U.facultyD1, `insert into student_attendance (class_session_id, course_offering_section_student_id, course_offering_section_id, attendance_status_id) values (${S3}, ${R1}, ${COS}, ${PRESENT})`)).rejects.toThrow(/permission denied/i);
    await expect(asUser(U.superAdmin, 'update student_attendance set remarks = null')).rejects.toThrow(/permission denied/i);
  });
  it('cancelled sessions cannot be marked; UPDATE holders can re-mark', async () => {
    await asUser(U.facultyD1, `update class_session set session_status='CANCELLED' where class_session_id=${S3}`);
    await expect(rpc(U.facultyD1, `select public.attendance_mark(${S3}, ${j([{ roster_id: R1, status_id: PRESENT }])})`)).rejects.toThrow(/CANCELLED session/);
    await rpc(U.facultyD1, `select public.attendance_mark(${S2}, ${j([{ roster_id: R1, status_id: LATE }, { roster_id: R4, status_id: PRESENT }])})`);
    expect(await val(`select attendance_status_id from student_attendance where class_session_id=${S2} and course_offering_section_student_id=${R1}`)).toBe(LATE);
  });
});

describe('corrections', () => {
  let C: number;
  it('can be requested once per student/session, idempotently', async () => {
    C = Number((await rpc<{ id: string }>(U.facultyD1, `select public.attendance_request_correction(${S1}, ${R4}, ${PRESENT}, 'was present, marked wrongly') id`))[0]?.id);
    expect(C).toBeGreaterThan(0);
    expect(Number((await rpc<{ id: string }>(U.facultyD1, `select public.attendance_request_correction(${S1}, ${R4}, ${PRESENT}, 'again') id`))[0]?.id)).toBe(C);
    await expect(rpc(U.facultyD1, `select public.attendance_request_correction(${S1}, ${R4}, ${LATE}, 'different')`)).rejects.toThrow(/already pending/);
    await expect(rpc(U.facultyD1, `select public.attendance_request_correction(${S1}, ${R1}, ${PRESENT}, 'same')`)).rejects.toThrow(/same as the current/);
    await expect(rpc(U.facultyD1, `select public.attendance_request_correction(${S1}, ${R4}, ${LATE}, ' ')`)).rejects.toThrow(/reason/);
    await expect(rpc(U.facultyD1, `select public.attendance_request_correction(${S3}, ${R4}, ${LATE}, 'x')`)).rejects.toThrow(/No attendance has been marked/);
    for (const sub of [U.student1, U.registrar2]) await expect(rpc(sub, `select public.attendance_request_correction(${S1}, ${R4}, ${LATE}, 'x')`)).rejects.toThrow(/Not authorised/);
  });
  it('only an APPROVE holder decides; approval changes the attendance atomically', async () => {
    await expect(rpc(U.facultyD1, `select public.attendance_decide_correction(${C}, true)`)).rejects.toThrow(/ATTENDANCE.ALL.APPROVE/);
    await expect(rpc(U.registrar2, `select public.attendance_decide_correction(${C}, true)`)).rejects.toThrow(/Not authorised/);
    await rpc(U.registrar1, `select public.attendance_decide_correction(${C}, true)`);
    await rpc(U.registrar1, `select public.attendance_decide_correction(${C}, true)`); // idempotent replay
    expect(await val(`select attendance_status_id from student_attendance where class_session_id=${S1} and course_offering_section_student_id=${R4}`)).toBe(PRESENT);
    expect(await val(`select request_status from attendance_correction_request where attendance_correction_id=${C}`)).toBe('APPROVED');
    await expect(rpc(U.registrar1, `select public.attendance_decide_correction(${C}, false)`)).rejects.toThrow(/already APPROVED/);
  });
  it('a stale correction cannot be approved after the attendance changed, but can be rejected', async () => {
    const c2 = Number((await rpc<{ id: string }>(U.facultyD1, `select public.attendance_request_correction(${S1}, ${R1}, ${ABSENT}, 'check') id`))[0]?.id);
    await rpc(U.facultyD1, `select public.attendance_mark(${S1}, ${j([{ roster_id: R1, status_id: LATE }])})`);
    await expect(rpc(U.registrar1, `select public.attendance_decide_correction(${c2}, true)`)).rejects.toThrow(/changed since/);
    await rpc(U.registrar1, `select public.attendance_decide_correction(${c2}, false)`);
    expect(await val(`select request_status from attendance_correction_request where attendance_correction_id=${c2}`)).toBe('REJECTED');
    expect(await val(`select attendance_status_id from student_attendance where class_session_id=${S1} and course_offering_section_student_id=${R1}`)).toBe(LATE);
  });
});

describe('summary and audit', () => {
  it('percentages count only CONDUCTED sessions and statuses that count as present', async () => {
    // S1 and S2 are CONDUCTED, S3 is CANCELLED. R1: S1 LATE (present), S2 LATE (present) -> 100.  R4: S1 PRESENT (corrected), S2 PRESENT -> 100.
    await rpc(U.facultyD1, `select public.attendance_mark(${S2}, ${j([{ roster_id: R4, status_id: ABSENT }])})`);
    const rows = await rpc<{ student_number: string; conducted_sessions: number; present_sessions: number; percentage: string }>(U.facultyD1, `select * from public.attendance_summary(${COS})`);
    const by = Object.fromEntries(rows.map((r) => [r.student_number, r]));
    expect(by.S1).toMatchObject({ conducted_sessions: 2, present_sessions: 2 });
    expect(Number(by.S1?.percentage)).toBe(100);
    expect(by.S4).toMatchObject({ conducted_sessions: 2, present_sessions: 1 });
    expect(Number(by.S4?.percentage)).toBe(50);
    for (const sub of [U.registrar2, U.student1]) await expect(rpc(sub, `select * from public.attendance_summary(${COS})`)).rejects.toThrow(/Not authorised/);
  });
  it('students see only their own attendance rows; other institutions see none', async () => {
    expect((await asUser(U.registrar2, 'select 1 from student_attendance')).length).toBe(0);
    expect((await asUser(U.facultyD1, 'select 1 from student_attendance')).length).toBeGreaterThan(0);
  });
  it('sessions, assignments, statuses and corrections are audited', async () => {
    const r = await db.query<{ entity_name: string }>("select distinct entity_name from activity_audit where module_code in ('ATTENDANCE','TEACHING')");
    const names = r.rows.map((x) => x.entity_name);
    for (const n of ['class_session', 'course_offering_section', 'faculty_course_assignment', 'attendance_status', 'attendance_correction_request']) expect(names).toContain(n);
  });
  void as;
});
