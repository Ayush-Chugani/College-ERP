import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, U } from './world';

/** MFA recovery codes (migration 056). student1 turns two-step verification on, loses the device and recovers. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const setAal = (aal: string | null) => db.exec(`SELECT set_config('request.jwt.claims', ${aal === null ? "''" : `'{"aal":"${aal}"}'`}, false)`);
let CODES: string[] = [];

beforeAll(async () => {
  await createWorld();
  await db.exec(`INSERT INTO auth.mfa_factors (user_id, status) VALUES ('${U.student1}', 'verified')`);
  await setAal('aal2');
  await asUser(U.student1, 'select public.mfa_sync()');
}, 180_000);

describe('generation', () => {
  it('needs a fully signed-in session and returns ten distinct codes once', async () => {
    await expect(as('anon', null, 'select public.mfa_recovery_generate()')).rejects.toThrow(/permission denied/);
    await expect(asUser(U.unmapped, 'select public.mfa_recovery_generate()')).rejects.toThrow(/Not authorised/);
    await setAal('aal1');
    await expect(asUser(U.student1, 'select public.mfa_recovery_generate()')).rejects.toThrow(/Not authorised/); // password only is not enough to mint codes
    await setAal('aal2');
    CODES = (await asUser<{ c: string[] }>(U.student1, 'select public.mfa_recovery_generate() c'))[0]!.c;
    expect(CODES.length).toBe(10);
    expect(new Set(CODES).size).toBe(10);
    for (const c of CODES) expect(c).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}-[A-HJ-KM-NP-Z2-9]{5}$/);
  });
  it('stores only hashes', async () => {
    expect(Number(await val('select count(*) from sims_private.mfa_recovery_code where used_at is null'))).toBe(10);
    expect(Number(await val(`select count(*) from sims_private.mfa_recovery_code where code_hash like '$2%'`))).toBe(10);
    expect(await val(`select count(*) from sims_private.mfa_recovery_code where code_hash = '${CODES[0]}'`)).toBe(0);
    await expect(asUser(U.student1, 'select * from sims_private.mfa_recovery_code')).rejects.toThrow(/permission denied/);
    expect((await asUser<{ s: { unused: number } }>(U.student1, 'select public.mfa_recovery_status() s'))[0]?.s.unused).toBe(10);
  });
  it('regenerating replaces the old codes', async () => {
    const again = (await asUser<{ c: string[] }>(U.student1, 'select public.mfa_recovery_generate() c'))[0]!.c;
    expect(again.some((c) => CODES.includes(c))).toBe(false);
    CODES = again;
    expect(Number(await val('select count(*) from sims_private.mfa_recovery_code'))).toBe(10);
  });
});

describe('use', () => {
  it('wrong codes are refused and rate limited', async () => {
    await setAal('aal1');
    for (let i = 0; i < 5; i++) expect((await asUser<{ r: boolean }>(U.student1, "select public.mfa_recovery_use('AAAAA-BBBBB') r"))[0]?.r).toBe(false);
    await expect(asUser(U.student1, `select public.mfa_recovery_use('${CODES[0]}')`)).rejects.toThrow(/Too many wrong codes/); // even a right code waits
    await db.exec('DELETE FROM sims_private.mfa_recovery_attempt');
  });
  it('only people with MFA on can use a code, and it must be theirs', async () => {
    await expect(asUser(U.registrar1, `select public.mfa_recovery_use('${CODES[0]}')`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.unmapped, `select public.mfa_recovery_use('${CODES[0]}')`)).rejects.toThrow(/Not authorised/);
    await expect(as('anon', null, `select public.mfa_recovery_use('${CODES[0]}')`)).rejects.toThrow(/permission denied/);
    expect((await asUser<{ r: boolean }>(U.student1, "select public.mfa_recovery_use('') r"))[0]?.r).toBe(false);
  });
  it('a valid code removes the factor, switches enforcement off and burns all codes', async () => {
    const r = (await asUser<{ r: boolean }>(U.student1, `select public.mfa_recovery_use(lower('${CODES[3]}')) r`))[0]?.r; // case and dash do not matter
    expect(r).toBe(true);
    expect(await val(`select multi_factor_enabled from user_account where username = 'student1'`)).toBe(false);
    expect(Number(await val(`select count(*) from auth.mfa_factors where user_id = '${U.student1}'`))).toBe(0);
    expect(Number(await val('select count(*) from sims_private.mfa_recovery_code'))).toBe(0);
    expect(Number(await val("select count(*) from activity_audit where action_code = 'MFA_RECOVERY_USED'"))).toBe(1);
    expect((await asUser(U.student1, 'select student_id from student')).length).toBe(1); // aal1 now works because enforcement is off
    await expect(asUser(U.student1, `select public.mfa_recovery_use('${CODES[4]}')`)).rejects.toThrow(/Not authorised/); // MFA is off now: nothing to recover
  });
});
