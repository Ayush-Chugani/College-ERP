import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, U } from './world';

/** Research leftovers (migration 055). facultyD1 is employee 1 and owns the activities; registrar2 is unrelated staff; superAdmin holds every STAFF_PROFILE permission. */
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const j = (o: Record<string, unknown>) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
let JOURNAL_A = 0;
let CONF_A = 0;
let CONTRIB_A = 0;
let PROJECT_A = 0;
let AGENCY = 0;
const setStatus = (id: number, code: string) => db.exec(`UPDATE staff_activity SET approval_status_id = (SELECT approval_status_id FROM approval_status WHERE status_code = '${code}') WHERE staff_activity_id = ${id}`);

async function activity(title: string): Promise<number> {
  await db.exec(`INSERT INTO staff_activity (employee_id, activity_type_id, institution_id, activity_title, verification_status_id, approval_status_id)
    VALUES (1, 1, 1, '${title}', (SELECT verification_status_id FROM verification_status WHERE status_code = 'NOT_SUBMITTED'), (SELECT approval_status_id FROM approval_status WHERE status_code = 'DRAFT'))`);
  return Number(await val('select max(staff_activity_id) from staff_activity'));
}

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  JOURNAL_A = await activity('Journal paper');
  CONF_A = await activity('Conference');
  CONTRIB_A = await activity('Contribution');
  PROJECT_A = await activity('Project');
  await db.exec(`
    INSERT INTO journal_publication (staff_activity_id, publication_type_id, journal_id, paper_title, publication_year) VALUES (${JOURNAL_A}, 1, 1, 'P', 2026);
    INSERT INTO conference_activity (staff_activity_id, conference_event_id, conference_contribution_type_id) VALUES (${CONF_A}, 1, 1);
    INSERT INTO staff_professional_contribution (staff_activity_id, professional_contribution_type_id) VALUES (${CONTRIB_A}, 1);
    INSERT INTO funded_research_project (staff_activity_id, project_title, principal_investigator_employee_id, department_id, funding_agency_id, funding_type_id, sanctioned_amount, sanction_date, project_start_date, research_status_id)
      VALUES (${PROJECT_A}, 'Crop study', 1, 1, 1, 1, 100000, '2025-01-01', '2025-02-01', 1);
    INSERT INTO indexing_agency (indexing_agency_id, agency_code, agency_name) VALUES (1, 'SCOPUS', 'Scopus') ON CONFLICT DO NOTHING;
  `);
  AGENCY = Number(await val("select indexing_agency_id from indexing_agency order by 1 limit 1"));
}, 180_000);

describe('research supervision (section kind activity)', () => {
  const save = (sub: string, parent: number, p: Record<string, unknown>, id: number | null = null) => asUser<{ id: string }>(sub, `select public.section_save('activity', ${parent}, 'supervision', ${id ?? 'null'}, ${j(p)}) id`);
  const body = { supervision_level: 'PHD', scholar_name: 'A Scholar', supervision_role: 'SUPERVISOR', status: 'ONGOING', research_title: 'Soil' };
  it('the owner adds, edits and deletes while the activity is a draft; others cannot', async () => {
    const id = Number((await save(U.facultyD1, CONTRIB_A, body))[0]?.id);
    expect(id).toBeGreaterThan(0);
    await save(U.facultyD1, CONTRIB_A, { ...body, status: 'SUBMITTED' }, id);
    expect(await val(`select status from research_supervision where research_supervision_id = ${id}`)).toBe('SUBMITTED');
    await expect(save(U.registrar2, CONTRIB_A, body)).rejects.toThrow(/Not authorised/);
    await expect(save(U.student1, CONTRIB_A, body)).rejects.toThrow(/Not authorised/);
    await expect(save(U.facultyD1, JOURNAL_A, body)).rejects.toThrow(/Not authorised/); // wrong kind of activity
    await expect(save(U.facultyD1, CONTRIB_A, { ...body, completion_date: '2020-01-01', registration_date: '2021-01-01' })).rejects.toThrow();
    const rows = (await asUser<{ r: { rows: unknown[]; can_create: boolean } }>(U.facultyD1, `select public.section_rows('activity', ${CONTRIB_A}, 'supervision') r`))[0]?.r;
    expect(rows?.rows.length).toBe(1);
    expect(rows?.can_create).toBe(true);
    await expect(asUser(U.registrar2, `select public.section_rows('activity', ${CONTRIB_A}, 'supervision')`)).rejects.toThrow(/Not authorised/);
    await asUser(U.facultyD1, `select public.section_delete('activity', ${CONTRIB_A}, 'supervision', ${id})`);
    expect(Number(await val('select count(*) from research_supervision'))).toBe(0);
  });
  it('is locked while the activity is under review and open again once approved', async () => {
    await setStatus(CONTRIB_A, 'SUBMITTED');
    await expect(save(U.facultyD1, CONTRIB_A, body)).rejects.toThrow(/Not authorised/);
    await setStatus(CONTRIB_A, 'APPROVED');
    expect(Number((await save(U.facultyD1, CONTRIB_A, body))[0]?.id)).toBeGreaterThan(0);
    expect(Number(await val("select count(*) from activity_audit where entity_name = 'research_supervision'"))).toBeGreaterThanOrEqual(3);
  });
});

describe('financial utilisation', () => {
  const save = (sub: string, p: Record<string, unknown>, id: number | null = null) => asUser<{ id: string }>(sub, `select public.section_save('activity', ${PROJECT_A}, 'utilization', ${id ?? 'null'}, ${j(p)}) id`);
  it('keeps the balance consistent', async () => {
    const ok = { financial_year: '2025-26', opening_balance: 1000, amount_received: 500, expenditure_amount: 300, closing_balance: 1200 };
    const id = Number((await save(U.facultyD1, ok))[0]?.id);
    expect(Number(await val(`select closing_balance from research_project_financial_utilization where utilization_id = ${id}`))).toBe(1200);
    await expect(save(U.facultyD1, { ...ok, closing_balance: 999 })).rejects.toThrow();
    await expect(save(U.facultyD1, { ...ok, expenditure_amount: -1 })).rejects.toThrow();
    await expect(save(U.registrar2, ok)).rejects.toThrow(/Not authorised/);
  });
});

describe('indexing', () => {
  it('lists, saves, updates and deletes for journal and conference activities', async () => {
    await expect(asUser(U.registrar2, `select public.staff_indexing_list(${JOURNAL_A})`)).rejects.toThrow(/Not authorised/);
    await asUser(U.facultyD1, `select public.staff_indexing_save(${JOURNAL_A}, ${AGENCY}, 'CLAIMED', 2026, 'https://example.org/x', null)`);
    await asUser(U.facultyD1, `select public.staff_indexing_save(${JOURNAL_A}, ${AGENCY}, 'NOT_INDEXED', 2026, null, 'withdrawn')`); // upsert
    const l = (await asUser<{ l: { rows: { status: string; year: number }[]; kind: string; can_edit: boolean } }>(U.facultyD1, `select public.staff_indexing_list(${JOURNAL_A}) l`))[0]?.l;
    expect([l?.rows.length, l?.rows[0]?.status, l?.kind, l?.can_edit]).toEqual([1, 'NOT_INDEXED', 'JOURNAL', true]);
    await asUser(U.facultyD1, `select public.staff_indexing_save(${CONF_A}, ${AGENCY}, 'CLAIMED', null, null, null)`);
    expect((await asUser<{ l: { kind: string } }>(U.facultyD1, `select public.staff_indexing_list(${CONF_A}) l`))[0]?.l.kind).toBe('CONFERENCE');
    await expect(asUser(U.facultyD1, `select public.staff_indexing_save(${JOURNAL_A}, ${AGENCY}, 'BOGUS', null, null, null)`)).rejects.toThrow(/Unknown indexing status/);
    await expect(asUser(U.facultyD1, `select public.staff_indexing_save(${JOURNAL_A}, ${AGENCY}, 'CLAIMED', null, 'javascript:alert(1)', null)`)).rejects.toThrow(/http/);
    await expect(asUser(U.facultyD1, `select public.staff_indexing_save(${JOURNAL_A}, ${AGENCY}, 'VERIFIED', null, null, null)`)).rejects.toThrow(/verifier/);
    await expect(asUser(U.registrar2, `select public.staff_indexing_save(${JOURNAL_A}, ${AGENCY}, 'CLAIMED', null, null, null)`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.facultyD1, `select public.staff_indexing_save(${CONTRIB_A}, ${AGENCY}, 'CLAIMED', null, null, null)`)).rejects.toThrow(/Not authorised/);
    await asUser(U.superAdmin, `select public.staff_indexing_save(${JOURNAL_A}, ${AGENCY}, 'VERIFIED', 2026, null, null)`);
    await asUser(U.facultyD1, `select public.staff_indexing_delete(${JOURNAL_A}, ${AGENCY})`);
    expect(Number(await val('select count(*) from journal_publication_indexing'))).toBe(0);
    await expect(as('anon', null, `select public.staff_indexing_list(${JOURNAL_A})`)).rejects.toThrow(/permission denied/);
  });
  it('is locked while the activity is submitted', async () => {
    await setStatus(JOURNAL_A, 'SUBMITTED');
    await expect(asUser(U.facultyD1, `select public.staff_indexing_save(${JOURNAL_A}, ${AGENCY}, 'CLAIMED', null, null, null)`)).rejects.toThrow(/Not authorised/);
  });
});

describe('journal metrics are reference data', () => {
  it('only a global STAFF_PROFILE configurer maintains them', async () => {
    const tbls = (await asUser<{ tbl: string }>(U.superAdmin, 'select tbl from public.ref_list()')).map((r) => r.tbl);
    expect(tbls).toContain('journal_metric');
    expect(tbls).toContain('metric_type');
    expect(await asUser(U.facultyD1, 'select * from public.ref_list()')).toEqual([]);
    const mt = Number((await asUser<{ id: string }>(U.superAdmin, `select public.ref_save('metric_type', null, ${j({ metric_code: 'IF', metric_name: 'Impact factor' })}) id`))[0]?.id);
    await db.exec("INSERT INTO journal (journal_id, journal_name, journal_type_id) VALUES (900, 'J', 1) ON CONFLICT DO NOTHING");
    const id = Number((await asUser<{ id: string }>(U.superAdmin, `select public.ref_save('journal_metric', null, ${j({ journal_id: 900, metric_type_id: mt, metric_year: 2025, metric_value: 3.2 })}) id`))[0]?.id);
    expect(id).toBeGreaterThan(0);
    await expect(asUser(U.facultyD1, `select public.ref_save('journal_metric', null, ${j({ journal_id: 900, metric_type_id: mt, metric_year: 2024, metric_value: 1 })})`)).rejects.toThrow(/Not authorised|STAFF_PROFILE/);
    expect((await asUser<{ id: string }>(U.facultyD1, "select * from public.section_lookup_options('journal')")).length).toBeGreaterThan(0);
  });
});
