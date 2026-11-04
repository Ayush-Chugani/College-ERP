import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

/** Feedback (migration 037). Embedded Postgres, single connection: logic, authorisation, anonymity; not concurrency. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const rpc = <T = Record<string, unknown>>(sub: string, sql: string) => asUser<T>(sub, sql);
const j = (o: unknown) => `'${JSON.stringify(o)}'::jsonb`;
const submit = (sub: string, cycle: number, co: number | null, fa: number | null, answers: unknown) =>
  rpc<{ t: string }>(sub, `select public.feedback_submit(${cycle}, ${co ?? 'null'}, ${fa ?? 'null'}, ${j(answers)}) t`);

// ids: questionnaire 1 = anonymous COURSE (items 1 rating, 2 single choice, 3 text optional); questionnaire 2 = named FACULTY (item 4 rating)
const Q_ANON_CYCLE = 1;
const Q_NAMED_CYCLE = 2;

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO academic_year (academic_year_id, year_code, start_date, end_date) VALUES (1, '2025-26', '2025-06-01', '2026-05-31');
    INSERT INTO academic_term (academic_term_id, academic_year_id, term_code, term_name, term_type, start_date, end_date) VALUES (1, 1, 'ODD', 'Odd', 'ODD', '2025-08-01', '2025-12-31'), (2, 1, 'EVEN', 'Even', 'EVEN', '2026-01-01', '2026-05-31');
    INSERT INTO semester (semester_id, semester_number, semester_name) VALUES (1, 1, 'Semester 1');
    INSERT INTO curriculum_scheme (curriculum_scheme_id, programme_id, scheme_code, scheme_name, regulation_year, effective_from) VALUES (100, 1, 'S1', 'Scheme 1', 2024, '2024-06-01');
    INSERT INTO course_category (course_category_id, category_code, category_name) VALUES (1, 'CORE', 'Core');
    INSERT INTO course_catalog (course_id, owning_department_id, course_category_id, course_code, course_title, course_type) VALUES (1, 1, 1, 'CS101', 'Intro', 'THEORY'), (2, 1, 1, 'CS102', 'Second', 'THEORY');
    INSERT INTO programme_term_offering (programme_term_offering_id, academic_term_id, programme_id, curriculum_scheme_id, semester_id, status) VALUES (1, 1, 1, 100, 1, 'ACTIVE');
    INSERT INTO class_section (class_section_id, programme_term_offering_id, section_code) VALUES (1, 1, 'A');
    INSERT INTO course_offering (course_offering_id, programme_term_offering_id, course_id, offering_code) VALUES (1, 1, 1, 'CO-1'), (2, 1, 2, 'CO-2');
    INSERT INTO course_offering_section (course_offering_section_id, course_offering_id, programme_term_offering_id, class_section_id, session_type) VALUES (1, 1, 1, 1, 'LECTURE');
    INSERT INTO faculty_course_assignment (faculty_assignment_id, course_offering_section_id, employee_id, assignment_role, start_date) VALUES (1, 1, 1, 'PRIMARY_INSTRUCTOR', '2025-08-01');
    INSERT INTO student_term_registration (term_registration_id, enrolment_id, programme_term_offering_id, class_section_id, registration_date) VALUES (1, 1, 1, 1, '2025-08-01');
    INSERT INTO student_course_registration (course_registration_id, term_registration_id, course_offering_id, registration_date) VALUES (1, 1, 1, '2025-08-02');

    INSERT INTO feedback_question_category (feedback_category_id, category_code, category_name) VALUES (1, 'TEACH', 'Teaching');
    INSERT INTO feedback_question (feedback_question_id, feedback_category_id, question_text, response_type) VALUES
      (1, 1, 'Rate the course', 'RATING'), (2, 1, 'Pace of the course', 'SINGLE_CHOICE'), (3, 1, 'Any comments?', 'TEXT'), (4, 1, 'Rate the instructor', 'RATING'), (5, 1, 'Resources used', 'MULTIPLE_CHOICE');
    INSERT INTO feedback_choice (feedback_choice_id, feedback_question_id, choice_text, score, display_order) VALUES
      (1, 2, 'Too fast', 1, 1), (2, 2, 'Just right', 3, 2), (3, 2, 'Too slow', 1, 3), (4, 5, 'Slides', NULL, 1), (5, 5, 'Videos', NULL, 2);
    INSERT INTO feedback_questionnaire (questionnaire_id, questionnaire_code, questionnaire_name, questionnaire_type, is_anonymous, status) VALUES
      (1, 'QA', 'Anonymous course', 'COURSE', true, 'ACTIVE'), (2, 'QN', 'Named faculty', 'FACULTY', false, 'ACTIVE'), (3, 'QD', 'Draft', 'COURSE', true, 'DRAFT');
    INSERT INTO feedback_questionnaire_item (questionnaire_item_id, questionnaire_id, feedback_question_id, display_order, is_required) VALUES
      (1, 1, 1, 1, true), (2, 1, 2, 2, true), (3, 1, 3, 3, false), (4, 2, 4, 1, true), (5, 1, 5, 4, false);
    INSERT INTO feedback_cycle (feedback_cycle_id, questionnaire_id, academic_term_id, cycle_name, start_at, end_at, result_visibility, status) VALUES
      (1, 1, 1, 'Anon cycle', now() - interval '1 day', now() + interval '10 days', 'ADMIN_ONLY', 'OPEN'),
      (2, 2, 1, 'Named cycle', now() - interval '1 day', now() + interval '10 days', 'FACULTY', 'OPEN'),
      (3, 1, 2, 'Other term', now() - interval '1 day', now() + interval '10 days', 'HIDDEN', 'OPEN'),
      (4, 1, 1, 'Expired', now() - interval '10 days', now() - interval '1 day', 'HIDDEN', 'OPEN');
  `);
}, 180_000);

describe('configuration guards', () => {
  it('a cycle cannot open without an ACTIVE questionnaire that has questions; transitions are one-way', async () => {
    await expect(db.exec("insert into feedback_cycle (questionnaire_id, academic_term_id, cycle_name, start_at, end_at, status) values (3, 1, 'x', now(), now() + interval '1 day', 'OPEN')")).rejects.toThrow(/ACTIVE questionnaire/);
    await db.exec("insert into feedback_questionnaire (questionnaire_id, questionnaire_code, questionnaire_name, questionnaire_type, status) values (9, 'QE', 'Empty', 'COURSE', 'ACTIVE')");
    await expect(db.exec("insert into feedback_cycle (questionnaire_id, academic_term_id, cycle_name, start_at, end_at, status) values (9, 1, 'x', now(), now() + interval '1 day', 'OPEN')")).rejects.toThrow(/no questions/);
    await db.exec("insert into feedback_cycle (feedback_cycle_id, questionnaire_id, academic_term_id, cycle_name, start_at, end_at, status) values (9, 9, 1, 'sched', now(), now() + interval '1 day', 'SCHEDULED')");
    await expect(db.exec("update feedback_cycle set status = 'CLOSED' where feedback_cycle_id = 9")).rejects.toThrow(/cannot become/);
    await db.exec("update feedback_cycle set status = 'CANCELLED' where feedback_cycle_id = 9");
    await expect(db.exec("update feedback_cycle set status = 'OPEN' where feedback_cycle_id = 9")).rejects.toThrow(/cannot become/);
  });
  it('questions of a questionnaire used by an open cycle are locked; unused ones are editable', async () => {
    await expect(db.exec('delete from feedback_questionnaire_item where questionnaire_item_id = 1')).rejects.toThrow(/cannot be changed/);
    await expect(db.exec("insert into feedback_questionnaire_item (questionnaire_id, feedback_question_id, display_order) values (1, 4, 9)")).rejects.toThrow(/cannot be changed/);
    await expect(db.exec("update feedback_questionnaire set is_anonymous = false where questionnaire_id = 1")).rejects.toThrow(/cannot be changed/);
    await db.exec("insert into feedback_questionnaire_item (questionnaire_item_id, questionnaire_id, feedback_question_id, display_order) values (6, 3, 1, 1)"); // draft questionnaire is free
  });
  it('configuration is global-only and audited', async () => {
    await expect(asUser(U.registrar1, "insert into feedback_question_category (category_code, category_name) values ('X', 'X')")).rejects.toThrow(/row-level security/);
    await expect(asUser(U.student1, "update feedback_cycle set status = 'CLOSED' where feedback_cycle_id = 3")).resolves.toEqual([]); // no rows visible to update
    expect(Number(await val("select count(*) from activity_audit where module_code = 'FEEDBACK'"))).toBeGreaterThan(0);
  });
});

describe('student tasks', () => {
  it('lists open cycles in registered terms with course and instructor, not other terms or expired cycles', async () => {
    const t = await rpc<{ feedback_cycle_id: string; course_label: string | null; instructor_name: string | null; submitted: boolean }>(U.student1, 'select * from public.feedback_my_tasks()');
    expect(t.map((r) => [Number(r.feedback_cycle_id), r.course_label, r.instructor_name])).toEqual([[1, 'CS101 — Intro', null], [2, 'CS101 — Intro', 'Emp One']]);
    expect(t.every((r) => r.submitted === false)).toBe(true);
  });
  it('non-students get nothing', async () => {
    expect(await rpc(U.registrar1, 'select * from public.feedback_my_tasks()')).toEqual([]);
    expect(await rpc(U.unmapped, 'select * from public.feedback_my_tasks()')).toEqual([]);
  });
  it('the form lists questions with choices, readable by any active member', async () => {
    const f = await rpc<{ question_text: string; choices: { id: number }[] }>(U.student1, 'select * from public.feedback_form(1)');
    expect(f.map((r) => r.question_text)).toEqual(['Rate the course', 'Pace of the course', 'Any comments?', 'Resources used']);
    expect(f[1]?.choices.length).toBe(3);
  });
});

describe('submitting', () => {
  const ok = [{ questionnaire_item_id: 1, score: 4 }, { questionnaire_item_id: 2, choice_id: 2 }, { questionnaire_item_id: 3, text: ' Good course ' }, { questionnaire_item_id: 5, choice_ids: [4, 5] }];

  it('anon cannot call; only students can submit', async () => {
    await expect(as('anon', null, `select public.feedback_submit(1, 1, null, '[]'::jsonb)`)).rejects.toThrow(/permission denied/i);
    await expect(submit(U.registrar1, Q_ANON_CYCLE, 1, null, ok)).rejects.toThrow(/Only students/);
  });
  it('validates cycle, course, instructor and answers; nothing is stored on failure', async () => {
    await expect(submit(U.student1, 99, 1, null, ok)).rejects.toThrow(/Unknown feedback cycle/);
    await expect(submit(U.student1, 4, 1, null, ok)).rejects.toThrow(/not open/); // expired window
    await expect(submit(U.student1, 3, 1, null, ok)).rejects.toThrow(/not registered|not open/); // other term
    await expect(submit(U.student1, Q_ANON_CYCLE, null, null, ok)).rejects.toThrow(/course is required/);
    await expect(submit(U.student1, Q_ANON_CYCLE, 2, null, ok)).rejects.toThrow(/not registered/); // CO-2 not registered
    await expect(submit(U.student1, Q_ANON_CYCLE, 1, 1, ok)).rejects.toThrow(/not about an instructor/);
    await expect(submit(U.student1, Q_NAMED_CYCLE, 1, null, [{ questionnaire_item_id: 4, score: 3 }])).rejects.toThrow(/does not teach/);
    await expect(submit(U.student1, Q_ANON_CYCLE, 1, null, [ok[0], ok[1], { questionnaire_item_id: 1, score: 2 }])).rejects.toThrow(/answered twice/);
    await expect(submit(U.student1, Q_ANON_CYCLE, 1, null, [{ questionnaire_item_id: 1, score: 6 }, ok[1]])).rejects.toThrow(/1 to 5/);
    await expect(submit(U.student1, Q_ANON_CYCLE, 1, null, [{ questionnaire_item_id: 1, score: 2.5 }, ok[1]])).rejects.toThrow(/1 to 5/);
    await expect(submit(U.student1, Q_ANON_CYCLE, 1, null, [ok[0], { questionnaire_item_id: 2, choice_id: 4 }])).rejects.toThrow(/does not belong/);
    await expect(submit(U.student1, Q_ANON_CYCLE, 1, null, [ok[0], ok[1], { questionnaire_item_id: 4, score: 3 }])).rejects.toThrow(/not part of this questionnaire/);
    await expect(submit(U.student1, Q_ANON_CYCLE, 1, null, [ok[0]])).rejects.toThrow(/required question/);
    await expect(submit(U.student1, Q_ANON_CYCLE, 1, null, [ok[0], ok[1], { questionnaire_item_id: 3, text: '   ' }])).rejects.toThrow(/written answer/);
    await expect(submit(U.student1, Q_ANON_CYCLE, 1, null, [ok[0], ok[1], { questionnaire_item_id: 5, choice_ids: [4, 4] }])).rejects.toThrow(/do not belong/);
    await expect(submit(U.student1, Q_ANON_CYCLE, 1, null, 'nope')).rejects.toThrow(/array/);
    expect(Number(await val('select count(*) from feedback_response'))).toBe(0);
  });
  it('an anonymous submission stores no identity and a day-truncated time; a second attempt is refused', async () => {
    const token = (await submit(U.student1, Q_ANON_CYCLE, 1, null, ok))[0]?.t ?? '';
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    const row = (await db.query<{ term_registration_id: string | null; at: string; course_offering_id: string }>(`select term_registration_id, submitted_at::text at, course_offering_id from feedback_response where response_token = '${token}'`)).rows[0];
    expect(row?.term_registration_id).toBeNull();
    expect(row?.at).toMatch(/ 00:00:00/);
    expect(Number(await val('select count(*) from feedback_response_item'))).toBe(4);
    expect(String(await val("select text_response from feedback_response_item where questionnaire_item_id = 3"))).toBe('Good course');
    expect(String(await val("select text_response from feedback_response_item where questionnaire_item_id = 5"))).toBe('4,5');
    expect(Number(await val('select numeric_score from feedback_response_item where questionnaire_item_id = 2'))).toBe(3);
    await expect(submit(U.student1, Q_ANON_CYCLE, 1, null, ok)).rejects.toThrow(/already submitted/);
    expect(Number(await val('select count(*) from feedback_response'))).toBe(1);
    const t = await rpc<{ feedback_cycle_id: string; submitted: boolean }>(U.student1, 'select * from public.feedback_my_tasks()');
    expect(t.find((r) => Number(r.feedback_cycle_id) === 1)?.submitted).toBe(true);
    expect(t.find((r) => Number(r.feedback_cycle_id) === 2)?.submitted).toBe(false);
  });
  it('nobody but a global admin can read an anonymous response row; clients cannot write responses or the submission register', async () => {
    expect(await rpc(U.registrar1, 'select * from feedback_response')).toEqual([]);
    expect(await rpc(U.student1, 'select * from feedback_response')).toEqual([]);
    await expect(asUser(U.student1, "insert into feedback_response (feedback_cycle_id, course_offering_id) values (1, 1)")).rejects.toThrow(/permission denied/);
    await expect(asUser(U.student1, 'select * from sims_private.feedback_submission')).rejects.toThrow(/permission denied/);
    await expect(asUser(U.superAdmin, 'select * from sims_private.feedback_submission')).rejects.toThrow(/permission denied/);
  });
  it('a named submission keeps the registration and the student can read it', async () => {
    await submit(U.student1, Q_NAMED_CYCLE, 1, 1, [{ questionnaire_item_id: 4, score: 5 }]);
    const own = await rpc<{ term_registration_id: string }>(U.student1, 'select * from feedback_response where feedback_cycle_id = 2');
    expect(own.map((r) => Number(r.term_registration_id))).toEqual([1]);
    await expect(submit(U.student1, Q_NAMED_CYCLE, 1, 1, [{ questionnaire_item_id: 4, score: 5 }])).rejects.toThrow(/already submitted/);
  });
  it('closing the cycle or answering after the window stops submissions; responses lock the questionnaire', async () => {
    await expect(db.exec("update feedback_questionnaire set status = 'DRAFT' where questionnaire_id = 1")).rejects.toThrow(/cannot be changed/);
    await db.exec("update feedback_cycle set status = 'CLOSED' where feedback_cycle_id = 2");
    await expect(submit(U.student1, Q_NAMED_CYCLE, 1, 1, [{ questionnaire_item_id: 4, score: 5 }])).rejects.toThrow(/not open|already/);
    await expect(db.exec("update feedback_cycle set status = 'OPEN' where feedback_cycle_id = 2")).rejects.toThrow(/cannot become/);
  });
});

describe('results', () => {
  beforeAll(async () => {
    // Nine more anonymous responses (raw inserts stand in for other students): ratings 1..5, choices, texts.
    for (let n = 1; n <= 9; n++) {
      await db.exec(`
        INSERT INTO feedback_response (feedback_response_id, feedback_cycle_id, course_offering_id, faculty_assignment_id, submitted_at, response_token) VALUES (${100 + n}, 1, 1, 1, date_trunc('day', now()), 'tok-${n}');
        INSERT INTO feedback_response_item (feedback_response_id, questionnaire_item_id, numeric_score) VALUES (${100 + n}, 1, ${(n % 5) + 1});
        INSERT INTO feedback_response_item (feedback_response_id, questionnaire_item_id, feedback_choice_id, numeric_score) VALUES (${100 + n}, 2, ${n % 2 ? 2 : 1}, ${n % 2 ? 3 : 1});
        INSERT INTO feedback_response_item (feedback_response_id, questionnaire_item_id, text_response) VALUES (${100 + n}, 3, 'comment ${n}');`);
    }
  });
  const results = async (sub: string, cycle = 1, co: number | null = null) =>
    (await rpc<{ r: Record<string, unknown> }>(sub, `select public.feedback_results(${cycle}, ${co ?? 'null'}) r`))[0]?.r as {
      suppressed: boolean; response_count: number; questions: { average: string | null; answered: number; distribution: { label: string; count: number }[]; texts: string[] }[];
    };

  it('anon and unmapped users are refused', async () => {
    await expect(as('anon', null, 'select public.feedback_results(1)')).rejects.toThrow(/permission denied/i);
    await expect(rpc(U.unmapped, 'select public.feedback_results(1)')).rejects.toThrow(/Not authorised/);
    await expect(rpc(U.registrar1, 'select public.feedback_results(999)')).rejects.toThrow(/Not authorised/);
  });
  it('ADMIN_ONLY: programme readers see aggregates and texts; other institutions, students and the rated instructor do not', async () => {
    const r = await results(U.registrar1);
    expect(r.suppressed).toBe(false);
    expect(r.response_count).toBe(10);
    expect(r.questions[0]?.answered).toBe(10);
    expect(Number(r.questions[1]?.average)).toBeGreaterThan(0);
    expect(r.questions[2]?.texts.length).toBe(10);
    expect(r.questions[1]?.distribution.map((d) => d.label).sort()).toEqual(['Just right', 'Too fast']);
    expect(r.questions.find((q) => q.distribution.some((d) => d.label === 'Slides'))?.distribution).toEqual([{ label: 'Slides', count: 1 }, { label: 'Videos', count: 1 }]);
    for (const sub of [U.registrar2, U.student1]) expect((await results(sub)).response_count).toBe(0);
    expect((await results(U.registrar2)).suppressed).toBe(true);
    // the instructor holds department-level read, but the nine responses that name them are excluded: only the one about no instructor remains, below the minimum
    const own = await results(U.facultyD1);
    expect(own.response_count).toBe(1);
    expect(own.suppressed).toBe(true);
  });
  it('small groups are suppressed for everyone, including the filtered view of one course', async () => {
    const one = await results(U.registrar1, 1, 2); // course 2 has no responses
    expect(one.suppressed).toBe(true);
    expect(one.questions).toEqual([]);
    await db.exec("update feedback_response set course_offering_id = 2 where feedback_response_id in (101, 102, 103)");
    expect((await results(U.registrar1, 1, 2)).suppressed).toBe(true); // 3 < 5
    expect((await results(U.registrar1, 1, 1)).response_count).toBe(7);
    await db.exec("update feedback_response set course_offering_id = 1 where feedback_response_id in (101, 102, 103)");
  });
  it('FACULTY visibility lets the rated instructor see their own aggregates, with texts', async () => {
    await db.exec("update feedback_cycle set result_visibility = 'FACULTY' where feedback_cycle_id = 1");
    const f = await results(U.facultyD1);
    expect(f.suppressed).toBe(false);
    expect(f.questions[2]?.texts.length).toBe(10);
    expect((await results(U.student1)).response_count).toBe(0);
  });
  it('PUBLIC visibility shows numeric aggregates to any signed-in user but never free text', async () => {
    await db.exec("update feedback_cycle set result_visibility = 'PUBLIC' where feedback_cycle_id = 1");
    const s = await results(U.student1);
    expect(s.suppressed).toBe(false);
    expect(s.questions[0]?.answered).toBe(10);
    expect(s.questions[2]?.texts).toEqual([]);
    expect((await results(U.registrar1)).questions[2]?.texts.length).toBe(10);
  });
  it('HIDDEN shows nothing to programme readers or the instructor; a global admin still sees it', async () => {
    await db.exec("update feedback_cycle set result_visibility = 'HIDDEN' where feedback_cycle_id = 1");
    for (const sub of [U.registrar1, U.facultyD1, U.student1]) expect((await results(sub)).response_count).toBe(0);
    expect((await results(U.superAdmin)).response_count).toBe(10);
    expect(await rpc(U.registrar1, 'select * from public.feedback_cycle_offerings(1)')).toEqual([]);
  });
  it('the offering list shows response counts to programme readers when results are not hidden', async () => {
    await db.exec("update feedback_cycle set result_visibility = 'ADMIN_ONLY' where feedback_cycle_id = 1");
    const o = await rpc<{ course_label: string; responses: string }>(U.registrar1, 'select * from public.feedback_cycle_offerings(1)');
    expect(o.map((r) => [r.course_label, Number(r.responses)])).toEqual([['CS101 — Intro', 10], ['CS102 — Second', 0]]);
    expect(await rpc(U.registrar2, 'select * from public.feedback_cycle_offerings(1)')).toEqual([]);
  });
});
