import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

/** Mentoring (migration 038). facultyD1 = employee E1 (department 1: ASSIGN/CREATE/READ); registrar1 = institution READ only. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const rpc = <T = Record<string, unknown>>(sub: string, sql: string) => asUser<T>(sub, sql);
const lit = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const record = (sub: string, a: number, o: { obs?: string | null; plan?: string | null; follow?: string | null; status?: string; level?: string; date?: string } = {}) =>
  rpc<{ id: string }>(sub, `select public.mentoring_record_session(${a}, '${o.date ?? '2025-09-01T10:00:00Z'}', ${lit(o.obs ?? 'observation')}, ${lit(o.plan ?? 'plan')}, ${o.follow ? `'${o.follow}'` : 'null'}, '${o.status ?? 'COMPLETED'}', '${o.level ?? 'NORMAL'}') id`);

let A1: number;

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO employee (employee_id, institution_id, employment_source_id, employee_number, first_name, display_name, joining_date, employment_type, employment_status) VALUES
      (3, 1, 1, 'E3', 'Emp', 'Emp Three', '2020-01-01', 'REGULAR', 'ACTIVE'), (4, 1, 1, 'E4', 'Emp', 'Emp Four', '2020-01-01', 'REGULAR', 'RESIGNED');
  `);
}, 180_000);

describe('assignments', () => {
  it('anon cannot call; only ASSIGN holders at the student scope can assign', async () => {
    await expect(as('anon', null, "select public.mentoring_assign('S1', 'E1')")).rejects.toThrow(/permission denied/i);
    for (const sub of [U.registrar1, U.student1, U.registrar2, U.unmapped]) await expect(rpc(sub, "select public.mentoring_assign('S1', 'E1')")).rejects.toThrow(/Not authorised/);
    await expect(rpc(U.facultyD1, "select public.mentoring_assign('S1B', 'E1')")).rejects.toThrow(/Not authorised/); // student in another department
    await expect(rpc(U.facultyD1, "select public.mentoring_assign('NOPE', 'E1')")).rejects.toThrow(/Not authorised/); // unknown: same refusal
  });
  it('validates the employee and enrolment', async () => {
    await expect(rpc(U.facultyD1, "select public.mentoring_assign('S1', 'E2')")).rejects.toThrow(/different institution/);
    await expect(rpc(U.facultyD1, "select public.mentoring_assign('S1', 'E4')")).rejects.toThrow(/not ACTIVE/);
    await expect(rpc(U.facultyD1, "select public.mentoring_assign('S1', 'GHOST')")).rejects.toThrow(/Unknown employee/);
    await expect(rpc(U.facultyD1, "select public.mentoring_assign(' ', 'E1')")).rejects.toThrow(/required/);
  });
  it('creates once (idempotent) and allows one ACTIVE mentor per student', async () => {
    A1 = Number((await rpc<{ id: string }>(U.facultyD1, "select public.mentoring_assign('S1', 'E1', '2025-08-01') id"))[0]?.id);
    expect(Number((await rpc<{ id: string }>(U.facultyD1, "select public.mentoring_assign('S1', 'E1', '2025-08-01') id"))[0]?.id)).toBe(A1);
    await expect(rpc(U.facultyD1, "select public.mentoring_assign('S1', 'E3')")).rejects.toThrow(/already has an ACTIVE mentor/);
    expect(Number(await val('select count(*) from mentor_assignment'))).toBe(1);
  });
  it('clients cannot write assignments or touch counselling notes directly', async () => {
    await expect(asUser(U.facultyD1, "insert into mentor_assignment (student_id, employee_id, start_date) values (1, 3, '2025-01-01')")).rejects.toThrow(/permission denied/);
    await expect(asUser(U.facultyD1, 'select * from counselling_session')).rejects.toThrow(/permission denied/);
    await expect(asUser(U.superAdmin, 'select * from counselling_session')).rejects.toThrow(/permission denied/);
  });
  it('lists assignments to readers in scope and to the mentor; hides them from others', async () => {
    const mine = await rpc<{ student_name: string; is_mine: boolean; session_count: string }>(U.facultyD1, 'select * from public.mentoring_assignments()');
    expect(mine.map((r) => [r.student_name, r.is_mine])).toEqual([['Stu One', true]]);
    expect((await rpc(U.registrar1, 'select * from public.mentoring_assignments()')).length).toBe(1);
    expect(await rpc(U.registrar2, 'select * from public.mentoring_assignments()')).toEqual([]);
    expect(await rpc(U.student1, 'select * from public.mentoring_assignments()')).toEqual([]);
    expect((await rpc(U.registrar1, "select * from public.mentoring_assignments('%')")).length).toBe(0);
    expect((await rpc(U.registrar1, "select * from public.mentoring_assignments('stu one')")).length).toBe(1);
    await expect(rpc(U.registrar2, `select * from public.mentoring_assignment_info(${A1})`)).rejects.toThrow(/Not authorised/);
    await expect(rpc(U.registrar1, 'select * from public.mentoring_assignment_info(99999)')).rejects.toThrow(/Not authorised/);
    const info = (await rpc<{ is_mine: boolean; can_assign: boolean }>(U.registrar1, `select * from public.mentoring_assignment_info(${A1})`))[0];
    expect(info).toMatchObject({ is_mine: false, can_assign: false });
  });
});

describe('sessions and confidentiality', () => {
  it('only the assigned mentor (or a global CREATE holder) records sessions', async () => {
    await expect(record(U.registrar1, A1)).rejects.toThrow(/only the assigned mentor/);
    await expect(record(U.student1, A1)).rejects.toThrow(/Not authorised/);
    await expect(record(U.registrar2, A1)).rejects.toThrow(/Not authorised/);
    await record(U.facultyD1, A1, { obs: 'normal secret', level: 'NORMAL' });
    await record(U.facultyD1, A1, { obs: 'restricted secret', level: 'RESTRICTED', date: '2025-09-02T10:00:00Z' });
    await record(U.facultyD1, A1, { obs: 'highly secret', level: 'HIGHLY_RESTRICTED', date: '2025-09-03T10:00:00Z' });
    await record(U.superAdmin, A1, { obs: 'admin note', level: 'NORMAL', date: '2025-09-04T10:00:00Z' });
    expect(Number(await val('select count(*) from counselling_session'))).toBe(4);
  });
  it('validates session fields', async () => {
    await expect(record(U.facultyD1, A1, { status: 'DONE' })).rejects.toThrow(/Invalid session status/);
    await expect(record(U.facultyD1, A1, { level: 'SECRET' })).rejects.toThrow(/confidentiality/);
    await expect(record(U.facultyD1, A1, { status: 'FOLLOW_UP_REQUIRED' })).rejects.toThrow(/follow-up date is required/);
    await expect(record(U.facultyD1, A1, { follow: '2025-08-01' })).rejects.toThrow(/cannot be before/);
    await expect(record(U.facultyD1, A1, { obs: 'x'.repeat(10001) })).rejects.toThrow(/10000/);
    await record(U.facultyD1, A1, { status: 'FOLLOW_UP_REQUIRED', follow: '2025-10-01', obs: null, plan: null, date: '2025-09-05T10:00:00Z' });
  });
  it('the mentor sees everything', async () => {
    const s = await rpc<{ observations: string | null; redacted: boolean }>(U.facultyD1, `select * from public.mentoring_sessions(${A1})`);
    expect(s.every((r) => !r.redacted)).toBe(true);
    expect(s.map((r) => r.observations)).toContain('highly secret');
  });
  it('an institution reader sees NORMAL content only; the rest is redacted but listed', async () => {
    const s = await rpc<{ observations: string | null; confidentiality_level: string; redacted: boolean }>(U.registrar1, `select * from public.mentoring_sessions(${A1})`);
    const by = (l: string) => s.filter((r) => r.confidentiality_level === l);
    expect(by('NORMAL').every((r) => !r.redacted && r.observations)).toBe(true);
    expect(by('RESTRICTED').every((r) => r.redacted && r.observations === null)).toBe(true);
    expect(by('HIGHLY_RESTRICTED').every((r) => r.redacted && r.observations === null)).toBe(true);
    expect(s.length).toBe(5);
  });
  it('a global admin also sees RESTRICTED but never HIGHLY_RESTRICTED', async () => {
    const s = await rpc<{ observations: string | null; confidentiality_level: string; redacted: boolean }>(U.superAdmin, `select * from public.mentoring_sessions(${A1})`);
    expect(s.find((r) => r.confidentiality_level === 'RESTRICTED')?.observations).toBe('restricted secret');
    expect(s.find((r) => r.confidentiality_level === 'HIGHLY_RESTRICTED')?.observations).toBeNull();
  });
  it('people outside the scope cannot even list sessions', async () => {
    for (const sub of [U.registrar2, U.student1, U.unmapped]) await expect(rpc(sub, `select * from public.mentoring_sessions(${A1})`)).rejects.toThrow(/Not authorised/);
  });
  it('notes never reach the audit log; the action is recorded without content', async () => {
    const n = Number(await val("select count(*) from activity_audit where module_code = 'MENTORING' and entity_name = 'counselling_session'"));
    expect(n).toBeGreaterThanOrEqual(5);
    expect(Number(await val("select count(*) from activity_audit where after_values::text ilike '%secret%' or before_values::text ilike '%secret%'"))).toBe(0);
    expect(Number(await val("select count(*) from activity_audit where module_code = 'MENTORING' and entity_name = 'mentor_assignment'"))).toBe(1);
  });
  it('updating a session is limited to the mentor or a global UPDATE holder', async () => {
    const id = Number(await val("select min(counselling_session_id) from counselling_session"));
    await expect(rpc(U.registrar1, `select public.mentoring_update_session(${id}, '2025-09-01T10:00:00Z', 'hack', null, null, 'COMPLETED', 'NORMAL')`)).rejects.toThrow(/Not authorised/);
    await rpc(U.facultyD1, `select public.mentoring_update_session(${id}, '2025-09-01T10:00:00Z', 'edited', 'plan', null, 'COMPLETED', 'NORMAL')`);
    expect(String(await val(`select observations from counselling_session where counselling_session_id = ${id}`))).toBe('edited');
    await expect(rpc(U.facultyD1, 'select public.mentoring_update_session(99999, now(), null, null, null, \'COMPLETED\', \'NORMAL\')')).rejects.toThrow(/Not authorised/);
  });
});

describe('ending an assignment', () => {
  it('is limited to ASSIGN holders, needs a valid status and dates, and is idempotent', async () => {
    await expect(rpc(U.registrar1, `select public.mentoring_end_assignment(${A1}, 'COMPLETED')`)).rejects.toThrow(/Not authorised/);
    await expect(rpc(U.facultyD1, `select public.mentoring_end_assignment(${A1}, 'ACTIVE')`)).rejects.toThrow(/COMPLETED or CANCELLED/);
    await expect(rpc(U.facultyD1, `select public.mentoring_end_assignment(${A1}, 'COMPLETED', '2025-01-01')`)).rejects.toThrow(/before the start/);
    await rpc(U.facultyD1, `select public.mentoring_end_assignment(${A1}, 'COMPLETED', '2025-12-01')`);
    await rpc(U.facultyD1, `select public.mentoring_end_assignment(${A1}, 'COMPLETED', '2025-12-01')`);
    await expect(rpc(U.facultyD1, `select public.mentoring_end_assignment(${A1}, 'CANCELLED')`)).rejects.toThrow(/already COMPLETED/);
  });
  it('a finished assignment takes no more sessions, and the student can get a new mentor', async () => {
    await expect(record(U.facultyD1, A1)).rejects.toThrow(/ACTIVE/);
    expect(Number((await rpc<{ id: string }>(U.facultyD1, "select public.mentoring_assign('S1', 'E3') id"))[0]?.id)).toBeGreaterThan(A1);
  });
});
