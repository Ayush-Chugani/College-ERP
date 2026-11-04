import { describe, expect, it } from 'vitest';
import { parseFinId } from '@/features/finance-data';
import { accountListParams, allocationSchema, assessmentSchema, itemNet, money, newKey, paymentSchema, refundDecisionSchema, refundProcessSchema, refundRequestSchema } from '@/lib/finance-validation';

const item = { fee_type_id: '1', description: '', original_amount: '1000', concession_amount: '', scholarship_amount: '', adjustment_amount: '' };
const asm = { assessment_number: 'FA-1', academic_year_id: '2', assessment_type: 'ACADEMIC', assessment_date: '2025-01-01', due_date: '', items: [item] };

describe('assessment schema', () => {
  it('defaults blank components to zero and parses numbers', () => {
    const v = assessmentSchema.parse(asm);
    expect(v.items[0]).toMatchObject({ fee_type_id: 1, original_amount: 1000, concession_amount: 0, scholarship_amount: 0, adjustment_amount: 0 });
    expect(v.academic_year_id).toBe(2);
  });
  it('allows a negative adjustment but not a negative net', () => {
    expect(assessmentSchema.safeParse({ ...asm, items: [{ ...item, adjustment_amount: '-100' }] }).success).toBe(true);
    expect(assessmentSchema.safeParse({ ...asm, items: [{ ...item, concession_amount: '600', scholarship_amount: '500' }] }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...asm, items: [{ ...item, adjustment_amount: '-1001' }] }).success).toBe(false);
  });
  it('rejects negative or over-precise amounts, empty items and a due date before the assessment date', () => {
    expect(assessmentSchema.safeParse({ ...asm, items: [{ ...item, original_amount: '-5' }] }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...asm, items: [{ ...item, original_amount: '10.123' }] }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...asm, items: [{ ...item, concession_amount: 'abc' }] }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...asm, items: [] }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...asm, due_date: '2024-12-31' }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...asm, assessment_type: 'GIFT' }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...asm, academic_year_id: '' }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...asm, assessment_number: '  ' }).success).toBe(false);
  });
  it('itemNet matches the server formula and tolerates partial input', () => {
    expect(itemNet({ original_amount: '1000', concession_amount: '100', scholarship_amount: '50.5', adjustment_amount: '-10' })).toBe(839.5);
    expect(itemNet({ original_amount: 'x' })).toBe(0);
    expect(itemNet({})).toBe(0);
  });
});

describe('payment, allocation and refund schemas', () => {
  it('amounts must be positive with at most 2 decimals', () => {
    const ok = { transaction_number: 'P1', payment_mode_id: '3', amount: '250.50', bank_reference: ' R1 ' };
    expect(paymentSchema.parse(ok)).toMatchObject({ payment_mode_id: 3, amount: 250.5, bank_reference: 'R1' });
    for (const bad of ['0', '-1', '1.234', '', 'abc', '12345678901']) expect(paymentSchema.safeParse({ ...ok, amount: bad }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...ok, payment_mode_id: '' }).success).toBe(false);
    expect(allocationSchema.safeParse({ assessment_item_id: '4', amount: '0' }).success).toBe(false);
    expect(allocationSchema.parse({ assessment_item_id: '4', amount: '10' })).toEqual({ assessment_item_id: 4, amount: 10 });
  });
  it('refund request needs a reason; decision amount optional; processing needs a mode', () => {
    expect(refundRequestSchema.safeParse({ request_number: 'R', payment_transaction_id: '1', amount: '5', reason: ' ' }).success).toBe(false);
    expect(refundRequestSchema.parse({ request_number: 'R', payment_transaction_id: '1', amount: '5', reason: 'Duplicate' })).toMatchObject({ amount: 5 });
    expect(refundDecisionSchema.parse({ approved_amount: '' }).approved_amount).toBeUndefined();
    expect(refundDecisionSchema.parse({ approved_amount: '40.5' }).approved_amount).toBe(40.5);
    expect(refundDecisionSchema.safeParse({ approved_amount: '1.234' }).success).toBe(false);
    expect(refundProcessSchema.safeParse({ refund_transaction_number: 'RF', refund_mode_id: '', amount: '5' }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('list params fall back safely', () => {
    expect(accountListParams.parse({ status: 'WEIRD', page: '0', q: ' ab ' })).toEqual({ q: 'ab', status: undefined, page: 1 });
  });
  it('parseFinId accepts only positive integers', () => {
    expect(parseFinId('7')).toBe(7);
    for (const bad of ['0', '-1', '1.5', 'x', '', '99999999999999999999']) expect(parseFinId(bad)).toBeNull();
  });
  it('newKey is deterministic for fixed inputs and well-formed', () => {
    expect(newKey('FA', 1000, 0.5)).toBe(newKey('FA', 1000, 0.5));
    expect(newKey('FA', 1000, 0.5)).toMatch(/^FA-[0-9A-Z]+$/);
    expect(newKey('FA', 1000, 0.1)).not.toBe(newKey('FA', 1000, 0.9));
  });
  it('money formats to two decimals and tolerates null', () => {
    expect(money(1234.5)).toBe('1,234.50');
    expect(money(null)).toBe('—');
  });
});
