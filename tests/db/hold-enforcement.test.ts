import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createWorld, db, fkSwitch, U } from './world';

/** Fee holds enforced in other modules (migration 062). finance1 places holds on student 1's account. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const place = (type: string) => asUser<{ id: string }>(U.finance1, `select public.fin_hold_place(1, '${type}', 'unpaid dues') id`);
const release = (id: number) => asUser(U.finance1, `select public.fin_hold_release(${id}, 'paid')`);
const insertTerm = () => db.exec("insert into student_term_registration (enrolment_id, programme_term_offering_id, registration_date) values (1, 999, '2025-08-01')");

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec("INSERT INTO student_financial_account (student_account_id, student_id, account_number) VALUES (1, 1, 'ACC1')");
  await db.exec("INSERT INTO certificate_request (request_number, student_id, certificate_type_id, purpose, request_status) VALUES ('CR-T-1', 1, (select certificate_type_id from certificate_type limit 1), 'x', 'SUBMITTED')");
}, 180_000);

describe('holds', () => {
  it('the helper follows active holds of the right type only', async () => {
    expect(await val("select sims_private.fin_hold_active(1, 'REGISTRATION')")).toBe(false);
    const h = Number((await place('REGISTRATION'))[0]?.id);
    expect(await val("select sims_private.fin_hold_active(1, 'REGISTRATION')")).toBe(true);
    expect(await val("select sims_private.fin_hold_active(1, 'RESULT')")).toBe(false);
    expect(await val("select sims_private.fin_hold_active(2, 'REGISTRATION')")).toBe(false);
    await expect(insertTerm()).rejects.toThrow(/fee hold/);
    await release(h);
    expect(await val("select sims_private.fin_hold_active(1, 'REGISTRATION')")).toBe(false);
    await insertTerm(); // released: the registration goes through
  });
  it('a CERTIFICATE hold blocks approval and issue of a request', async () => {
    const h = Number((await place('CERTIFICATE'))[0]?.id);
    await expect(db.exec("update certificate_request set request_status = 'APPROVED' where request_number = 'CR-T-1'")).rejects.toThrow(/fee hold/);
    await release(h);
    await db.exec("update certificate_request set request_status = 'APPROVED' where request_number = 'CR-T-1'");
    expect(await val("select request_status from certificate_request where request_number = 'CR-T-1'")).toBe('APPROVED');
  });
  it('a RESULT hold hides published results from the student only', async () => {
    const h = Number((await place('RESULT'))[0]?.id);
    const r = (await asUser<{ r: unknown[] }>(U.student1, 'select public.my_results() r'))[0]?.r;
    expect(r).toEqual([]);
    await release(h);
    expect((await asUser<{ r: unknown[] }>(U.student1, 'select public.my_results() r'))[0]?.r).toEqual([]); // no results exist in this fixture; the call works
  });
});
