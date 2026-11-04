import { z } from 'zod';
import { optionalId } from '@/lib/validation';

export const ASSESSMENT_TYPES = ['ADMISSION', 'ACADEMIC', 'EXAMINATION', 'HOSTEL', 'TRANSPORT', 'LIBRARY', 'CERTIFICATE', 'PENALTY', 'SERVICE', 'OTHER'] as const;
export const ACCOUNT_STATUSES = ['ACTIVE', 'ON_HOLD', 'CLOSED'] as const;

const requiredDate = (what: string) => z.string().min(1, `${what} is required`).regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const optDate = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date');
const optText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).optional().transform((v) => (v ? v : undefined));
const key = (what: string) => z.string().trim().min(1, `${what} is required`).max(60, 'At most 60 characters');
const id = (what: string) => z.string().min(1, `Select ${what}`).regex(/^\d{1,15}$/, `Select ${what}`).transform(Number);

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const SIGNED_MONEY = /^-?\d{1,10}(\.\d{1,2})?$/;

/** Required positive amount (> 0, at most 2 decimals), as the database demands for payments and refunds. */
export const positiveAmount = (label: string) =>
  z.string().trim().min(1, `${label} is required`).regex(MONEY, `${label}: a number with at most 2 decimals`).transform(Number).refine((v) => v > 0, `${label} must be greater than zero`);
/** Optional non-negative amount (blank = 0). */
const nonNegative = (label: string) =>
  z.string().optional().transform((v) => (v === undefined || v.trim() === '' ? '0' : v.trim())).refine((v) => MONEY.test(v), `${label}: a number with at most 2 decimals`).transform(Number);
/** Optional signed amount (adjustments may be negative; blank = 0). */
const signed = (label: string) =>
  z.string().optional().transform((v) => (v === undefined || v.trim() === '' ? '0' : v.trim())).refine((v) => SIGNED_MONEY.test(v), `${label}: a number with at most 2 decimals`).transform(Number);

export const feeItemSchema = z
  .object({
    fee_type_id: id('a fee type'),
    description: optText(250),
    original_amount: nonNegative('Amount').refine((v) => v >= 0),
    concession_amount: nonNegative('Concession'),
    scholarship_amount: nonNegative('Scholarship'),
    adjustment_amount: signed('Adjustment'),
    due_date: optDate,
  })
  .refine((v) => v.original_amount - v.concession_amount - v.scholarship_amount + v.adjustment_amount >= 0, { path: ['original_amount'], message: 'The net amount cannot be negative' });
export type FeeItemInput = z.input<typeof feeItemSchema>;

export const assessmentSchema = z
  .object({
    assessment_number: key('Assessment number'),
    academic_year_id: id('an academic year'),
    assessment_type: z.enum(ASSESSMENT_TYPES, { message: 'Select a type' }),
    assessment_date: requiredDate('Assessment date'),
    due_date: optDate,
    items: z.array(feeItemSchema).min(1, 'Add at least one fee item').max(100, 'At most 100 items'),
  })
  .refine((v) => !v.due_date || v.due_date >= v.assessment_date, { path: ['due_date'], message: 'The due date cannot be before the assessment date' });
export type AssessmentInput = z.input<typeof assessmentSchema>;
export type AssessmentValues = z.output<typeof assessmentSchema>;

/** Net of one item, for the live total in the form. */
export function itemNet(i: { original_amount?: string; concession_amount?: string; scholarship_amount?: string; adjustment_amount?: string }): number {
  const n = (s?: string) => (s && s.trim() !== '' && !Number.isNaN(Number(s)) ? Number(s) : 0);
  return Math.round((n(i.original_amount) - n(i.concession_amount) - n(i.scholarship_amount) + n(i.adjustment_amount)) * 100) / 100;
}

export const paymentSchema = z.object({
  transaction_number: key('Transaction number'),
  payment_mode_id: id('a payment mode'),
  amount: positiveAmount('Amount'),
  bank_reference: optText(120),
  payer_name: optText(150),
  remarks: optText(500),
});
export type PaymentInput = z.input<typeof paymentSchema>;
export type PaymentValues = z.output<typeof paymentSchema>;

export const allocationSchema = z.object({ assessment_item_id: id('a fee item'), amount: positiveAmount('Amount') });
export type AllocationInput = z.input<typeof allocationSchema>;
export type AllocationValues = z.output<typeof allocationSchema>;

export const refundRequestSchema = z.object({
  request_number: key('Request number'),
  payment_transaction_id: id('a payment'),
  amount: positiveAmount('Amount'),
  reason: z.string().trim().min(1, 'A reason is required').max(500, 'At most 500 characters'),
});
export type RefundRequestInput = z.input<typeof refundRequestSchema>;
export type RefundRequestValues = z.output<typeof refundRequestSchema>;

export const refundDecisionSchema = z.object({ approved_amount: z.string().trim().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || MONEY.test(v), 'A number with at most 2 decimals').transform((v) => (v === undefined ? undefined : Number(v))) });
export type RefundDecisionInput = z.input<typeof refundDecisionSchema>;

export const refundProcessSchema = z.object({
  refund_transaction_number: key('Refund transaction number'),
  refund_mode_id: id('a mode'),
  amount: positiveAmount('Amount'),
  bank_reference: optText(120),
});
export type RefundProcessInput = z.input<typeof refundProcessSchema>;
export type RefundProcessValues = z.output<typeof refundProcessSchema>;

export const openAccountSchema = z.object({ student_number: z.string().trim().min(1, 'Student number is required').max(40, 'At most 40 characters') });
export type OpenAccountInput = z.input<typeof openAccountSchema>;

export const accountListParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(ACCOUNT_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type AccountListParams = z.infer<typeof accountListParams>;

/** A default idempotency key, stable for the life of one form so a double submit replays instead of duplicating. */
export function newKey(prefix: string, now = Date.now(), rand = Math.random()): string {
  return `${prefix}-${now.toString(36).toUpperCase()}${Math.floor(rand * 1296).toString(36).toUpperCase().padStart(2, '0')}`;
}

export const money = (n: number | string | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export { optionalId };
