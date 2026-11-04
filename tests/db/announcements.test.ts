import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, U } from './world';

/** Announcements (migration 040). superAdmin has every permission globally; registrar1 (institution 1) holds COMMUNICATION via the seed; student1 and facultyD1 are readers of the feed. */
const rpc = <T = Record<string, unknown>>(sub: string, sql: string) => asUser<T>(sub, sql);
const lit = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const save = (sub: string, o: { id?: number | null; dept?: number | null; title?: string; audience?: string; from?: string; to?: string | null } = {}) =>
  rpc<{ id: string }>(sub, `select public.announcement_save(${o.id ?? 'null'}, 1, ${o.dept ?? 'null'}, ${lit(o.title ?? 'Holiday')}, 'Campus closed on Friday.', '${o.from ?? '2020-01-01T00:00:00Z'}', ${lit(o.to ?? null)}, '${o.audience ?? 'ALL'}') id`);
const status = (sub: string, id: number, s: string) => rpc(sub, `select public.announcement_set_status(${id}, '${s}')`);
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const feed = async (sub: string) => (await rpc<{ title: string }>(sub, 'select title from public.announcement_feed()')).map((r) => r.title).sort();

beforeAll(async () => {
  await createWorld();
}, 180_000);

describe('writing', () => {
  it('is RPC-only for clients, and anon cannot call', async () => {
    await expect(asUser(U.superAdmin, "update announcement set title = 'x'")).rejects.toThrow(/permission denied/);
    await expect(as('anon', null, 'select * from public.announcement_feed()')).rejects.toThrow(/permission denied/);
  });
  it('validates input', async () => {
    await expect(save(U.superAdmin, { title: ' ' })).rejects.toThrow(/title/);
    await expect(save(U.superAdmin, { audience: 'NOPE' })).rejects.toThrow(/audience/);
    await expect(save(U.superAdmin, { audience: 'DEPARTMENT' })).rejects.toThrow(/department is required/);
    await expect(save(U.superAdmin, { from: '2024-01-02T00:00:00Z', to: '2024-01-01T00:00:00Z' })).rejects.toThrow(/later than/);
    await expect(rpc(U.superAdmin, "select public.announcement_save(null, 99, null, 't', 'd', now(), null, 'ALL')")).rejects.toThrow(/announcement type/);
  });
  it('students cannot create; a scoped staff member needs the department scope', async () => {
    await expect(save(U.student1)).rejects.toThrow(/COMMUNICATION.ALL.CREATE/);
    await expect(save(U.registrar1)).rejects.toThrow(/COMMUNICATION.ALL.CREATE/); // institution-wide (no department) needs a global grant
    await expect(save(U.registrar2, { dept: 1 })).rejects.toThrow(/COMMUNICATION.ALL.CREATE/); // other institution
  });
});

describe('lifecycle', () => {
  let A: number;
  it('creates a draft that nobody sees in the feed, then moves it through approval', async () => {
    A = Number((await save(U.registrar1, { dept: 1, title: 'Dept notice', audience: 'ALL' }))[0]?.id);
    expect(await val(`select approval_status from announcement where announcement_id = ${A}`)).toBe('DRAFT');
    expect(await feed(U.student1)).toEqual([]);
    await expect(status(U.registrar1, A, 'APPROVED')).rejects.toThrow(/cannot become/); // DRAFT -> APPROVED is not allowed
    await status(U.registrar1, A, 'PENDING');
    await status(U.registrar1, A, 'PENDING'); // idempotent
    await expect(save(U.registrar1, { id: A, dept: 1 })).rejects.toThrow(/draft or rejected/);
    expect(await feed(U.student1)).toEqual([]);
  });
  it('only an approver can approve; once approved it reaches the feed and can be archived', async () => {
    await expect(status(U.student1, A, 'APPROVED')).rejects.toThrow(/Not authorised/);
    await status(U.superAdmin, A, 'APPROVED');
    expect(await feed(U.student1)).toEqual(['Dept notice']);
    expect(await feed(U.facultyD1)).toEqual(['Dept notice']);
    await expect(asUser(U.superAdmin, `select public.announcement_delete(${A})`)).rejects.toThrow(/Only a draft/);
    await status(U.superAdmin, A, 'ARCHIVED');
    expect(await feed(U.student1)).toEqual([]);
    expect(Number(await val("select count(*) from activity_audit where module_code = 'COMMUNICATION'"))).toBeGreaterThanOrEqual(4);
  });
  it('rejected announcements can be reworked and deleted when still drafts', async () => {
    const B = Number((await save(U.superAdmin, { title: 'Second' }))[0]?.id);
    await status(U.superAdmin, B, 'PENDING');
    await status(U.superAdmin, B, 'REJECTED');
    await status(U.superAdmin, B, 'DRAFT');
    await save(U.superAdmin, { id: B, title: 'Second (edited)' });
    expect(await val(`select title from announcement where announcement_id = ${B}`)).toBe('Second (edited)');
    await rpc(U.superAdmin, `select public.announcement_delete(${B})`);
    expect(Number(await val(`select count(*) from announcement where announcement_id = ${B}`))).toBe(0);
  });
});

describe('feed audience and window', () => {
  it('honours audience, department and the publish window', async () => {
    const mk = async (title: string, audience: string, dept: number | null, from = '2020-01-01T00:00:00Z', to: string | null = null) => {
      const id = Number((await save(U.superAdmin, { title, audience, dept, from, to }))[0]?.id);
      await status(U.superAdmin, id, 'PENDING');
      await status(U.superAdmin, id, 'APPROVED');
    };
    await mk('For students', 'STUDENTS', null);
    await mk('For staff', 'STAFF', null);
    await mk('Dept 1 only', 'DEPARTMENT', 1);
    await mk('Dept 2 only', 'DEPARTMENT', 2);
    await mk('Custom list', 'CUSTOM', null);
    await mk('Future', 'ALL', null, '2999-01-01T00:00:00Z');
    await mk('Expired', 'ALL', null, '2020-01-01T00:00:00Z', '2020-02-01T00:00:00Z');
    expect(await feed(U.student1)).toEqual(['Dept 1 only', 'For students']);
    expect(await feed(U.facultyD1)).toEqual(['For staff']); // no current assignment in department 1 yet
    await fkSwitch(false);
    await db.exec("insert into employee_assignment (employee_id, campus_id, department_id, designation_id, start_date) values (1,1,1,1,'2024-01-01')");
    await fkSwitch(true);
    expect(await feed(U.facultyD1)).toEqual(['Dept 1 only', 'For staff']);
    expect(await feed(U.unmapped)).toEqual([]); // not an active member
  });
  it('the staff list is scoped by department permission and searchable', async () => {
    const all = await rpc<{ title: string; total_count: string }>(U.superAdmin, "select title, total_count from public.announcement_manage_list('dept', null, 20, 0)");
    expect(all.map((r) => r.title).sort()).toEqual(['Dept 1 only', 'Dept 2 only', 'Dept notice']);
    expect(Number(all[0]?.total_count)).toBe(3);
    await expect(rpc(U.student1, 'select * from public.announcement_manage_list()').then((r) => r.length)).resolves.toBe(0);
    const g = await rpc<{ can_approve: boolean }>(U.registrar2, `select public.announcement_get(${await val("select announcement_id from announcement where title = 'Dept 1 only'")}) g`).catch((e: Error) => e.message);
    expect(String(g)).toMatch(/Not authorised/);
  });
});
