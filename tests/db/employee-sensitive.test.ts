import { beforeAll, describe, expect, it } from 'vitest';
import { as, asUser, createWorld, db, fkSwitch, role, U } from './world';

/** PAN, Aadhaar, bank accounts and HR documents (migration 054). Employee 1 is the faculty user (facultyD1); hr1 is an HR administrator, hr2 an HR officer, in institution 1. */
const HR1 = '00000000-0000-0000-0000-0000000000c1';
const HR2 = '00000000-0000-0000-0000-0000000000c2';
const HR_OTHER = '00000000-0000-0000-0000-0000000000c3';
const val = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0] ?? {})[0];
const one = async <T>(sub: string, sql: string) => (await asUser<T>(sub, sql))[0] as T;

const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
/** Appends the Verhoeff check digit. */
function withCheck(payload: string): string {
  let c = 0;
  const s = payload + '0';
  for (let i = 0; i < s.length; i++) c = D[c]![P[i % 8]![Number(s[s.length - 1 - i])]!]!;
  return payload + INV[c];
}
const AADHAAR = withCheck('23456789012');
const AADHAAR2 = withCheck('34567890123');

beforeAll(async () => {
  await createWorld();
  await fkSwitch(false);
  await db.exec(`
    INSERT INTO user_account (user_id, username, password_hash) VALUES (21, 'hr1', 'x'), (22, 'hr2', 'x'), (23, 'hrother', 'x');
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id) VALUES
      (21, ${role('HR_ADMIN')}, 'INSTITUTION', 1), (22, ${role('HR_ADMIN')}, 'INSTITUTION', 1), (23, ${role('HR_ADMIN')}, 'INSTITUTION', 2);
    INSERT INTO auth.users (id) VALUES ('${HR1}'), ('${HR2}'), ('${HR_OTHER}');
    SELECT sims_private.link_auth_user('${HR1}', 21, 'test');
    SELECT sims_private.link_auth_user('${HR2}', 22, 'test');
    SELECT sims_private.link_auth_user('${HR_OTHER}', 23, 'test');
    INSERT INTO document_type (document_type_id, document_code, document_name, is_active) VALUES (1, 'ID', 'ID proof', true) ON CONFLICT DO NOTHING;
    INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('sims-documents', 'employee/1/abc-letter.pdf', '{"size": 1000}'), ('sims-documents', 'employee/1/abc-appt.pdf', '{"size": 1000}');
  `);
}, 180_000);

describe('encryption', () => {
  it('stores ciphertext, never the number, and the fingerprint is keyed', async () => {
    await asUser(U.facultyD1, `select public.emp_pan_save(1, 'abcpe1234f', 'Emp One', null, null)`);
    const row = (await db.query<{ c: string; m: string; f: string }>('select encode(pan_number_ciphertext, \'hex\') c, pan_number_masked m, pan_number_fingerprint f from employee_pan where employee_id = 1')).rows[0]!;
    expect(row.m).toBe('XXXXX1234F');
    expect(Buffer.from(row.c, 'hex').toString('latin1')).not.toContain('ABCPE1234F');
    expect(row.f).toMatch(/^[0-9a-f]{64}$/);
    expect(row.f).not.toBe(await val("select encode(sha256('ABCPE1234F'::bytea), 'hex')"));
    expect(await val("select sims_private.pii_decrypt(pan_number_ciphertext) from employee_pan where employee_id = 1")).toBe('ABCPE1234F');
  });
  it('clients cannot read ciphertext, the key or the helpers', async () => {
    await expect(asUser(HR1, 'select pan_number_ciphertext from employee_pan')).rejects.toThrow(/permission denied/);
    await expect(asUser(HR1, 'select sims_private.pii_key()')).rejects.toThrow(/permission denied/);
    await expect(asUser(HR1, 'select * from vault.decrypted_secrets')).rejects.toThrow(/permission denied|does not exist/);
    expect((await asUser(HR1, 'select pan_number_masked from employee_pan')).length).toBe(1);
  });
});

describe('PAN', () => {
  it('validates the format and rejects duplicates', async () => {
    for (const bad of ['', 'ABCDE1234', 'ABCXE1234F', '12345ABCDE']) await expect(asUser(HR1, `select public.emp_pan_save(2, '${bad}', 'X', null, null)`)).rejects.toThrow(/valid PAN|Not authorised/);
    await expect(asUser(HR1, "select public.emp_pan_save(1, 'ABCPE1234F', '', null, null)")).rejects.toThrow(/name as on the PAN/);
    await db.exec(`INSERT INTO employee (employee_id, institution_id, employment_source_id, employee_number, first_name, display_name, joining_date, employment_type) VALUES (3,1,1,'E3','E','Emp Three','2021-01-01','REGULAR')`);
    await expect(asUser(HR1, "select public.emp_pan_save(3, 'ABCPE1234F', 'Emp Three', null, null)")).rejects.toThrow(/already registered/);
  });
  it('authorisation: owner, HR of the institution, nobody else', async () => {
    await expect(asUser(HR_OTHER, "select public.emp_pan_save(3, 'AAAPA1111A', 'X', null, null)")).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.registrar1, "select public.emp_pan_save(3, 'AAAPA1111A', 'X', null, null)")).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.student1, "select public.emp_pan_save(1, 'AAAPA1111A', 'X', null, null)")).rejects.toThrow(/Not authorised/);
    await expect(as('anon', null, "select public.emp_pan_save(1, 'AAAPA1111A', 'X', null, null)")).rejects.toThrow(/permission denied/);
    await expect(asUser(U.facultyD1, "select public.emp_pan_save(3, 'AAAPA1111A', 'X', null, null)")).rejects.toThrow(/Not authorised/); // not their own record
  });
  it('four-eyes verification; a verified record is locked for the owner; changes reset it', async () => {
    const id = Number(await val('select employee_pan_id from employee_pan where employee_id = 1'));
    await expect(asUser(U.facultyD1, `select public.emp_sensitive_review('PAN', ${id}, 'VERIFIED')`)).rejects.toThrow(/Not authorised/);
    await asUser(HR1, `select public.emp_sensitive_review('PAN', ${id}, 'REJECTED', 'blurred')`);
    await expect(asUser(HR1, `select public.emp_sensitive_review('PAN', ${id}, 'VERIFIED')`)).rejects.toThrow(/Only a pending/);
    await asUser(U.facultyD1, `select public.emp_pan_save(1, 'ABCPE1234F', 'Emp One', null, 'resubmitted')`); // owner may correct a rejected record
    expect(await val(`select verification_status from employee_pan where employee_pan_id = ${id}`)).toBe('PENDING');
    await asUser(HR1, "select public.emp_pan_save(1, 'ABCPE1234F', 'Emp One', null, 'hr touched')"); // HR1 is now the last editor
    await expect(asUser(HR1, `select public.emp_sensitive_review('PAN', ${id}, 'VERIFIED')`)).rejects.toThrow(/entered or changed yourself/);
    await asUser(HR2, `select public.emp_sensitive_review('PAN', ${id}, 'VERIFIED')`);
    expect(await val(`select verification_status from employee_pan where employee_pan_id = ${id}`)).toBe('VERIFIED');
    await expect(asUser(U.facultyD1, "select public.emp_pan_save(1, 'AAAPA1111A', 'Emp One', null, null)")).rejects.toThrow(/only be changed by HR/);
    await asUser(HR1, "select public.emp_pan_save(1, 'AAAPA1111A', 'Emp One', null, null)");
    expect(await val(`select verification_status from employee_pan where employee_pan_id = ${id}`)).toBe('PENDING');
    expect(await val(`select pan_number_masked from employee_pan where employee_pan_id = ${id}`)).toBe('XXXXX1111A');
  });
});

describe('Aadhaar', () => {
  it('needs a valid number (Verhoeff) and a stated purpose', async () => {
    for (const bad of ['123456789012', '023456789012', '2345678901', AADHAAR.slice(0, 11) + ((Number(AADHAAR[11]) + 1) % 10)]) await expect(asUser(HR1, `select public.emp_aadhaar_save(1, '${bad}', 'Emp One', 'payroll', null)`)).rejects.toThrow(/valid 12-digit/);
    await expect(asUser(HR1, `select public.emp_aadhaar_save(1, '${AADHAAR}', 'Emp One', '', null)`)).rejects.toThrow(/why the Aadhaar/);
    const id = Number((await one<{ id: string }>(HR1, `select public.emp_aadhaar_save(1, '${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}', 'Emp One', 'Statutory payroll compliance', null) id`)).id);
    expect(await val(`select aadhaar_number_masked from employee_aadhaar where employee_aadhaar_id = ${id}`)).toBe(`XXXX XXXX ${AADHAAR.slice(8)}`);
    await expect(asUser(HR1, `select public.emp_aadhaar_save(3, '${AADHAAR}', 'Emp Three', 'payroll check', null)`)).rejects.toThrow(/already registered/);
    await asUser(HR1, `select public.emp_aadhaar_save(3, '${AADHAAR2}', 'Emp Three', 'payroll check', null)`);
  });
});

describe('bank accounts', () => {
  it('validates, requires confirmation, keeps one primary, and masks', async () => {
    const call = (extra: string) => `select public.emp_bank_save(1, ${extra})`;
    await expect(asUser(HR1, call("null, 'Emp One', 'SBI', 'Main', '123456789012', '123456789013', 'SBIN0001234', 'SAVINGS', null, true, true")) ).rejects.toThrow(/do not match/);
    await expect(asUser(HR1, call("null, 'Emp One', 'SBI', 'Main', '12345', '12345', 'SBIN0001234', 'SAVINGS', null, true, true"))).rejects.toThrow(/9 to 18 digits/);
    await expect(asUser(HR1, call("null, 'Emp One', 'SBI', 'Main', '123456789012', '123456789012', 'BAD', 'SAVINGS', null, true, true"))).rejects.toThrow(/IFSC/);
    const a = Number((await one<{ id: string }>(U.facultyD1, call("null, 'Emp One', 'SBI', 'Main', '123456789012', '123456789012', 'sbin0001234', 'SAVINGS', null, true, true") + ' id'.replace(' id', ' as id'))).id);
    expect(a).toBeGreaterThan(0);
    const b = Number((await one<{ id: string }>(HR1, call("null, 'Emp One', 'HDFC', 'City', '998877665544', '998877665544', 'HDFC0000123', 'SALARY', null, true, false") + ' as id')).id);
    expect(Number(await val('select count(*) from employee_bank_account where employee_id = 1 and is_primary'))).toBe(1);
    expect(await val(`select is_primary from employee_bank_account where employee_bank_account_id = ${b}`)).toBe(true);
    await expect(asUser(HR1, call("null, 'Emp One', 'X', 'Y', '998877665544', '998877665544', 'HDFC0000123', 'SALARY', null, false, false"))).rejects.toThrow(/already registered/);
    const list = (await one<{ l: { bank: { masked: string; ifsc: string }[]; can: Record<string, boolean> } }>(U.facultyD1, 'select public.emp_sensitive_list(1) l')).l;
    expect(list.bank.map((x) => x.masked).sort()).toEqual(['XXXXXX5544', 'XXXXXX9012']);
    expect(list.can.owner).toBe(true);
    expect(list.can.verify_bank).toBe(false);
    // edit without a new number keeps the old one and resets the verification
    await asUser(HR1, `select public.emp_bank_save(1, ${a}, 'Emp One', 'SBI', 'Other branch', null, null, 'SBIN0001234', 'SAVINGS', null, false, true)`);
    expect(await val(`select sims_private.pii_decrypt(account_number_ciphertext) from employee_bank_account where employee_bank_account_id = ${a}`)).toBe('123456789012');
    await asUser(HR2, `select public.emp_sensitive_review('BANK_ACCOUNT', ${a}, 'VERIFIED')`);
    expect(await val(`select account_status from employee_bank_account where employee_bank_account_id = ${a}`)).toBe('ACTIVE');
  });
});

describe('reveal, listing and the access log', () => {
  it('only EXPORT holders or the owner can see a full number, and every reveal is logged', async () => {
    const id = Number(await val('select employee_pan_id from employee_pan where employee_id = 1'));
    await expect(asUser(HR_OTHER, `select public.emp_sensitive_reveal('PAN', ${id}, 'audit check')`)).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.student1, `select public.emp_sensitive_reveal('PAN', ${id}, 'curious')`)).rejects.toThrow(/Not authorised/);
    expect((await one<{ v: string }>(U.facultyD1, `select public.emp_sensitive_reveal('PAN', ${id}) v`)).v).toBe('AAAPA1111A'); // owner, no purpose needed
    await expect(asUser(HR1, `select public.emp_sensitive_reveal('PAN', ${id}, 'x')`)).rejects.toThrow(/purpose/);
    expect((await one<{ v: string }>(HR1, `select public.emp_sensitive_reveal('PAN', ${id}, 'payroll tax filing') v`)).v).toBe('AAAPA1111A');
    expect(Number(await val("select count(*) from employee_sensitive_access_audit where action_code = 'DECRYPT' and entity_type = 'PAN'"))).toBe(2);
    expect(Number(await val("select count(*) from employee_sensitive_access_audit where access_purpose like '%AAAPA%'"))).toBe(0);
    await expect(asUser(HR1, "delete from employee_sensitive_access_audit")).rejects.toThrow(/permission denied/);
    await expect(asUser(HR_OTHER, 'select public.emp_sensitive_list(1)')).rejects.toThrow(/Not authorised/);
    await expect(asUser(U.student1, 'select public.emp_sensitive_list(1)')).rejects.toThrow(/Not authorised/);
  });
  it('the audit log never contains the numbers, and the sensitive tables are not row-audited', async () => {
    expect(Number(await val("select count(*) from activity_audit where details::text ~* 'AAAPA1111A|123456789012'"))).toBe(0);
    expect(Number(await val("select count(*) from pg_trigger where tgrelid in ('employee_pan'::regclass, 'employee_aadhaar'::regclass, 'employee_bank_account'::regclass) and tgname like '%audit%'"))).toBe(0);
  });
});

describe('HR documents', () => {
  let DOC = 0;
  const reg = (sub: string, key: string, extra = '') => one<{ id: string }>(sub, `select public.employee_document_register(1, 1, 1, 'Letter', '${key}', 'letter.pdf', 'application/pdf', 1000, null ${extra}) id`);
  it('register needs the owner or EMPLOYEE_DOCUMENT.CREATE, and a matching stored object', async () => {
    await expect(reg(HR_OTHER, 'employee/1/abc-letter.pdf')).rejects.toThrow(/Not authorised/);
    await expect(reg(U.facultyD1, 'employee/2/abc-letter.pdf')).rejects.toThrow(/not stored under this employee/);
    await expect(reg(U.facultyD1, 'employee/1/missing.pdf')).rejects.toThrow(/not been uploaded/);
    DOC = Number((await reg(U.facultyD1, 'employee/1/abc-letter.pdf')).id);
    await expect(reg(U.facultyD1, 'employee/1/abc-letter.pdf')).rejects.toThrow(/already registered/);
    expect(await val(`select verification_status || '/' || approval_status from employee_document where employee_document_id = ${DOC}`)).toBe('PENDING/NOT_REQUIRED');
  });
  it('listing and download are scoped and logged', async () => {
    expect((await asUser(U.facultyD1, 'select * from public.employee_document_list(1)')).length).toBe(1);
    expect((await asUser(HR1, 'select * from public.employee_document_list(1)')).length).toBe(1);
    expect(await asUser(HR_OTHER, 'select * from public.employee_document_list(1)')).toEqual([]);
    expect(await asUser(U.student1, 'select * from public.employee_document_list(1)')).toEqual([]);
    await expect(asUser(HR_OTHER, `select public.employee_document_download_info(${DOC})`)).rejects.toThrow(/Not authorised/);
    const info = (await one<{ i: { storage_key: string } }>(HR1, `select public.employee_document_download_info(${DOC}) i`)).i;
    expect(info.storage_key).toBe('employee/1/abc-letter.pdf');
    expect(Number(await val("select count(*) from employee_sensitive_access_audit where action_code = 'DOWNLOAD'"))).toBe(1);
  });
  it('review is four-eyes; an approval category also needs APPROVE; verified documents are kept', async () => {
    await expect(asUser(U.facultyD1, `select public.employee_document_review(${DOC}, 'VERIFIED')`)).rejects.toThrow(/Not authorised/);
    await asUser(HR1, `select public.employee_document_review(${DOC}, 'VERIFIED')`);
    await expect(asUser(HR1, `select public.employee_document_delete(${DOC})`)).rejects.toThrow(/verified document cannot be deleted/);
    const appt = Number((await one<{ id: string }>(HR1, "select public.employee_document_register(1, (select employee_document_category_id from employee_document_category where category_code = 'PAN'), 1, 'Appt', 'employee/1/abc-appt.pdf', 'appt.pdf', 'application/pdf', 1000, null) id")).id);
    expect(await val(`select approval_status from employee_document where employee_document_id = ${appt}`)).toBe('PENDING');
    await expect(asUser(HR1, `select public.employee_document_review(${appt}, 'VERIFIED')`)).rejects.toThrow(/yourself/);
    await asUser(HR2, `select public.employee_document_review(${appt}, 'VERIFIED')`);
    expect(await val(`select approval_status from employee_document where employee_document_id = ${appt}`)).toBe('APPROVED');
    await expect(asUser(HR1, `select public.employee_document_delete(${appt})`)).rejects.toThrow(/verified document cannot be deleted/);
  });
});
