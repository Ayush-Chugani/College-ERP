import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, role, U } from './world';

/** Fee structures (migration 061). finance1 and FIN_B are finance officers of institution 1 (programmes P1 = 1 and P1B = 2); FIN2 is institution 2. */
const FIN_B = '00000000-0000-0000-0000-0000000000f1';
const FIN2 = '00000000-0000-0000-0000-0000000000f2';
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const j = (o: Record<string, unknown>) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const base = (o: Record<string, unknown> = {}) => ({ structure_code: 'BTECH-25', structure_name: 'B.Tech 2025-26', institution_id: 1, programme_id: 1, academic_year_id: 1, effective_from: '2025-06-01', ...o });
const save = (sub: string, o: Record<string, unknown> = {}, id: number | null = null) => asUser<{ id: string }>(sub, `select public.fin_structure_save(${id ?? 'null'}, ${j(base(o))}) id`);
const item = (sub: string, sid: number, o: Record<string, unknown> = {}, id: number | null = null) =>
  asUser<{ id: string }>(sub, `select public.fin_structure_item_save(${sid}, ${id ?? 'null'}, ${j({ fee_type_id: 1, amount: 50000, ...o })}) id`);
const status = async (id: number) => String(await val(`select approval_status from fee_structure where fee_structure_id = ${id}`));
let S = 0;

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO academic_year (academic_year_id, year_code, start_date, end_date) VALUES (1, '2025-26', '2025-04-01', '2026-03-31') ON CONFLICT DO NOTHING;
    INSERT INTO fee_category (fee_category_id, category_code, category_name) VALUES (1, 'ACAD', 'Academic') ON CONFLICT DO NOTHING;
    INSERT INTO fee_type (fee_type_id, fee_category_id, fee_code, fee_name, charge_frequency) VALUES (1, 1, 'TUITION', 'Tuition', 'ANNUAL'), (2, 1, 'LAB', 'Lab', 'ANNUAL') ON CONFLICT DO NOTHING;
    INSERT INTO user_account (user_id, username, password_hash) VALUES (51, 'finb', 'x'), (52, 'fin2', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES (51, ${role('FINANCE_OFFICER')}, 'INSTITUTION', 1), (52, ${role('FINANCE_OFFICER')}, 'INSTITUTION', 2);
    INSERT INTO auth.users (id) VALUES ('${FIN_B}'), ('${FIN2}');
    SELECT sims_private.link_auth_user('${FIN_B}', 51, 'test');
    SELECT sims_private.link_auth_user('${FIN2}', 52, 'test');
  `);
}, 180_000);

describe('drafting', () => {
  it('needs FEE_STRUCTURE.CREATE at the scope and valid data', async () => {
    await expect(as('anon', null, `select public.fin_structure_save(null, ${j(base())})`)).rejects.toThrow(/permission denied/);
    for (const sub of [U.student1, U.registrar1, FIN2, U.facultyD1]) await expect(save(sub)).rejects.toThrow(/Not authorised/);
    await expect(save(U.finance1, { programme_id: 3 })).rejects.toThrow(/does not belong/);
    await expect(save(U.finance1, { structure_name: '' })).rejects.toThrow(/code .* name/);
    await expect(save(U.finance1, { effective_to: '2024-01-01' })).rejects.toThrow(/cannot be before/);
    await expect(save(U.finance1, { academic_year_id: 99 })).rejects.toThrow(/academic year/);
    S = Number((await save(U.finance1))[0]?.id);
    expect(await status(S)).toBe('DRAFT');
    await expect(save(U.finance1)).rejects.toThrow(/already used/);
  });
  it('items: validation, duplicates, and a draft cannot be submitted empty', async () => {
    await expect(asUser(U.finance1, `select public.fin_structure_submit(${S})`)).rejects.toThrow(/at least one item/);
    await expect(item(FIN2, S)).rejects.toThrow(/Not authorised/);
    await expect(item(U.finance1, S, { amount: 0 })).rejects.toThrow(/positive amount/);
    await expect(item(U.finance1, S, { fee_type_id: 99 })).rejects.toThrow(/fee type/);
    const i1 = Number((await item(U.finance1, S))[0]?.id);
    await expect(item(U.finance1, S)).rejects.toThrow(/already has an item/);
    await item(U.finance1, S, { fee_type_id: 2, amount: 8000, installment_allowed: true });
    await item(U.finance1, S, { amount: 52000 }, i1);
    expect(Number(await val(`select amount from fee_structure_item where fee_structure_item_id = ${i1}`))).toBe(52000);
  });
});

describe('approval', () => {
  it('the submitter cannot approve; another officer can; the structure is then locked', async () => {
    await asUser(U.finance1, `select public.fin_structure_submit(${S})`);
    await asUser(U.finance1, `select public.fin_structure_submit(${S})`); // idempotent
    expect(await status(S)).toBe('SUBMITTED');
    await expect(item(U.finance1, S, { fee_type_id: 2 }, 1)).rejects.toThrow(/cannot be edited/);
    await expect(asUser(U.finance1, `select public.fin_structure_decide(${S}, true)`)).rejects.toThrow(/submitted yourself/);
    await expect(asUser(FIN2, `select public.fin_structure_decide(${S}, true)`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(FIN_B, `select public.fin_structure_decide(${S}, false)`)).rejects.toThrow(/reason is required/);
    await asUser(FIN_B, `select public.fin_structure_decide(${S}, true)`);
    expect(await status(S)).toBe('APPROVED');
    expect(await val(`select approved_by from fee_structure where fee_structure_id = ${S}`)).toBe(51);
    await expect(save(U.finance1, {}, S)).rejects.toThrow(/cannot be edited/);
    await expect(asUser(U.finance1, `select public.fin_structure_delete(${S})`)).rejects.toThrow(/cannot be deleted/);
  });
  it('a new version is a draft copy; approving it supersedes the old one', async () => {
    const v2 = Number((await asUser<{ id: string }>(U.finance1, `select public.fin_structure_new_version(${S}) id`))[0]?.id);
    expect(String(await val(`select structure_code from fee_structure where fee_structure_id = ${v2}`))).toBe('BTECH-25-V2');
    expect(Number(await val(`select count(*) from fee_structure_item where fee_structure_id = ${v2}`))).toBe(2);
    await expect(asUser(U.finance1, `select public.fin_structure_new_version(${v2})`)).rejects.toThrow(/Only an approved/);
    await asUser(U.finance1, `select public.fin_structure_submit(${v2})`);
    await asUser(FIN_B, `select public.fin_structure_decide(${v2}, true)`);
    expect(await status(S)).toBe('SUPERSEDED');
    expect(await status(v2)).toBe('APPROVED');
  });
  it('a rejected structure returns to editing; an unused draft can be deleted', async () => {
    const s2 = Number((await save(U.finance1, { structure_code: 'BTECH-26', programme_id: 2 }))[0]?.id);
    await item(U.finance1, s2);
    await asUser(U.finance1, `select public.fin_structure_submit(${s2})`);
    await asUser(FIN_B, `select public.fin_structure_decide(${s2}, false, 'amount too high')`);
    expect(await status(s2)).toBe('REJECTED');
    await item(U.finance1, s2, { fee_type_id: 2 });
    expect(await status(s2)).toBe('DRAFT');
    await asUser(U.finance1, `select public.fin_structure_delete(${s2})`);
    expect(Number(await val(`select count(*) from fee_structure where fee_structure_id = ${s2}`))).toBe(0);
  });
});

describe('reading', () => {
  it('lists and shows structures only within scope, with action flags', async () => {
    const mine = await asUser<{ structure_code: string; total_count: string }>(U.finance1, 'select * from public.fin_structure_list()');
    expect(mine.map((r) => r.structure_code).sort()).toEqual(['BTECH-25', 'BTECH-25-V2']);
    expect(await asUser(FIN2, 'select * from public.fin_structure_list()')).toEqual([]);
    expect(await asUser(U.student1, 'select * from public.fin_structure_list()')).toEqual([]);
    expect((await asUser(U.finance1, "select * from public.fin_structure_list('v2', 'APPROVED')")).length).toBe(1);
    expect(await asUser(U.finance1, "select * from public.fin_structure_list('%')")).toEqual([]);
    const g = (await asUser<{ g: { items: unknown[]; can_edit: boolean; can_version: boolean } }>(U.finance1, `select public.fin_structure_get(${S}) g`))[0]?.g;
    expect([g?.items.length, g?.can_edit, g?.can_version]).toEqual([2, false, true]);
    await expect(asUser(FIN2, `select public.fin_structure_get(${S})`)).rejects.toThrow(/Not authorised/);
  });
});
