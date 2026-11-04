import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellText, listColumns, SECTION_KINDS } from '@/lib/record-validation';
import { fieldKind, REF_TABLES, type DetailColumn } from '@/lib/staff-validation';

const col = (o: Partial<DetailColumn> & { name: string }): DetailColumn => ({ type: 'character varying', required: false, max_length: 100, ref_table: null, choices: null, ...o });

describe('lists and cells', () => {
  it('shows required, short columns first and at most five', () => {
    const cols = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n, i) => col({ name: n, required: i % 2 === 0, type: i === 1 ? 'text' : 'character varying', max_length: i === 1 ? null : 50 }));
    const shown = listColumns(cols).map((c) => c.name);
    expect(shown).toHaveLength(5);
    expect(shown.slice(0, 4)).toEqual(['a', 'c', 'e', 'g']);
    expect(shown).not.toContain('b'); // long text last
  });
  it('formats booleans, references, choices, long text and blanks', () => {
    const labels = { country: new Map([[7, 'India']]) };
    expect(cellText(col({ name: 'x', type: 'boolean' }), true, labels)).toBe('Yes');
    expect(cellText(col({ name: 'x', type: 'boolean' }), false, labels)).toBe('No');
    expect(cellText(col({ name: 'country_id', type: 'integer', ref_table: 'country' }), 7, labels)).toBe('India');
    expect(cellText(col({ name: 'country_id', type: 'integer', ref_table: 'country' }), 8, labels)).toBe('#8');
    expect(cellText(col({ name: 't', type: 'text', choices: ['HOME_AWAY'] }), 'HOME_AWAY', labels)).toBe('Home away');
    expect(cellText(col({ name: 'n' }), 'x'.repeat(80), labels)).toHaveLength(58);
    for (const blank of [null, undefined, '']) expect(cellText(col({ name: 'n' }), blank, labels)).toBe('—');
  });
  it('treats every reference table as a listable dropdown', () => {
    for (const t of REF_TABLES) expect(fieldKind(col({ name: 'x_id', type: 'integer', ref_table: t }))).toBe('ref');
    expect(fieldKind(col({ name: 'x_id', type: 'bigint', ref_table: 'student' }))).toBe('number-id');
  });
});

describe('drift against migrations 046 and 055', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/055_research_leftovers.sql'), 'utf8'); // redefines ref_tables and the section list
  it('reference tables match the database list', () => {
    const body = /FUNCTION sims_private\.ref_tables\(\)[\s\S]*?ARRAY\[([^\]]*)\]/.exec(sql)?.[1] ?? '';
    expect([...body.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual([...REF_TABLES].sort());
  });
  it('knows both parent kinds and the section routes exist', () => {
    expect([...SECTION_KINDS]).toEqual(['student', 'employee', 'activity']);
    for (const kind of SECTION_KINDS) expect(sql).toContain(`('${kind}', '`);
    const root = path.resolve(__dirname, '../../src/app/(app)');
    expect(fs.existsSync(path.join(root, 'students/[id]/records/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'employees/[id]/records/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'admin/reference/[table]/page.tsx'))).toBe(true);
  });
});
