import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createWorld, db, fkSwitch, role, U } from './world';

/**
 * Migration 051 rewrote covers(), can_student() and can_employee() for speed (a decoded, per-transaction permission set). This file keeps the ORIGINAL definitions under other names (they read the
 * effective-permission view directly, with no caching) and checks that old and new agree for every user, permission set, target and mode in the fixture world, including DENY rows, SELF grants and NULL ids.
 * One deliberate difference: the original returned NULL (not false) when a caller who is not a student/employee held a SELF grant and asked about someone's record, because `p_id = current_student_id()` is NULL;
 * callers that write `IF NOT can_student(...)` would then skip their refusal. The new functions return false, so the comparison treats the original's NULL as false.
 */
const ref = `
CREATE FUNCTION sims_private.ref_covers(p_codes text[], p_inst bigint, p_campus bigint, p_dept bigint, p_prog bigint, p_self_ok boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(bool_or(m.permission_effect = 'ALLOW') AND NOT bool_or(m.permission_effect = 'DENY'), false)
    FROM public.v_effective_user_permission m
    WHERE m.user_id = sims_private.current_user_id() AND m.permission_code = ANY (p_codes)
      AND (m.scope_type = 'GLOBAL' OR (m.scope_type = 'INSTITUTION' AND m.scope_entity_id = p_inst) OR (m.scope_type = 'CAMPUS' AND m.scope_entity_id = p_campus)
           OR (m.scope_type = 'DEPARTMENT' AND m.scope_entity_id = p_dept) OR (m.scope_type = 'PROGRAMME' AND m.scope_entity_id = p_prog) OR (p_self_ok AND m.scope_type = 'SELF'))
$$;
CREATE FUNCTION sims_private.ref_can_student(p_codes text[], p_id bigint, p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT sims_private.ref_covers(p_codes, NULL, NULL, NULL, NULL, false)
        OR (NOT p_write AND p_id IS NOT NULL AND p_id = sims_private.current_student_id() AND sims_private.ref_covers(p_codes, NULL, NULL, NULL, NULL, true))
        OR EXISTS (SELECT 1 FROM public.student_programme_enrolment e JOIN public.programme p ON p.programme_id = e.programme_id JOIN public.department d ON d.department_id = p.department_id
                   JOIN public.campus c ON c.campus_id = d.campus_id WHERE e.student_id = p_id AND sims_private.ref_covers(p_codes, c.institution_id, c.campus_id, d.department_id, p.programme_id, false))
$$;
CREATE FUNCTION sims_private.ref_can_employee(p_codes text[], p_id bigint, p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT sims_private.ref_covers(p_codes, NULL, NULL, NULL, NULL, false)
        OR (NOT p_write AND p_id IS NOT NULL AND p_id = sims_private.current_employee_id() AND sims_private.ref_covers(p_codes, NULL, NULL, NULL, NULL, true))
        OR EXISTS (SELECT 1 FROM public.employee e WHERE e.employee_id = p_id AND sims_private.ref_covers(p_codes, e.institution_id, NULL, NULL, NULL, false))
        OR EXISTS (SELECT 1 FROM public.employee_assignment a JOIN public.campus c ON c.campus_id = a.campus_id WHERE a.employee_id = p_id AND a.end_date IS NULL
                   AND sims_private.ref_covers(p_codes, c.institution_id, c.campus_id, a.department_id, NULL, false))
$$;
GRANT EXECUTE ON FUNCTION sims_private.ref_covers(text[], bigint, bigint, bigint, bigint, boolean), sims_private.ref_can_student(text[], bigint, boolean), sims_private.ref_can_employee(text[], bigint, boolean) TO authenticated;`;

const USERS = Object.entries(U);
const CODE_SETS = [['STUDENT.ALL.READ'], ['STUDENT.ALL.CREATE'], ['EMPLOYEE.ALL.READ'], ['FEES.FEE_PAYMENT.READ'], ['STUDENT.ALL.READ', 'EMPLOYEE.ALL.READ'], ['NO.SUCH.CODE'], ['GRIEVANCE.ALL.UPDATE', 'STUDENT.ALL.UPDATE']];
const lit = (a: string[]) => `ARRAY[${a.map((c) => `'${c}'`).join(',')}]::text[]`;

beforeAll(async () => {
  await createWorld();
  await db.exec(ref);
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO employee_assignment (employee_id, campus_id, department_id, designation_id, start_date) VALUES (1, 1, 1, 1, '2024-01-01');
    INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
      SELECT 4, permission_id, 'DENY', 'INSTITUTION', 1, 'deny' FROM permission WHERE permission_code = 'STUDENT.ALL.READ';
    INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
      SELECT 4, permission_id, 'ALLOW', 'GLOBAL', NULL, 'allow' FROM permission WHERE permission_code = 'EMPLOYEE.ALL.READ';
    INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
      SELECT 9, permission_id, 'ALLOW', 'PROGRAMME', 3, 'prog' FROM permission WHERE permission_code = 'STUDENT.ALL.READ';
    INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
      SELECT 1, permission_id, 'ALLOW', 'SELF', NULL, 'self' FROM permission WHERE permission_code IN ('STUDENT.ALL.READ', 'EMPLOYEE.ALL.READ');
    INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, justification)
      SELECT 3, permission_id, 'ALLOW', 'SELF', NULL, 'self' FROM permission WHERE permission_code IN ('EMPLOYEE.ALL.READ');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, department_id) VALUES (2, ${role('HEAD_DEPARTMENT')}, 'DEPARTMENT', 2);
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, campus_id) VALUES (4, ${role('CAMPUS_DIRECTOR')}, 'CAMPUS', 2);
  `);
  await fkSwitch(true);
}, 180_000);

describe('old and new permission functions agree', () => {
  it('covers() for every user, code set and scope combination', { timeout: 120_000 }, async () => {
    const combos: [string, string, string, string][] = [];
    for (const i of ['null', '1', '2']) for (const c of ['null', '1', '2']) for (const d of ['null', '1', '2', '3']) for (const p of ['null', '1', '3']) combos.push([i, c, d, p]);
    let n = 0;
    for (const [name, sub] of USERS) {
      for (const codes of CODE_SETS) {
        const row = (await asUser<Record<string, unknown>>(sub, `select ${combos.map((_, k) => `(sims_private.covers(${lit(codes)}, ${combos[k]!.join(', ')}, false) is not distinct from coalesce(sims_private.ref_covers(${lit(codes)}, ${combos[k]!.join(', ')}, false), false)) and (sims_private.covers(${lit(codes)}, ${combos[k]!.join(', ')}, true) is not distinct from coalesce(sims_private.ref_covers(${lit(codes)}, ${combos[k]!.join(', ')}, true), false)) as c${k}`).join(', ')}`))[0] ?? {};
        for (const [k, v] of Object.entries(row)) expect(v, `${name} ${codes.join('+')} combo ${k}`).toBe(true);
        n += combos.length * 2;
      }
    }
    expect(n).toBeGreaterThan(3000);
  });
  it('can_student() for every user, code set, student and mode (including NULL)', async () => {
    for (const [name, sub] of USERS) {
      for (const codes of CODE_SETS) {
        const checks = [] as string[];
        for (const id of ['null', '1', '2', '3', '999']) for (const w of ['false', 'true']) checks.push(`(sims_private.can_student(${lit(codes)}, ${id}, ${w}) is not distinct from coalesce(sims_private.ref_can_student(${lit(codes)}, ${id}, ${w}), false)) as s_${id}_${w}`);
        const row = (await asUser<Record<string, unknown>>(sub, `select ${checks.join(', ')}`))[0] ?? {};
        for (const [k, v] of Object.entries(row)) expect(v, `${name} ${codes.join('+')} ${k}`).toBe(true);
      }
    }
  });
  it('can_employee() for every user, code set, employee and mode (including NULL)', async () => {
    for (const [name, sub] of USERS) {
      for (const codes of CODE_SETS) {
        const checks = [] as string[];
        for (const id of ['null', '1', '2', '999']) for (const w of ['false', 'true']) checks.push(`(sims_private.can_employee(${lit(codes)}, ${id}, ${w}) is not distinct from coalesce(sims_private.ref_can_employee(${lit(codes)}, ${id}, ${w}), false)) as e_${id}_${w}`);
        const row = (await asUser<Record<string, unknown>>(sub, `select ${checks.join(', ')}`))[0] ?? {};
        for (const [k, v] of Object.entries(row)) expect(v, `${name} ${codes.join('+')} ${k}`).toBe(true);
      }
    }
  });
  it('the fixture exercises both outcomes, so the comparison is not vacuous', async () => {
    const t = (await asUser<{ a: boolean; b: boolean; c: boolean }>(U.registrar1, `select sims_private.can_student(ARRAY['STUDENT.ALL.READ'], 1, false) a, sims_private.can_student(ARRAY['STUDENT.ALL.READ'], 3, false) b, sims_private.can_employee(ARRAY['EMPLOYEE.ALL.READ'], 1, false) c`))[0];
    expect([t?.a, t?.b]).toEqual([true, false]);
    expect((await asUser<{ x: boolean }>(U.finance1, `select sims_private.can_student(ARRAY['STUDENT.ALL.READ'], 1, false) x`))[0]?.x).toBe(false); // DENY override of user 4
  });
  it('permissions are not carried over between requests', async () => {
    expect((await asUser<{ x: boolean }>(U.registrar2, `select sims_private.can_student(ARRAY['STUDENT.ALL.READ'], 3, false) x`))[0]?.x).toBe(true);
    await db.exec(`UPDATE user_role_assignment SET assignment_status = 'REVOKED' WHERE user_id = 9`);
    expect((await asUser<{ x: boolean }>(U.registrar2, `select sims_private.can_student(ARRAY['STUDENT.ALL.READ'], 3, false) x`))[0]?.x).toBe(true); // still allowed through the programme override
    await db.exec(`UPDATE user_permission_override SET valid_to = now() - interval '1 second', valid_from = now() - interval '1 day' WHERE user_id = 9`);
    expect((await asUser<{ x: boolean }>(U.registrar2, `select sims_private.can_student(ARRAY['STUDENT.ALL.READ'], 3, false) x`))[0]?.x).toBe(false); // expired grants stop at the next request
  });
});
