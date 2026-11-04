import { describe, expect, it } from 'vitest';
import { parseId } from '@/features/academic-data';
import { nul, schemeListParams, schemeSchema, semesterSchema, termSchema, yearSchema } from '@/lib/academic-validation';

describe('academic year', () => {
  const ok = { year_code: '2025-26', start_date: '2025-06-01', end_date: '2026-05-31', status: 'PLANNED' };
  it('accepts valid years and rejects inverted/equal dates, bad status and long codes', () => {
    expect(yearSchema.safeParse(ok).success).toBe(true);
    expect(yearSchema.safeParse({ ...ok, end_date: '2025-06-01' }).success).toBe(false); // must be strictly after
    expect(yearSchema.safeParse({ ...ok, end_date: '2025-01-01' }).success).toBe(false);
    expect(yearSchema.safeParse({ ...ok, year_code: '2025-2026x' }).success).toBe(false);
    expect(yearSchema.safeParse({ ...ok, year_code: ' ' }).success).toBe(false);
    expect(yearSchema.safeParse({ ...ok, status: 'OPEN' }).success).toBe(false);
    expect(yearSchema.safeParse({ ...ok, start_date: '' }).success).toBe(false);
  });
});

describe('academic term', () => {
  const ok = { term_code: 'ODD', term_name: 'Odd term', term_type: 'ODD', start_date: '2025-08-01', end_date: '2025-12-31', status: 'PLANNED' };
  it('allows same-day terms but not inverted ones; registration window must be ordered', () => {
    expect(termSchema.safeParse(ok).success).toBe(true);
    expect(termSchema.safeParse({ ...ok, end_date: '2025-08-01' }).success).toBe(true);
    expect(termSchema.safeParse({ ...ok, end_date: '2025-07-31' }).success).toBe(false);
    expect(termSchema.safeParse({ ...ok, registration_start_date: '2025-07-01', registration_end_date: '2025-06-01' }).success).toBe(false);
    expect(termSchema.safeParse({ ...ok, registration_start_date: '2025-06-01', registration_end_date: '2025-07-01' }).success).toBe(true);
    expect(termSchema.safeParse({ ...ok, term_type: '' }).success).toBe(false);
    expect(termSchema.safeParse({ ...ok, term_code: 'x'.repeat(21) }).success).toBe(false);
  });
  it('blank optional dates become undefined and are sent as null', () => {
    const v = termSchema.parse({ ...ok, registration_start_date: '', registration_end_date: '' });
    expect(v.registration_start_date).toBeUndefined();
    expect(nul(v.registration_start_date)).toBeNull();
  });
});

describe('semester', () => {
  it('needs a whole number from 1 to 255 and a name up to 50 characters', () => {
    expect(semesterSchema.parse({ semester_number: '3', semester_name: 'Semester 3' }).semester_number).toBe(3);
    for (const n of ['0', '-1', '256', '1.5', 'x', '']) expect(semesterSchema.safeParse({ semester_number: n, semester_name: 'S' }).success).toBe(false);
    expect(semesterSchema.safeParse({ semester_number: '1', semester_name: 'x'.repeat(51) }).success).toBe(false);
  });
});

describe('curriculum scheme', () => {
  const ok = { programme_id: '2', scheme_code: 'CS-2024', scheme_name: 'CS Scheme', regulation_year: '2024', total_credits: '160', effective_from: '2024-06-01', status: 'DRAFT' };
  it('requires a programme, valid regulation year, ordered dates and sensible credits', () => {
    const v = schemeSchema.parse(ok);
    expect(v).toMatchObject({ programme_id: 2, regulation_year: 2024, total_credits: 160 });
    expect(schemeSchema.safeParse({ ...ok, programme_id: '' }).success).toBe(false);
    expect(schemeSchema.safeParse({ ...ok, regulation_year: '1800' }).success).toBe(false);
    expect(schemeSchema.safeParse({ ...ok, regulation_year: '2156' }).success).toBe(false);
    expect(schemeSchema.safeParse({ ...ok, effective_to: '2024-01-01' }).success).toBe(false);
    expect(schemeSchema.safeParse({ ...ok, effective_to: '2025-01-01' }).success).toBe(true);
    expect(schemeSchema.safeParse({ ...ok, total_credits: '-1' }).success).toBe(false);
    expect(schemeSchema.parse({ ...ok, total_credits: '' }).total_credits).toBeUndefined();
    expect(schemeSchema.safeParse({ ...ok, status: 'LIVE' }).success).toBe(false);
  });
  it('list params fall back safely and sanitise the search', () => {
    expect(schemeListParams.parse({ page: '0', status: 'NOPE', programme: 'x', q: 'a,b)' })).toEqual({ page: 1, status: undefined, programme: undefined, q: 'ab' });
    expect(schemeListParams.parse({ status: 'ACTIVE', programme: '4' })).toMatchObject({ status: 'ACTIVE', programme: 4 });
  });
});

describe('route ids', () => {
  it('only positive integers', () => {
    expect(parseId('12')).toBe(12);
    for (const bad of ['0', '-1', '1.5', 'a', '', '9'.repeat(20)]) expect(parseId(bad)).toBeNull();
  });
});
