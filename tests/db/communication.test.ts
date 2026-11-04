import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

/**
 * Communication (migration 040). facultyD1 = employee E1, department 1: CREATE/UPDATE/READ, no APPROVE.
 * registrar1 = institution 1: CREATE/UPDATE/APPROVE/READ. registrar2 = institution 2. superAdmin = global.
 */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const rpc = <T = Record<string, unknown>>(sub: string, sql: string) => asUser<T>(sub, sql);
const lit = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);
let TYPE_OK = 1;
let TYPE_OFF = 2;
const save = (sub: string, o: { id?: number | null; type?: number; dept?: number | null; title?: string; text?: string; from?: string; to?: string | null; aud?: string } = {}) =>
  rpc<{ id: string }>(sub, `select public.announcement_save(${o.id ?? 'null'}, ${o.type ?? TYPE_OK}, ${o.dept === undefined ? 1 : (o.dept ?? 'null')}, ${lit(o.title ?? 'Library hours')}, ${lit(o.text ?? 'The library opens at 9.')}, '${o.from ?? '2020-01-01T00:00:00Z'}', ${lit(o.to === undefined ? null : o.to)}, '${o.aud ?? 'ALL'}') id`);
const id = async (sub: string, o: Parameters<typeof save>[1] = {}) => Number((await save(sub, o))[0]?.id);
const status = async (n: number) => String(await val(`select approval_status from announcement where announcement_id = ${n}`));
const approve = (sub: string, n: number, yes = true) => rpc(sub, `select public.announcement_decide(${n}, ${yes})`);
const publish = async (author: string, o: Parameters<typeof save>[1] = {}) => {
  const n = await id(author, o);
  await rpc(author, `select public.announcement_submit(${n})`);
  await approve(U.registrar1, n);
  return n;
};
const feed = async (sub: string) => (await rpc<{ title: string }>(sub, 'select * from public.announcements_feed(50)')).map((r) => r.title).sort();

beforeAll(async () => {
  await createWorld();
  await db.exec(`
    INSERT INTO announcement_type (type_code, type_name, is_active) VALUES ('T_TEST_OK', 'Test general', true), ('T_TEST_OFF', 'Test retired', false);
    INSERT INTO employee_assignment (employee_id, campus_id, department_id, designation_id, start_date) VALUES (1, 1, 1, 1, '2020-01-01');
  `);
  TYPE_OK = Number(await val("select announcement_type_id from announcement_type where type_code = 'T_TEST_OK'"));
  TYPE_OFF = Number(await val("select announcement_type_id from announcement_type where type_code = 'T_TEST_OFF'"));
}, 180_000);

describe('authoring', () => {
  it('anon cannot call; students cannot author', async () => {
    await expect(as('anon', null, "select * from public.announcements_feed()")).rejects.toThrow(/permission denied/i);
    await expect(save(U.student1)).rejects.toThrow(/Not authorised/);
    await expect(save(U.unmapped)).rejects.toThrow(/Not authorised/);
  });
  it('creating needs CREATE at the department; an institution-wide one needs a global grant', async () => {
    await expect(save(U.facultyD1, { dept: 3 })).rejects.toThrow(/Not authorised/); // another institution
    await expect(save(U.facultyD1, { dept: null })).rejects.toThrow(/Not authorised/); // institution-wide
    await expect(save(U.registrar2, { dept: 1 })).rejects.toThrow(/Not authorised/);
    expect(await status(await id(U.facultyD1))).toBe('DRAFT');
    expect(await status(await id(U.superAdmin, { dept: null, title: 'Global draft' }))).toBe('DRAFT');
  });
  it('validates the fields', async () => {
    await expect(save(U.facultyD1, { title: '  ' })).rejects.toThrow(/title/);
    await expect(save(U.facultyD1, { title: 'x'.repeat(251) })).rejects.toThrow(/title/);
    await expect(save(U.facultyD1, { text: '' })).rejects.toThrow(/text is required/);
    await expect(save(U.facultyD1, { aud: 'PROGRAMME' })).rejects.toThrow(/audience must be/);
    await expect(save(U.facultyD1, { aud: 'CUSTOM' })).rejects.toThrow(/audience must be/);
    await expect(save(U.superAdmin, { aud: 'DEPARTMENT', dept: null })).rejects.toThrow(/needs a department/);
    await expect(save(U.facultyD1, { to: '2019-01-01T00:00:00Z' })).rejects.toThrow(/end must be after/);
    await expect(save(U.facultyD1, { type: TYPE_OFF })).rejects.toThrow(/active announcement type/);
    await expect(save(U.facultyD1, { dept: 99 })).rejects.toThrow(/Not authorised|Unknown department/);
  });
  it('clients cannot write announcements directly and cannot read the author register', async () => {
    await expect(asUser(U.facultyD1, "insert into announcement (announcement_type_id, title, description, publish_from) values (1, 'x', 'y', now())")).rejects.toThrow(/permission denied/);
    await expect(asUser(U.registrar1, "update announcement set approval_status = 'APPROVED'")).rejects.toThrow(/permission denied/);
    await expect(asUser(U.superAdmin, 'select * from sims_private.announcement_author')).rejects.toThrow(/permission denied/);
  });
});

describe('workflow', () => {
  let A: number;
  it('only the author or an UPDATE holder submits; replays are no-ops', async () => {
    A = await id(U.facultyD1, { title: 'Workflow test' });
    await expect(rpc(U.student1, `select public.announcement_submit(${A})`)).rejects.toThrow(/Not authorised/);
    await expect(rpc(U.registrar2, `select public.announcement_submit(${A})`)).rejects.toThrow(/Not authorised/);
    await rpc(U.facultyD1, `select public.announcement_submit(${A})`);
    await rpc(U.facultyD1, `select public.announcement_submit(${A})`);
    expect(await status(A)).toBe('PENDING');
    await expect(save(U.facultyD1, { id: A })).rejects.toThrow(/cannot be edited/);
  });
  it('approval needs APPROVE at the scope; the author cannot approve their own announcement', async () => {
    await expect(approve(U.facultyD1, A)).rejects.toThrow(/Not authorised/); // faculty hold no APPROVE
    await expect(approve(U.registrar2, A)).rejects.toThrow(/Not authorised/);
    await expect(approve(U.student1, A)).rejects.toThrow(/Not authorised/);
    const own = await id(U.registrar1, { title: 'Registrar own' });
    await rpc(U.registrar1, `select public.announcement_submit(${own})`);
    await expect(approve(U.registrar1, own)).rejects.toThrow(/your own/);
    await approve(U.superAdmin, own); // a global CONFIGURE holder can
    expect(await status(own)).toBe('APPROVED');
  });
  it('approves, replays safely, and refuses decisions outside PENDING', async () => {
    await approve(U.registrar1, A);
    await approve(U.registrar1, A);
    expect(await status(A)).toBe('APPROVED');
    await expect(approve(U.registrar1, A, false)).rejects.toThrow(/Only a PENDING/);
    await expect(rpc(U.facultyD1, `select public.announcement_submit(${A})`)).rejects.toThrow(/cannot be submitted/);
  });
  it('a rejected announcement can be edited and resubmitted', async () => {
    const n = await id(U.facultyD1, { title: 'Will be rejected' });
    await rpc(U.facultyD1, `select public.announcement_submit(${n})`);
    await approve(U.registrar1, n, false);
    expect(await status(n)).toBe('REJECTED');
    await save(U.facultyD1, { id: n, title: 'Fixed after rejection' });
    expect(await status(n)).toBe('DRAFT');
    await rpc(U.facultyD1, `select public.announcement_submit(${n})`);
    expect(await status(n)).toBe('PENDING');
  });
  it('archiving: authors archive their drafts, UPDATE holders archive approved ones, pending ones must be decided first', async () => {
    const d = await id(U.facultyD1, { title: 'Draft to archive' });
    await rpc(U.facultyD1, `select public.announcement_archive(${d})`);
    expect(await status(d)).toBe('ARCHIVED');
    await rpc(U.facultyD1, `select public.announcement_archive(${d})`); // idempotent
    const p = await id(U.facultyD1, { title: 'Pending one' });
    await rpc(U.facultyD1, `select public.announcement_submit(${p})`);
    await expect(rpc(U.facultyD1, `select public.announcement_archive(${p})`)).rejects.toThrow(/before archiving/);
    await expect(rpc(U.student1, `select public.announcement_archive(${A})`)).rejects.toThrow(/Not authorised/);
    await rpc(U.registrar1, `select public.announcement_archive(${A})`);
    expect(await status(A)).toBe('ARCHIVED');
  });
  it('workflow changes are audited', async () => {
    expect(Number(await val("select count(*) from activity_audit where module_code = 'COMMUNICATION' and entity_name = 'announcement'"))).toBeGreaterThan(8);
  });
});

describe('audience and the feed', () => {
  let allDept1: number, staffDept1: number, global: number, future: number, expired: number;
  beforeAll(async () => {
    allDept1 = await publish(U.facultyD1, { title: 'All of dept 1', aud: 'ALL' });
    await publish(U.facultyD1, { title: 'Students of dept 1', aud: 'STUDENTS' });
    staffDept1 = await publish(U.facultyD1, { title: 'Staff of dept 1', aud: 'STAFF' });
    await publish(U.facultyD1, { title: 'Dept 1 notice', aud: 'DEPARTMENT' });
    const g = await id(U.superAdmin, { dept: null, title: 'Everyone', aud: 'ALL' });
    await rpc(U.superAdmin, `select public.announcement_submit(${g})`);
    await approve(U.superAdmin, g);
    global = g;
    future = await publish(U.facultyD1, { title: 'Not yet', from: '2999-01-01T00:00:00Z' });
    expired = await publish(U.facultyD1, { title: 'Expired', from: '2019-01-01T00:00:00Z', to: '2020-01-01T00:00:00Z' });
    await id(U.facultyD1, { title: 'Still a draft' });
  });
  it('a student sees announcements for their department and for everyone, but not staff-only, other departments, drafts, future or expired ones', async () => {
    expect(await feed(U.student1)).toEqual(['All of dept 1', 'Dept 1 notice', 'Everyone', 'Registrar own', 'Students of dept 1'].sort());
  });
  it('staff see staff, all, department and institution-wide announcements for their department', async () => {
    expect(await feed(U.facultyD1)).toEqual(['All of dept 1', 'Dept 1 notice', 'Everyone', 'Registrar own', 'Staff of dept 1'].sort());
  });
  it('people outside the department see only institution-wide announcements; unmapped users see nothing', async () => {
    expect(await feed(U.registrar2)).toEqual([]); // no employee record in the world: nothing
    expect(await feed(U.unmapped)).toEqual([]);
    expect(await feed(U.registrar1)).toEqual([]);
  });
  it('the feed respects the limit', async () => {
    expect((await rpc(U.student1, 'select * from public.announcements_feed(1)')).length).toBe(1);
  });
  it('detail: managers see every status; recipients only what the feed shows; others get the same refusal as for unknown ids', async () => {
    const d = (await rpc<{ d: { managed: boolean; approval_status: string } }>(U.facultyD1, `select public.announcement_detail(${future}) d`))[0]?.d;
    expect(d).toMatchObject({ managed: true, approval_status: 'APPROVED' });
    expect((await rpc<{ d: { managed: boolean } }>(U.student1, `select public.announcement_detail(${allDept1}) d`))[0]?.d.managed).toBe(false);
    for (const n of [future, expired, staffDept1]) await expect(rpc(U.student1, `select public.announcement_detail(${n})`)).rejects.toThrow(/Unknown announcement/);
    await expect(rpc(U.student1, 'select public.announcement_detail(99999)')).rejects.toThrow(/Unknown announcement/);
    await expect(rpc(U.unmapped, `select public.announcement_detail(${allDept1})`)).rejects.toThrow(/Unknown announcement/);
    expect((await rpc<{ d: { managed: boolean } }>(U.student1, `select public.announcement_detail(${global}) d`))[0]?.d.managed).toBe(false);
  });
  it('the management list shows what the caller may manage, filters and searches literally', async () => {
    const mine = await rpc<{ title: string; is_mine: boolean }>(U.facultyD1, 'select * from public.announcements_manage()');
    expect(mine.length).toBeGreaterThan(5);
    expect(mine.some((r) => r.title === 'Still a draft' && r.is_mine)).toBe(true);
    expect((await rpc(U.facultyD1, "select * from public.announcements_manage(null, '%')")).length).toBe(0);
    expect((await rpc(U.facultyD1, "select * from public.announcements_manage('DRAFT', 'still')")).length).toBe(1);
    expect(await rpc(U.student1, 'select * from public.announcements_manage()')).toEqual([]);
    expect((await rpc<{ title: string }>(U.registrar2, 'select * from public.announcements_manage()')).filter((r) => r.title !== 'Everyone' && r.title !== 'Global draft').length).toBe(0);
  });
  it('detail flags what the caller may do', async () => {
    const pending = await id(U.facultyD1, { title: 'Pending flags' });
    await rpc(U.facultyD1, `select public.announcement_submit(${pending})`);
    const asAuthor = (await rpc<{ d: Record<string, boolean> }>(U.facultyD1, `select public.announcement_detail(${pending}) d`))[0]?.d;
    expect(asAuthor).toMatchObject({ can_decide: false, can_edit: false, is_mine: true });
    const asApprover = (await rpc<{ d: Record<string, boolean> }>(U.registrar1, `select public.announcement_detail(${pending}) d`))[0]?.d;
    expect(asApprover).toMatchObject({ can_decide: true, is_mine: false });
  });
});

describe('editor helpers', () => {
  it('list only the departments the caller may post to; global posting needs a global grant', async () => {
    expect((await rpc<{ department_id: number }>(U.facultyD1, 'select * from public.announcement_targets()')).map((r) => Number(r.department_id))).toEqual([1]);
    expect((await rpc(U.registrar1, 'select * from public.announcement_targets()')).length).toBe(2); // departments 1 and 2 of institution 1
    expect(await rpc(U.student1, 'select * from public.announcement_targets()')).toEqual([]);
    expect((await rpc<{ g: boolean }>(U.facultyD1, 'select public.announcement_can_post_global() g'))[0]?.g).toBe(false);
    expect((await rpc<{ g: boolean }>(U.superAdmin, 'select public.announcement_can_post_global() g'))[0]?.g).toBe(true);
    await expect(as('anon', null, 'select * from public.announcement_targets()')).rejects.toThrow(/permission denied/i);
  });
});
