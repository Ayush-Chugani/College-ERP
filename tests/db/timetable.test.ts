import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const rpc = <T = Record<string, unknown>>(sub: string, sql: string) => asUser<T>(sub, sql);

const COS = 1;
const COS2 = 2;
const FA1 = 1;
const FA2 = 2;

/** Insert a timetable entry as `sub`. `extra` is an optional "column=value" pair (room_id=1, faculty_assignment_id=2). */
const entry = (sub: string, cos: number, day: number, slot: number, extra = '', from = '2025-08-01', to: string | null = null) => {
  const [col, v] = extra ? extra.split('=') : [null, null];
  return asUser(
    sub,
    `insert into timetable_session (course_offering_section_id, ${col ? `${col}, ` : ''}day_of_week, time_slot_id, effective_from, effective_to) values (${cos}, ${v ? `${v}, ` : ''}${day}, ${slot}, '${from}', ${to ? `'${to}'` : 'null'})`,
  );
};

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO academic_year (academic_year_id, year_code, start_date, end_date) VALUES (1, '2025-26', '2025-06-01', '2026-05-31');
    INSERT INTO academic_term (academic_term_id, academic_year_id, term_code, term_name, term_type, start_date, end_date) VALUES (1, 1, 'ODD', 'Odd', 'ODD', '2025-08-01', '2025-12-31');
    INSERT INTO semester (semester_id, semester_number, semester_name) VALUES (1, 1, 'Semester 1');
    INSERT INTO curriculum_scheme (curriculum_scheme_id, programme_id, scheme_code, scheme_name, regulation_year, effective_from) VALUES (100, 1, 'S1', 'Scheme 1', 2024, '2024-06-01');
    INSERT INTO course_category (course_category_id, category_code, category_name) VALUES (1, 'CORE', 'Core');
    INSERT INTO course_catalog (course_id, owning_department_id, course_category_id, course_code, course_title, course_type) VALUES (1, 1, 1, 'CS101', 'Intro', 'THEORY'), (2, 1, 1, 'CS102', 'Second', 'THEORY');
    INSERT INTO programme_term_offering (programme_term_offering_id, academic_term_id, programme_id, curriculum_scheme_id, semester_id, status) VALUES (1, 1, 1, 100, 1, 'ACTIVE');
    INSERT INTO class_section (class_section_id, programme_term_offering_id, section_code) VALUES (1, 1, 'A');
    INSERT INTO course_offering (course_offering_id, programme_term_offering_id, course_id, offering_code) VALUES (1, 1, 1, 'CO-1'), (2, 1, 2, 'CO-2');
    INSERT INTO course_offering_section (course_offering_section_id, course_offering_id, programme_term_offering_id, class_section_id, session_type) VALUES (1, 1, 1, 1, 'LECTURE'), (2, 2, 1, 1, 'LECTURE');
    INSERT INTO faculty_course_assignment (faculty_assignment_id, course_offering_section_id, employee_id, assignment_role, start_date) VALUES (1, 1, 1, 'PRIMARY_INSTRUCTOR', '2025-08-01'), (2, 2, 1, 'PRIMARY_INSTRUCTOR', '2025-08-01');
    INSERT INTO building (building_id, campus_id, building_code, building_name) VALUES (1, 1, 'B1', 'Block 1'), (2, 2, 'B2', 'Block 2');
    INSERT INTO room (room_id, building_id, room_code, room_type) VALUES (1, 1, '101', 'CLASSROOM'), (2, 1, '102', 'CLASSROOM'), (3, 2, '201', 'CLASSROOM');
    INSERT INTO time_slot (time_slot_id, campus_id, slot_code, start_time, end_time, is_break) VALUES
      (1, 1, 'P1', '09:00', '10:00', false), (2, 1, 'P2', '10:00', '11:00', false), (3, 1, 'BRK', '11:00', '11:15', true), (4, 2, 'Q1', '09:00', '10:00', false), (5, 1, 'LONG', '09:30', '10:30', false);
  `);
}, 180_000);

describe('authorisation', () => {
  it('anon cannot call the RPCs', async () => {
    await expect(as('anon', null, 'select * from public.timetable_slots()')).rejects.toThrow(/permission denied/i);
    await expect(as('anon', null, `select public.timetable_generate_sessions(${COS}, '2025-09-01', '2025-09-07')`)).rejects.toThrow(/permission denied/i);
  });
  it('students and out-of-scope staff cannot write entries', async () => {
    await expect(entry(U.student1, COS, 1, 1)).rejects.toThrow(/row-level security/);
    await expect(entry(U.registrar2, COS, 1, 1)).rejects.toThrow(/row-level security/);
  });
  it('read helpers refuse out-of-scope callers identically for unknown and forbidden ids', async () => {
    for (const q of ['timetable_entries(1)', 'timetable_sections(1)', 'timetable_offering_info(1)', 'timetable_entries(99999)']) {
      await expect(rpc(U.registrar2, `select * from public.${q}`)).rejects.toThrow(/Not authorised/);
      await expect(rpc(U.student1, `select * from public.${q}`)).rejects.toThrow(/Not authorised/);
    }
    await expect(rpc(U.registrar2, `select * from public.timetable_assignments(${COS})`)).rejects.toThrow(/Not authorised/);
  });
});

describe('guard rules', () => {
  it('a valid entry is accepted; times, room campus, break slots and assignments are checked', async () => {
    await entry(U.registrar1, COS, 1, 1, `faculty_assignment_id=${FA1}`); // Monday P1, instructor 1
    await expect(entry(U.registrar1, COS, 1, 1, 'room_id=1')).rejects.toThrow(/already has a class/);
    await expect(entry(U.registrar1, COS2, 2, 3)).rejects.toThrow(/break slot/);
    await expect(entry(U.registrar1, COS2, 2, 1, 'room_id=3')).rejects.toThrow(/different campus/);
    await expect(entry(U.registrar1, COS2, 2, 1, `faculty_assignment_id=${FA1}`)).rejects.toThrow(/different teaching section/);
    await expect(entry(U.registrar1, COS2, 2, 1, '', '2025-09-01', '2025-08-01')).rejects.toThrow(/end date/);
  });
  it('no double booking of a room, an instructor or a section; back-to-back is fine', async () => {
    await entry(U.registrar1, COS2, 3, 1, 'room_id=1'); // Wednesday P1 room 101
    await expect(entry(U.registrar1, COS, 3, 1, 'room_id=1')).rejects.toThrow(/room is already booked/);
    await expect(entry(U.registrar1, COS, 3, 5, 'room_id=1')).rejects.toThrow(/room is already booked/); // overlapping times, different slot
    await entry(U.registrar1, COS, 3, 2, 'room_id=1'); // back to back: allowed
    await entry(U.registrar1, COS, 3, 1, 'room_id=2'); // another room: allowed
    // instructor 1 teaches COS (FA1) on Monday P1; COS2 (FA2, same employee) on Monday P1 must clash
    await expect(entry(U.registrar1, COS2, 1, 1, `faculty_assignment_id=${FA2}`)).rejects.toThrow(/instructor already teaches/);
    await entry(U.registrar1, COS2, 1, 2, `faculty_assignment_id=${FA2}`); // different time: fine
  });
  it('disjoint effective periods do not clash; an update ignores its own row', async () => {
    await entry(U.registrar1, COS2, 4, 1, 'room_id=1', '2025-08-01', '2025-09-30');
    await entry(U.registrar1, COS, 4, 1, 'room_id=1', '2025-10-01', '2025-12-31');
    await expect(entry(U.registrar1, COS, 4, 1, 'room_id=1', '2025-09-15', '2025-10-15')).rejects.toThrow(/already (booked|has)/);
    await asUser(U.registrar1, "update timetable_session set effective_to = '2025-09-29' where day_of_week = 4 and effective_to = '2025-09-30'");
    expect(String(await val("select effective_to::text from timetable_session where day_of_week = 4 and effective_from = '2025-08-01'"))).toMatch(/2025-09-29/);
  });
  it('changes are audited', async () => {
    expect(Number(await val("select count(*) from activity_audit where module_code = 'TIMETABLE'"))).toBeGreaterThan(0);
  });
});

describe('class sessions from the timetable', () => {
  it('generates PLANNED sessions on matching weekdays, idempotently, honouring the effective period', async () => {
    // COS: Mon P1 (open ended), Wed P2 room 1, Wed P1 room 2, Thu P1 room 1 from 2025-10-01
    const first = (await rpc<{ n: number }>(U.registrar1, `select public.timetable_generate_sessions(${COS}, '2025-09-01', '2025-09-14') n`))[0]?.n;
    expect(Number(first)).toBe(6); // Mon x2 + Wed x2 (two entries) ... Thursday entry starts in October
    expect(Number(await val(`select count(*) from class_session where course_offering_section_id = ${COS} and session_status = 'PLANNED' and timetable_session_id is not null`))).toBe(6);
    const again = (await rpc<{ n: number }>(U.registrar1, `select public.timetable_generate_sessions(${COS}, '2025-09-01', '2025-09-14') n`))[0]?.n;
    expect(Number(again)).toBe(0);
    const mon = await db.query<{ d: string }>(`select session_date::text d from class_session where course_offering_section_id = ${COS} and extract(isodow from session_date) = 1 order by 1`);
    expect(mon.rows.map((r) => r.d)).toEqual(['2025-09-01', '2025-09-08']);
    await rpc(U.registrar1, `select public.timetable_generate_sessions(${COS}, '2025-09-25', '2025-10-05')`);
    expect(Number(await val(`select count(*) from class_session where course_offering_section_id = ${COS} and extract(isodow from session_date) = 4 and session_date < '2025-10-01'`))).toBe(0);
    expect(Number(await val(`select count(*) from class_session where course_offering_section_id = ${COS} and extract(isodow from session_date) = 4 and session_date = '2025-10-02'`))).toBe(1);
  });
  it('validates the range and authorisation', async () => {
    await expect(rpc(U.registrar1, `select public.timetable_generate_sessions(${COS}, '2025-09-10', '2025-09-01')`)).rejects.toThrow(/valid date range/);
    await expect(rpc(U.registrar1, `select public.timetable_generate_sessions(${COS}, '2025-01-01', '2026-06-01')`)).rejects.toThrow(/at most 367/);
    for (const sub of [U.student1, U.registrar2, U.unmapped]) await expect(rpc(sub, `select public.timetable_generate_sessions(${COS}, '2025-09-01', '2025-09-07')`)).rejects.toThrow(/Not authorised/);
  });
  it('registrars cannot delete entries (no DELETE permission); an entry that generated sessions cannot be deleted even by a super admin', async () => {
    await asUser(U.registrar1, 'delete from timetable_session where day_of_week = 1 and course_offering_section_id = 1');
    expect(Number(await val('select count(*) from timetable_session where day_of_week = 1 and course_offering_section_id = 1'))).toBe(1);
    await expect(asUser(U.superAdmin, 'delete from timetable_session where day_of_week = 1 and course_offering_section_id = 1')).rejects.toThrow(/foreign key|violates/);
  });
});

describe('read helpers', () => {
  it('return labelled data to timetable staff', async () => {
    const e = await rpc<{ course_label: string; slot_code: string; room_label: string | null; instructor_name: string | null }>(U.registrar1, 'select * from public.timetable_entries(1)');
    expect(e.length).toBeGreaterThan(5);
    expect(e.some((r) => r.course_label === 'CS101 — Intro' && r.slot_code === 'P1' && r.instructor_name)).toBe(true);
    expect(e.some((r) => r.room_label === 'B1-101')).toBe(true);
    expect((await rpc(U.registrar1, 'select * from public.timetable_sections(1)')).length).toBe(2);
    expect((await rpc<{ n: number }>(U.registrar1, 'select count(*)::int n from public.timetable_offerings()'))[0]?.n).toBe(1);
    expect((await rpc(U.registrar1, `select * from public.timetable_assignments(${COS})`)).length).toBe(1);
  });
  it('slots and rooms are limited to campuses in scope', async () => {
    const s = await rpc<{ campus_id: number }>(U.registrar1, 'select * from public.timetable_slots()');
    expect(new Set(s.map((r) => Number(r.campus_id)))).toEqual(new Set([1]));
    const r = await rpc<{ room_label: string }>(U.registrar1, 'select * from public.timetable_rooms()');
    expect(r.map((x) => x.room_label).sort()).toEqual(['B1-101', 'B1-102']);
    expect(await rpc(U.student1, 'select * from public.timetable_slots()')).toEqual([]);
  });
});
