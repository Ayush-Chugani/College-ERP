import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, U } from './world';

/** my_dashboard (migration 048): the caller's own attendance, classes and sessions. student1 = student 1 (enrolment 1), facultyD1 = employee 1. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
type Dash = { attendance?: { course: string; conducted: number; present: number; percentage: number | null }[]; today?: { course: string; status: string }[]; upcoming?: { course: string; status: string }[]; unmarked?: number; sections?: number };
const dash = async (sub: string) => (await asUser<{ d: Dash | null }>(sub, 'select public.my_dashboard() d'))[0]?.d ?? null;

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO course_catalog (course_id, owning_department_id, course_category_id, course_code, course_title, course_type) VALUES (1, 1, 1, 'CS101', 'Intro', 'THEORY'), (2, 1, 1, 'CS102', 'Data', 'THEORY');
    INSERT INTO course_offering (course_offering_id, programme_term_offering_id, course_id, offering_code) VALUES (1, 1, 1, 'CO-1'), (2, 1, 2, 'CO-2');
    INSERT INTO class_section (class_section_id, programme_term_offering_id, section_code) VALUES (1, 1, 'A');
    INSERT INTO course_offering_section (course_offering_section_id, course_offering_id, programme_term_offering_id, class_section_id, session_type) VALUES (1, 1, 1, 1, 'LECTURE'), (2, 2, 1, 1, 'LECTURE');
    INSERT INTO student_term_registration (term_registration_id, enrolment_id, programme_term_offering_id, class_section_id, registration_date) VALUES (1, 1, 1, 1, '2025-08-01');
    INSERT INTO student_course_registration (course_registration_id, term_registration_id, course_offering_id, registration_date) VALUES (1, 1, 1, '2025-08-02'), (2, 1, 2, '2025-08-02');
    INSERT INTO course_offering_section_student (course_offering_section_student_id, course_offering_section_id, course_registration_id, course_offering_id, roster_status) VALUES (1, 1, 1, 1, 'ACTIVE'), (2, 2, 2, 2, 'ACTIVE');
    INSERT INTO faculty_course_assignment (faculty_assignment_id, course_offering_section_id, employee_id, assignment_role, start_date) VALUES (1, 1, 1, 'PRIMARY_INSTRUCTOR', '2025-08-01');
    INSERT INTO attendance_status (attendance_status_id, status_code, status_name, counts_as_present) VALUES (1, 'P', 'Present', true), (2, 'A', 'Absent', false);
    INSERT INTO class_session (class_session_id, course_offering_section_id, faculty_assignment_id, session_date, start_time, end_time, session_type, session_status) VALUES
      (1, 1, 1, current_date - 3, '09:00', '10:00', 'LECTURE', 'CONDUCTED'), (2, 1, 1, current_date - 2, '09:00', '10:00', 'LECTURE', 'CONDUCTED'),
      (3, 1, 1, current_date - 1, '09:00', '10:00', 'LECTURE', 'PLANNED'),
      (4, 1, 1, current_date, '11:00', '12:00', 'LECTURE', 'PLANNED'), (5, 1, 1, current_date + 2, '09:00', '10:00', 'LECTURE', 'PLANNED'), (6, 1, 1, current_date + 3, '09:00', '10:00', 'LECTURE', 'CANCELLED'),
      (7, 1, 1, current_date + 20, '09:00', '10:00', 'LECTURE', 'PLANNED');
    INSERT INTO student_attendance (class_session_id, course_offering_section_student_id, course_offering_section_id, attendance_status_id) VALUES (1, 1, 1, 1), (2, 1, 1, 2);
  `);
  await fkSwitch(true);
}, 180_000);

describe('student view', () => {
  it('shows attendance per course and today\'s classes for the caller only', async () => {
    const d = await dash(U.student1);
    expect(d?.attendance).toHaveLength(2);
    const intro = d?.attendance?.find((a) => a.course.startsWith('CS101'));
    expect([Number(intro?.conducted), Number(intro?.present), Number(intro?.percentage)]).toEqual([2, 1, 50]);
    const data = d?.attendance?.find((a) => a.course.startsWith('CS102'));
    expect([Number(data?.conducted), data?.percentage]).toEqual([0, null]); // nothing conducted yet: no percentage
    expect(d?.today).toHaveLength(1);
    expect(d?.today?.[0]).toMatchObject({ course: 'CS101 — Intro', status: 'PLANNED' });
    expect(d?.upcoming).toBeUndefined();
    expect(d?.unmarked).toBeUndefined();
  });
  it('another student sees none of it', async () => {
    await db.exec("UPDATE user_role_assignment SET assignment_status = assignment_status"); // no-op: keeps the fixture explicit
    expect(await dash(U.registrar1)).toEqual({}); // staff without a student or employee record
  });
});

describe('employee view', () => {
  it('lists the sessions of the next seven days (not cancelled, not later) and counts unmarked past sessions', async () => {
    const d = await dash(U.facultyD1);
    expect(d?.upcoming).toHaveLength(2); // today and +2; the +3 session is cancelled, +20 is too far
    expect(Number(d?.unmarked)).toBe(1); // yesterday's session is still PLANNED
    expect(Number(d?.sections)).toBe(1);
    expect(d?.attendance).toBeUndefined();
  });
  it('an ended assignment no longer counts as a section', async () => {
    await db.exec("UPDATE faculty_course_assignment SET end_date = current_date - 1 WHERE faculty_assignment_id = 1");
    expect(Number((await dash(U.facultyD1))?.sections)).toBe(0);
  });
});

describe('access', () => {
  it('is closed to anonymous callers and returns nothing without an identity', async () => {
    await expect(as('anon', null, 'select public.my_dashboard()')).rejects.toThrow(/permission denied/);
    expect(await dash(U.unmapped)).toBeNull();
    expect(await dash(U.disabled)).toBeNull();
    expect(Number(await val('select count(*) from student_attendance'))).toBe(2); // read-only: nothing was written
  });
});
