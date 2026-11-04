import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOLD_TYPES } from '@/features/finance-data';
import { ATTENDANCE_WARNING_PERCENT, hhmm, isLow } from '@/features/personal-dashboard';

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, `../../supabase/migrations/${f}`), 'utf8');

describe('holds', () => {
  it('hold types mirror the table check and the RPC (drift test)', () => {
    const table = /enum_hold_type CHECK \(hold_type IN \(([^)]*)\)/.exec(read('008_student_finance.sql'))?.[1] ?? '';
    const names = (s: string) => [...s.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(names(table)).toEqual([...HOLD_TYPES].sort());
    const rpc = /IF p_hold_type NOT IN \(([^)]*)\)/.exec(read('047_finance_receipts_and_holds.sql'))?.[1] ?? '';
    expect(names(rpc)).toEqual([...HOLD_TYPES].sort());
  });
});

describe('receipt numbering', () => {
  it('the rule lives in one function (D-9 can change it in one place)', () => {
    const sql = read('047_finance_receipts_and_holds.sql');
    expect(sql.match(/fin_next_receipt_number\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(read('052_role_access_and_receipt_format.sql')).toContain("'REC/' || ay || '/'");
  });
});

describe('personal dashboard helpers', () => {
  it('flags attendance below the threshold only when there is a percentage', () => {
    expect(ATTENDANCE_WARNING_PERCENT).toBe(75);
    expect(isLow(74.9)).toBe(true);
    expect(isLow(75)).toBe(false);
    expect(isLow(100)).toBe(false);
    expect(isLow(null)).toBe(false);
  });
  it('trims times to hours and minutes', () => {
    expect(hhmm('09:30:00')).toBe('09:30');
    expect(hhmm('11:05')).toBe('11:05');
  });
});
