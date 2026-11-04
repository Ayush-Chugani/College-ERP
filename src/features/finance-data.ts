import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountListParams } from '@/lib/finance-validation';

export const FIN_PAGE_SIZE = 20;

export type AccountListRow = {
  student_account_id: number; student_id: number; account_number: string; account_status: string; student_number: string; display_name: string;
  total_payable: number; total_paid: number; total_balance: number; total_count: number;
};
export type AccountInfo = Omit<AccountListRow, 'total_count'> & { opening_balance: number; credit_balance: number };
export type AssessmentRow = {
  fee_assessment_id: number; assessment_number: string; academic_year_id: number; assessment_type: string; assessment_date: string; due_date: string | null;
  gross_amount: number; net_payable_amount: number; amount_paid: number; balance_amount: number; assessment_status: string;
};
export type ItemRow = {
  assessment_item_id: number; fee_assessment_id: number; fee_type_id: number; description: string | null; original_amount: number; net_amount: number; amount_paid: number; balance_amount: number; item_status: string;
};
export type PaymentRow = {
  payment_transaction_id: number; transaction_number: string; transaction_date: string; payment_mode_id: number; amount: number; payment_status: string; bank_reference_number: string | null; payer_name: string | null;
};
export type AllocationRow = { payment_transaction_id: number; assessment_item_id: number; allocated_amount: number };
export type RefundRequestRow = {
  refund_request_id: number; refund_request_number: string; payment_transaction_id: number | null; request_date: string; refund_reason: string; requested_amount: number; approved_amount: number | null; request_status: string;
};
export type RefundRow = { refund_request_id: number; refund_transaction_number: string; refund_amount: number; refund_status: string; refund_date: string };
export type Opt = { id: number; label: string };

export async function listAccounts(supabase: SupabaseClient, p: AccountListParams) {
  const { data, error } = await supabase.rpc('fin_accounts', { p_search: p.q ?? null, p_status: p.status ?? null, p_limit: FIN_PAGE_SIZE, p_offset: (p.page - 1) * FIN_PAGE_SIZE });
  const rows = (data ?? []) as AccountListRow[];
  return { rows, total: rows[0] ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}
export async function getAccount(supabase: SupabaseClient, id: number): Promise<AccountInfo | null> {
  const { data, error } = await supabase.rpc('fin_account_info', { p_student_account_id: id });
  if (error || !data || (data as unknown[]).length === 0) return null;
  return (data as AccountInfo[])[0] ?? null;
}

const ASSESSMENT_COLS = 'fee_assessment_id, assessment_number, academic_year_id, assessment_type, assessment_date, due_date, gross_amount, net_payable_amount, amount_paid, balance_amount, assessment_status';

export async function loadAccountLedger(supabase: SupabaseClient, accountId: number) {
  const [asm, pay, req, years, types, modes] = await Promise.all([
    supabase.from('student_fee_assessment').select(ASSESSMENT_COLS).eq('student_account_id', accountId).order('assessment_date', { ascending: false }).order('fee_assessment_id', { ascending: false }),
    supabase.from('payment_transaction').select('payment_transaction_id, transaction_number, transaction_date, payment_mode_id, amount, payment_status, bank_reference_number, payer_name').eq('student_account_id', accountId).order('transaction_date', { ascending: false }),
    supabase.from('refund_request').select('refund_request_id, refund_request_number, payment_transaction_id, request_date, refund_reason, requested_amount, approved_amount, request_status').eq('student_account_id', accountId).order('refund_request_id', { ascending: false }),
    supabase.rpc('fin_academic_years'),
    supabase.from('fee_type').select('fee_type_id, fee_code, fee_name').eq('is_active', true).order('fee_name'),
    supabase.from('payment_mode').select('payment_mode_id, mode_code, mode_name, requires_reference, is_online, is_active').eq('is_active', true).order('mode_name'),
  ]);
  const assessments = (asm.data ?? []) as AssessmentRow[];
  const payments = (pay.data ?? []) as PaymentRow[];
  const requests = (req.data ?? []) as RefundRequestRow[];
  const aIds = assessments.map((a) => a.fee_assessment_id);
  const pIds = payments.map((p) => p.payment_transaction_id);
  const rIds = requests.map((r) => r.refund_request_id);
  const [items, allocs, refunds] = await Promise.all([
    aIds.length ? supabase.from('student_fee_assessment_item').select('assessment_item_id, fee_assessment_id, fee_type_id, description, original_amount, net_amount, amount_paid, balance_amount, item_status').in('fee_assessment_id', aIds).order('assessment_item_id') : Promise.resolve({ data: [] }),
    pIds.length ? supabase.from('payment_allocation').select('payment_transaction_id, assessment_item_id, allocated_amount').in('payment_transaction_id', pIds) : Promise.resolve({ data: [] }),
    rIds.length ? supabase.from('fee_refund').select('refund_request_id, refund_transaction_number, refund_amount, refund_status, refund_date').in('refund_request_id', rIds).order('refund_date') : Promise.resolve({ data: [] }),
  ]);
  const feeTypes = ((types.data ?? []) as { fee_type_id: number; fee_code: string; fee_name: string }[]).map((t) => ({ id: t.fee_type_id, label: `${t.fee_code} — ${t.fee_name}` }));
  const payModes = ((modes.data ?? []) as { payment_mode_id: number; mode_code: string; mode_name: string; requires_reference: boolean; is_online: boolean }[]);
  return {
    assessments, payments, requests,
    items: (items.data ?? []) as ItemRow[], allocations: (allocs.data ?? []) as AllocationRow[], refunds: (refunds.data ?? []) as RefundRow[],
    years: ((years.data ?? []) as { academic_year_id: number; year_code: string }[]).map((y) => ({ id: y.academic_year_id, label: y.year_code })),
    feeTypes,
    modes: payModes,
  };
}

export function parseFinId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export type PaymentReceiptRow = { payment_transaction_id: number; fee_receipt_id: number | null; receipt_number: string | null; receipt_status: string | null };
export type HoldRow = { financial_hold_id: number; hold_type: string; hold_reason: string; hold_status: string; placed_at: string; released_at: string | null; release_reason: string | null };
export type ReceiptDetail = {
  fee_receipt_id: number; receipt_number: string; receipt_date: string; receipt_amount: number; receipt_status: string; cancellation_reason: string | null; original_receipt_id: number | null;
  transaction_number: string; transaction_date: string; payment_mode: string; bank_reference: string | null; payer_name: string | null; account_number: string; student_account_id: number;
  student_number: string; student_name: string; allocations: { fee: string; amount: number }[]; can_cancel: boolean;
};
export const HOLD_TYPES = ['REGISTRATION', 'EXAMINATION', 'HALL_TICKET', 'RESULT', 'CERTIFICATE', 'HOSTEL_CHECKOUT', 'GRADUATION', 'OTHER'] as const;

/** Receipts per payment and holds of an account; a failure shows as "none" rather than breaking the page (the reader may lack FEE_PAYMENT.READ). */
export async function loadReceiptsAndHolds(supabase: SupabaseClient, accountId: number) {
  const [rc, hd] = await Promise.all([supabase.rpc('fin_payment_receipts', { p_student_account_id: accountId }), supabase.rpc('fin_holds', { p_student_account_id: accountId })]);
  return { receipts: (rc.data ?? []) as PaymentReceiptRow[], holds: (hd.data ?? []) as HoldRow[] };
}
export async function getReceipt(supabase: SupabaseClient, id: number): Promise<ReceiptDetail | null> {
  const { data, error } = await supabase.rpc('fin_receipt_get', { p_receipt_id: id });
  return error || !data ? null : (data as ReceiptDetail);
}
