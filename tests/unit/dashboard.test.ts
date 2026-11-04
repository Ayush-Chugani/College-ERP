import { describe, expect, it } from 'vitest';
import { colourFor, employeeSlices, feeSeries, humanise, monthLabel, percent, resultSlices, rupees, stackEnrolments, sumSlices, toSlices } from '@/lib/dashboard-model';

describe('toSlices', () => {
  it('sums duplicates, drops zeros, sorts by size then name, tolerates string counts', () => {
    const s = toSlices([{ label: 'B', n: '2' }, { label: 'A', n: 2 }, { label: 'C', n: 0 }, { label: 'B', n: 1 }, { label: 'D', n: 'x' }]);
    expect(s).toEqual([{ name: 'B', value: 3 }, { name: 'A', value: 2 }]);
    expect(sumSlices(s)).toBe(5);
    expect(toSlices([])).toEqual([]);
  });
});

describe('humanise', () => {
  it('turns enum codes into sentences', () => {
    expect(humanise('PARTIALLY_PAID')).toBe('Partially paid');
    expect(humanise('ACTIVE')).toBe('Active');
    expect(humanise('')).toBe('');
  });
});

describe('stackEnrolments', () => {
  const rows = [
    { programme_id: 1, label: 'MCA', enrolment_status: 'ACTIVE', n: 10 }, { programme_id: 1, label: 'MCA', enrolment_status: 'COMPLETED', n: '4' },
    { programme_id: 2, label: 'BCA', enrolment_status: 'ACTIVE', n: 20 }, { programme_id: 3, label: 'MBA', enrolment_status: 'ON_HOLD', n: 1 },
  ];
  it('makes one stacked row per programme with a zero for missing statuses, largest first', () => {
    const r = stackEnrolments(rows);
    expect(r.total).toBe(35);
    expect(r.statuses).toEqual(['Active', 'Completed', 'On hold']);
    expect(r.data.map((d) => d.name)).toEqual(['BCA', 'MCA', 'MBA']);
    expect(r.data[1]).toEqual({ name: 'MCA', Active: 10, Completed: 4, 'On hold': 0 });
  });
  it('merges programmes beyond the limit into one "Other" row without losing counts', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ programme_id: i + 1, label: `P${i + 1}`, enrolment_status: 'ACTIVE', n: 12 - i }));
    const r = stackEnrolments(many, 8);
    expect(r.data).toHaveLength(9);
    expect(r.data[8]?.name).toBe('Other programmes (4)');
    expect(r.data.reduce((t, d) => t + Number(d.Active), 0)).toBe(many.reduce((t, x) => t + x.n, 0));
    expect(stackEnrolments([])).toEqual({ data: [], statuses: [], total: 0 });
  });
});

describe('fees', () => {
  it('labels months without locale dependence and parses numeric strings', () => {
    expect(monthLabel('2026-03-01')).toBe('Mar 2026');
    expect(monthLabel('2025-12-01')).toBe('Dec 2025');
    expect(feeSeries([{ month: '2026-01-01', collected: '1500.50', payments: '3' }])).toEqual([{ name: 'Jan 2026', collected: 1500.5, payments: 3 }]);
  });
  it('formats rupees with Indian grouping and percentages safely', () => {
    expect(rupees(1234567)).toBe('₹ 12,34,567');
    expect(rupees('999.6')).toBe('₹ 1,000');
    expect(rupees(null)).toBe('₹ 0');
    expect(percent(1, 4)).toBe('25%');
    expect(percent(5, 0)).toBe('—');
  });
});

describe('results and employees', () => {
  it('splits term results by publication', () => {
    const r = resultSlices([{ result_status: 'PASS', published: true, n: 5 }, { result_status: 'PASS', published: false, n: 2 }, { result_status: 'FAIL', published: false, n: 1 }]);
    expect(r.published).toEqual([{ name: 'Pass', value: 5 }]);
    expect(r.unpublished).toEqual([{ name: 'Pass', value: 2 }, { name: 'Fail', value: 1 }]);
  });
  it('groups employees by status and type', () => {
    const e = employeeSlices([{ employment_type: 'REGULAR', employment_status: 'ACTIVE', n: 3 }, { employment_type: 'CONTRACT', employment_status: 'ACTIVE', n: 2 }, { employment_type: 'REGULAR', employment_status: 'RESIGNED', n: 1 }]);
    expect(e.byStatus).toEqual([{ name: 'Active', value: 5 }, { name: 'Resigned', value: 1 }]);
    expect(e.byType).toEqual([{ name: 'Regular', value: 4 }, { name: 'Contract', value: 2 }]);
  });
});

describe('colourFor', () => {
  it('keeps semantic statuses on fixed colours regardless of position, and cycles otherwise', () => {
    expect(colourFor('Active', 0)).toBe(colourFor('active', 5));
    expect(colourFor('Fail', 0)).not.toBe(colourFor('Pass', 0));
    expect(colourFor('Mystery', 0)).toBe(colourFor('Other', 8));
    expect(colourFor('Mystery', 1)).not.toBe(colourFor('Mystery', 0));
  });
});
