import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

/** Grievance (migration 039). student1 files; registrar1 (institution 1) reads only; superAdmin acts; registrar2 is another institution. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const rpc = <T = Record<string, unknown>>(sub: string, sql: string) => asUser<T>(sub, sql);
const lit = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const submit = (sub: string, o: { cat?: number; dept?: number | null; subject?: string; desc?: string; prio?: string } = {}) =>
  rpc<{ id: string }>(sub, `select public.grievance_submit(${o.cat ?? 1}, ${o.dept ?? 'null'}, ${lit(o.subject ?? 'Broken projector')}, ${lit(o.desc ?? 'The projector in room 101 is broken.')}, '${o.prio ?? 'NORMAL'}') id`);
const act = (sub: string, id: number, type: string, notes: string | null, status: string | null = null, res: string | null = null) =>
  rpc(sub, `select public.grievance_act(${id}, '${type}', ${lit(notes)}, ${status ? `'${status}'` : 'null'}, ${lit(res)})`);

let G1: number;

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO grievance_category (grievance_category_id, category_code, category_name, is_active) VALUES (1, 'FAC', 'Facilities', true), (2, 'OLD', 'Retired', false);
  `);
}, 180_000);

describe('submitting', () => {
  it('anon cannot call; only students can submit', async () => {
    await expect(as('anon', null, "select public.grievance_submit(1, null, 'x', 'y')")).rejects.toThrow(/permission denied/i);
    for (const sub of [U.registrar1, U.superAdmin, U.unmapped]) await expect(submit(sub)).rejects.toThrow(/Only students/);
  });
  it('validates category, priority, text and department', async () => {
    await expect(submit(U.student1, { cat: 2 })).rejects.toThrow(/active grievance category/);
    await expect(submit(U.student1, { cat: 99 })).rejects.toThrow(/active grievance category/);
    await expect(submit(U.student1, { prio: 'MEH' })).rejects.toThrow(/priority/);
    await expect(submit(U.student1, { subject: '  ' })).rejects.toThrow(/subject/);
    await expect(submit(U.student1, { subject: 'x'.repeat(201) })).rejects.toThrow(/subject/);
    await expect(submit(U.student1, { desc: '' })).rejects.toThrow(/description/);
    await expect(submit(U.student1, { desc: 'x'.repeat(5001) })).rejects.toThrow(/description/);
    await expect(submit(U.student1, { dept: 3 })).rejects.toThrow(/does not belong to your institution/); // department of institution 2
    expect(Number(await val('select count(*) from grievance'))).toBe(0);
  });
  it('creates the grievance with a number and a first history entry; clients cannot write directly', async () => {
    G1 = Number((await submit(U.student1, { dept: 1, prio: 'HIGH' }))[0]?.id);
    const g = (await db.query<{ grievance_number: string; status: string }>(`select grievance_number, status from grievance where grievance_id = ${G1}`)).rows[0];
    expect(g?.grievance_number).toMatch(/^GRV-\d{4}-\d{6}$/);
    expect(g?.status).toBe('SUBMITTED');
    expect(Number(await val(`select count(*) from grievance_action where grievance_id = ${G1}`))).toBe(1);
    await expect(asUser(U.student1, "update grievance set status = 'RESOLVED'")).rejects.toThrow(/permission denied/);
    await expect(asUser(U.superAdmin, "insert into grievance_action (grievance_id, action_type) values (1, 'x')")).rejects.toThrow(/permission denied/);
    expect(Number(await val('select count(*) from activity_audit where module_code = \'GRIEVANCE\''))).toBe(1);
  });
  it('limits a student to ten open grievances', async () => {
    for (let i = 0; i < 9; i++) await submit(U.student1, { subject: `Issue ${i}` });
    await expect(submit(U.student1, { subject: 'one too many' })).rejects.toThrow(/10 open/);
  });
});

describe('visibility', () => {
  it('the student sees only their own list; staff readers see their scope; others see nothing', async () => {
    expect((await rpc(U.student1, 'select * from public.grievance_my()')).length).toBe(10);
    expect(await rpc(U.registrar2, 'select * from public.grievance_list()')).toEqual([]);
    expect(await rpc(U.student1, 'select * from public.grievance_list()')).toEqual([]);
    expect(await rpc(U.facultyD1, 'select * from public.grievance_list()')).toEqual([]);
    const l = await rpc<{ grievance_number: string; priority: string; student_name: string }>(U.registrar1, 'select * from public.grievance_list()');
    expect(l.length).toBe(10);
    expect(l[0]?.priority).toBe('HIGH'); // urgent/high first
    expect(l[0]?.student_name).toBe('Stu One');
    expect((await rpc(U.registrar1, "select * from public.grievance_list('projector')")).length).toBe(1);
    expect((await rpc(U.registrar1, "select * from public.grievance_list('%')")).length).toBe(0);
    expect((await rpc(U.registrar1, "select * from public.grievance_list(null, 'RESOLVED')")).length).toBe(0);
  });
  it('detail: owner and staff readers only, with the same refusal for unknown ids', async () => {
    const d = (await rpc<{ d: { is_owner: boolean; can_act: boolean; subject: string } }>(U.student1, `select public.grievance_detail(${G1}) d`))[0]?.d;
    expect(d).toMatchObject({ is_owner: true, can_act: false, subject: 'Broken projector' });
    const s = (await rpc<{ d: { is_owner: boolean; can_act: boolean } }>(U.registrar1, `select public.grievance_detail(${G1}) d`))[0]?.d;
    expect(s).toMatchObject({ is_owner: false, can_act: false });
    expect((await rpc<{ d: { can_act: boolean } }>(U.superAdmin, `select public.grievance_detail(${G1}) d`))[0]?.d.can_act).toBe(true);
    for (const sub of [U.registrar2, U.unmapped, U.facultyD1]) await expect(rpc(sub, `select public.grievance_detail(${G1})`)).rejects.toThrow(/Not authorised/);
    await expect(rpc(U.registrar1, 'select public.grievance_detail(99999)')).rejects.toThrow(/Not authorised/);
  });
});

describe('handling', () => {
  it('only UPDATE holders act; readers and students cannot', async () => {
    for (const sub of [U.registrar1, U.student1, U.registrar2, U.facultyD1]) await expect(act(sub, G1, 'COMMENT', 'hello')).rejects.toThrow(/Not authorised/);
  });
  it('validates actions and follows the transition rules', async () => {
    await expect(act(U.superAdmin, G1, 'SHOUT', 'x')).rejects.toThrow(/Invalid action type/);
    await expect(act(U.superAdmin, G1, 'COMMENT', null)).rejects.toThrow(/note is required/);
    await expect(act(U.superAdmin, G1, 'COMMENT', 'x', 'ASSIGNED')).rejects.toThrow(/Only a STATUS_CHANGE/);
    await expect(act(U.superAdmin, G1, 'STATUS_CHANGE', null)).rejects.toThrow(/new status is required/);
    await expect(act(U.superAdmin, G1, 'STATUS_CHANGE', null, 'RESOLVED', 'done')).rejects.toThrow(/cannot become/);
    await act(U.superAdmin, G1, 'STATUS_CHANGE', 'Taking this up', 'ASSIGNED');
    await act(U.superAdmin, G1, 'STATUS_CHANGE', 'Taking this up', 'ASSIGNED'); // replay is a no-op
    expect(Number(await val(`select count(*) from grievance_action where grievance_id = ${G1} and new_status = 'ASSIGNED'`))).toBe(1);
    await act(U.superAdmin, G1, 'STATUS_CHANGE', null, 'UNDER_REVIEW');
    await expect(act(U.superAdmin, G1, 'STATUS_CHANGE', null, 'RESOLVED')).rejects.toThrow(/resolution text is required/);
    await act(U.superAdmin, G1, 'INTERNAL_NOTE', 'Facilities already knows; staff only');
    await act(U.superAdmin, G1, 'COMMENT', 'We have ordered a replacement');
    await act(U.superAdmin, G1, 'STATUS_CHANGE', null, 'RESOLVED', 'Projector replaced');
    expect(String(await val(`select resolution from grievance where grievance_id = ${G1}`))).toBe('Projector replaced');
    expect(await val(`select resolved_at is not null from grievance where grievance_id = ${G1}`)).toBe(true);
  });
  it('the student never sees internal notes; staff see everything', async () => {
    const stu = (await rpc<{ d: { actions: { action_type: string }[] } }>(U.student1, `select public.grievance_detail(${G1}) d`))[0]?.d.actions.map((a) => a.action_type) ?? [];
    expect(stu).not.toContain('INTERNAL_NOTE');
    expect(stu).toContain('COMMENT');
    const staff = (await rpc<{ d: { actions: { action_type: string }[] } }>(U.registrar1, `select public.grievance_detail(${G1}) d`))[0]?.d.actions.map((a) => a.action_type) ?? [];
    expect(staff).toContain('INTERNAL_NOTE');
  });
});

describe('student responses', () => {
  it('only the owner responds, and only in valid states', async () => {
    await expect(rpc(U.registrar1, `select public.grievance_student_respond(${G1}, 'CLOSE')`)).rejects.toThrow(/Unknown grievance/);
    await expect(rpc(U.student1, `select public.grievance_student_respond(${G1}, 'SHRUG')`)).rejects.toThrow(/CLOSE or REOPEN/);
    const other = Number(await val("select min(grievance_id) from grievance where status = 'SUBMITTED'"));
    await expect(rpc(U.student1, `select public.grievance_student_respond(${other}, 'CLOSE')`)).rejects.toThrow(/Only a resolved or rejected/);
    await expect(rpc(U.student1, `select public.grievance_student_respond(${other}, 'REOPEN')`)).rejects.toThrow(/Only a resolved/);
  });
  it('re-opens a resolved grievance (clearing resolved_at) and closes it after a new resolution; CLOSED is final', async () => {
    await rpc(U.student1, `select public.grievance_student_respond(${G1}, 'REOPEN', 'Still broken')`);
    expect(String(await val(`select status from grievance where grievance_id = ${G1}`))).toBe('UNDER_REVIEW');
    expect(await val(`select resolved_at is null from grievance where grievance_id = ${G1}`)).toBe(true);
    await act(U.superAdmin, G1, 'STATUS_CHANGE', null, 'RESOLVED', 'Fixed properly');
    await rpc(U.student1, `select public.grievance_student_respond(${G1}, 'CLOSE')`);
    await rpc(U.student1, `select public.grievance_student_respond(${G1}, 'CLOSE')`); // idempotent
    expect(String(await val(`select status from grievance where grievance_id = ${G1}`))).toBe('CLOSED');
    await expect(act(U.superAdmin, G1, 'COMMENT', 'late note')).rejects.toThrow(/CLOSED/);
    await expect(act(U.superAdmin, G1, 'STATUS_CHANGE', null, 'UNDER_REVIEW')).rejects.toThrow(/cannot become/);
    await expect(rpc(U.student1, `select public.grievance_student_respond(${G1}, 'REOPEN')`)).rejects.toThrow(/Only a resolved/);
  });
  it('a rejected grievance can be closed by the student and closing frees a slot for new ones', async () => {
    const id = Number(await val("select min(grievance_id) from grievance where status = 'SUBMITTED'"));
    await act(U.superAdmin, id, 'STATUS_CHANGE', null, 'REJECTED', 'Out of scope');
    await rpc(U.student1, `select public.grievance_student_respond(${id}, 'CLOSE')`);
    expect(Number((await submit(U.student1, { subject: 'new after closing' }))[0]?.id)).toBeGreaterThan(id);
  });
});
