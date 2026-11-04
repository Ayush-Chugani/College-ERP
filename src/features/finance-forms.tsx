'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { ItemRow, Opt, PaymentRow, RefundRequestRow } from '@/features/finance-data';
import {
  allocationSchema, ASSESSMENT_TYPES, assessmentSchema, itemNet, money, newKey, openAccountSchema, paymentSchema, refundDecisionSchema, refundProcessSchema, refundRequestSchema,
  type AllocationInput, type AllocationValues, type AssessmentInput, type AssessmentValues, type OpenAccountInput, type PaymentInput, type PaymentValues, type RefundDecisionInput,
  type RefundProcessInput, type RefundProcessValues, type RefundRequestInput, type RefundRequestValues,
} from '@/lib/finance-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
/** Business-rule messages raised by the finance RPCs are safe to show; anything else is generic. */
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023') return e.message;
  if (e.code === '42501') return /Not authorised/.test(e.message) ? e.message : 'You are not allowed to do that for this student.';
  if (e.code === '23505') return /already used|different/i.test(e.message) ? e.message : 'That number is already used. Use a different one.';
  if (e.code === '23503') return 'A selected option does not exist.';
  if (e.code === '23514' || e.code === 'P0001') return e.message.length < 240 ? e.message : fallback;
  return fallback;
}
const sel = 'h-9 w-full rounded-md border border-border bg-card px-3 text-sm';

// ---------------------------------------------------------------------------
export function OpenAccountForm() {
  const router = useRouter();
  const form = useForm<OpenAccountInput, unknown, { student_number: string }>({ resolver: zodResolver(openAccountSchema) });
  async function submit(v: { student_number: string }) {
    const { data, error } = await createClient().rpc('fin_open_account', { p_student_number: v.student_number });
    if (error) return void toast.error(dbMessage(error, 'Could not open the account.'));
    toast.success('Account ready.');
    router.push(`/finance/account/${data as number}`);
  }
  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Open account">
      <TextField id="oa" label="Open an account for student number" className="w-64" maxLength={40} {...form.register('student_number')} error={form.formState.errors.student_number?.message} />
      <div className="pt-6"><Button type="submit" disabled={form.formState.isSubmitting}>Open account</Button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function AssessmentForm({ accountId, years, feeTypes }: { accountId: number; years: Opt[]; feeTypes: Opt[] }) {
  const router = useRouter();
  const [number] = useState(() => newKey('FA'));
  const form = useForm<AssessmentInput, unknown, AssessmentValues>({
    resolver: zodResolver(assessmentSchema),
    defaultValues: { assessment_number: number, assessment_type: 'ACADEMIC', items: [{ fee_type_id: '', original_amount: '', concession_amount: '', scholarship_amount: '', adjustment_amount: '' }] },
  });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const watched = form.watch('items');
  const total = (watched ?? []).reduce((s, i) => s + itemNet(i as Record<string, string>), 0);
  const e = form.formState.errors;

  async function submit(v: AssessmentValues) {
    const { error } = await createClient().rpc('fin_create_fee_assessment', {
      p_assessment_number: v.assessment_number, p_student_account_id: accountId, p_academic_year_id: v.academic_year_id, p_assessment_type: v.assessment_type,
      p_assessment_date: v.assessment_date, p_due_date: v.due_date ?? null, p_items: v.items.map((i) => ({ ...i, description: i.description ?? null, due_date: i.due_date ?? null })),
    });
    if (error) return void toast.error(dbMessage(error, 'Could not create the assessment.'));
    toast.success('Fee assessment created.');
    router.refresh();
    form.reset();
  }

  if (years.length === 0 || feeTypes.length === 0) return <p className="text-sm text-muted-foreground">Fee assessments need at least one academic year and one active fee type to be defined first.</p>;
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate aria-label="New fee assessment">
      <div className="flex flex-wrap items-start gap-3">
        <TextField id="fan" label="Assessment number *" className="w-52" maxLength={60} hint="Doubles as the replay key: resubmitting the same number does not duplicate." {...form.register('assessment_number')} error={e.assessment_number?.message} />
        <SelectField id="fay" label="Academic year *" className="w-40" options={years} {...form.register('academic_year_id')} error={e.academic_year_id?.message} />
        <div className="w-40"><label htmlFor="fat" className="text-sm font-medium">Type *</label><select id="fat" className={sel} {...form.register('assessment_type')}>{ASSESSMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        <TextField id="fad" label="Assessment date *" type="date" className="w-40" {...form.register('assessment_date')} error={e.assessment_date?.message} />
        <TextField id="fau" label="Due date" type="date" className="w-40" {...form.register('due_date')} error={e.due_date?.message} />
      </div>
      <div className="space-y-3">
        {items.fields.map((f, i) => (
          <fieldset key={f.id} className="flex flex-wrap items-start gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Item {i + 1}</legend>
            <SelectField id={`ft${i}`} label="Fee type *" className="w-56" options={feeTypes} {...form.register(`items.${i}.fee_type_id`)} error={e.items?.[i]?.fee_type_id?.message} />
            <TextField id={`fd${i}`} label="Description" className="w-48" maxLength={250} {...form.register(`items.${i}.description`)} error={e.items?.[i]?.description?.message} />
            <TextField id={`fo${i}`} label="Amount *" className="w-28" inputMode="decimal" {...form.register(`items.${i}.original_amount`)} error={e.items?.[i]?.original_amount?.message} />
            <TextField id={`fc${i}`} label="Concession" className="w-28" inputMode="decimal" {...form.register(`items.${i}.concession_amount`)} error={e.items?.[i]?.concession_amount?.message} />
            <TextField id={`fs${i}`} label="Scholarship" className="w-28" inputMode="decimal" {...form.register(`items.${i}.scholarship_amount`)} error={e.items?.[i]?.scholarship_amount?.message} />
            <TextField id={`fj${i}`} label="Adjustment (±)" className="w-28" inputMode="decimal" {...form.register(`items.${i}.adjustment_amount`)} error={e.items?.[i]?.adjustment_amount?.message} />
            <TextField id={`fi${i}`} label="Item due date" type="date" className="w-40" {...form.register(`items.${i}.due_date`)} error={e.items?.[i]?.due_date?.message} />
            <div className="pt-6 text-sm">Net: <span className="font-medium">{money(itemNet((watched?.[i] ?? {}) as Record<string, string>))}</span></div>
            {items.fields.length > 1 && <div className="pt-6"><Button type="button" variant="outline" onClick={() => items.remove(i)}>Remove</Button></div>}
          </fieldset>
        ))}
        {e.items?.message && <p role="alert" className="text-sm text-destructive">{e.items.message}</p>}
        {e.items?.root?.message && <p role="alert" className="text-sm text-destructive">{e.items.root.message}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={items.fields.length >= 100} onClick={() => items.append({ fee_type_id: '', original_amount: '', concession_amount: '', scholarship_amount: '', adjustment_amount: '' })}>Add item</Button>
        <span className="text-sm">Total payable: <span className="font-semibold">{money(total)}</span> <span className="text-muted-foreground">(the server recomputes this)</span></span>
        <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving…' : 'Create assessment'}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function PaymentForm({ accountId, modes, blocked }: { accountId: number; modes: { payment_mode_id: number; mode_name: string; requires_reference: boolean; is_online: boolean }[]; blocked: string | null }) {
  const router = useRouter();
  const [number, setNumber] = useState(() => newKey('PAY'));
  const offline = modes.filter((m) => !m.is_online);
  const form = useForm<PaymentInput, unknown, PaymentValues>({ resolver: zodResolver(paymentSchema), defaultValues: { transaction_number: number } });
  async function submit(v: PaymentValues) {
    const mode = modes.find((m) => m.payment_mode_id === v.payment_mode_id);
    if (mode?.requires_reference && !v.bank_reference) return void form.setError('bank_reference', { message: 'This payment mode requires a reference number' });
    const { error } = await createClient().rpc('fin_record_payment', {
      p_transaction_number: v.transaction_number, p_student_account_id: accountId, p_payment_mode_id: v.payment_mode_id, p_amount: v.amount,
      p_bank_reference: v.bank_reference ?? null, p_payer_name: v.payer_name ?? null, p_remarks: v.remarks ?? null,
    });
    if (error) return void toast.error(dbMessage(error, 'Could not record the payment.'));
    toast.success('Payment recorded. Allocate it to fee items below.');
    const next = newKey('PAY');
    setNumber(next);
    form.reset({ transaction_number: next, payment_mode_id: '', amount: '', bank_reference: '', payer_name: '', remarks: '' });
    router.refresh();
  }
  if (blocked) return <p className="text-sm text-muted-foreground">{blocked}</p>;
  void number;
  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Record payment">
      <TextField id="pn" label="Transaction number *" className="w-52" maxLength={60} {...form.register('transaction_number')} error={form.formState.errors.transaction_number?.message} />
      <SelectField id="pm" label="Mode *" className="w-44" options={offline.map((m) => ({ id: m.payment_mode_id, label: m.mode_name }))} emptyHint="No offline payment modes are defined." {...form.register('payment_mode_id')} error={form.formState.errors.payment_mode_id?.message} />
      <TextField id="pa" label="Amount *" className="w-32" inputMode="decimal" {...form.register('amount')} error={form.formState.errors.amount?.message} />
      <TextField id="pr" label="Reference" className="w-44" maxLength={120} {...form.register('bank_reference')} error={form.formState.errors.bank_reference?.message} />
      <TextField id="pp" label="Payer name" className="w-44" maxLength={150} {...form.register('payer_name')} error={form.formState.errors.payer_name?.message} />
      <TextField id="prm" label="Remarks" className="w-52" maxLength={500} {...form.register('remarks')} error={form.formState.errors.remarks?.message} />
      <div className="pt-6"><Button type="submit" disabled={form.formState.isSubmitting}>Record payment</Button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function AllocateForm({ payment, unallocated, items }: { payment: PaymentRow; unallocated: number; items: ItemRow[] }) {
  const router = useRouter();
  const form = useForm<AllocationInput, unknown, AllocationValues>({ resolver: zodResolver(allocationSchema) });
  const open = items.filter((i) => i.balance_amount > 0 && !['CANCELLED', 'WAIVED', 'PAID'].includes(i.item_status));
  async function submit(v: AllocationValues) {
    if (v.amount > unallocated + 0.0001) return void form.setError('amount', { message: `Only ${money(unallocated)} of this payment is unallocated` });
    const item = open.find((i) => i.assessment_item_id === v.assessment_item_id);
    if (item && v.amount > item.balance_amount + 0.0001) return void form.setError('amount', { message: `The item's balance is ${money(item.balance_amount)}` });
    const { error } = await createClient().rpc('fin_allocate_payment', { p_payment_transaction_id: payment.payment_transaction_id, p_assessment_item_id: v.assessment_item_id, p_amount: v.amount });
    if (error) return void toast.error(dbMessage(error, 'Could not allocate the payment.'));
    toast.success('Payment allocated.');
    form.reset({ assessment_item_id: '', amount: '' });
    router.refresh();
  }
  if (unallocated <= 0) return <p className="text-xs text-muted-foreground">Fully allocated.</p>;
  if (payment.payment_status !== 'SUCCESS') return <p className="text-xs text-muted-foreground">Only successful payments can be allocated.</p>;
  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-wrap items-start gap-2" noValidate aria-label={`Allocate ${payment.transaction_number}`}>
      <SelectField id={`al${payment.payment_transaction_id}`} label={`Allocate (unallocated ${money(unallocated)})`} className="w-72" options={open.map((i) => ({ id: i.assessment_item_id, label: `${i.description ?? `Item ${i.assessment_item_id}`} — balance ${money(i.balance_amount)}` }))} emptyHint="No open fee items." {...form.register('assessment_item_id')} error={form.formState.errors.assessment_item_id?.message} />
      <TextField id={`aa${payment.payment_transaction_id}`} label="Amount" className="w-28" inputMode="decimal" {...form.register('amount')} error={form.formState.errors.amount?.message} />
      <div className="pt-6"><Button type="submit" variant="outline" disabled={form.formState.isSubmitting}>Allocate</Button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function RefundRequestForm({ accountId, payments }: { accountId: number; payments: PaymentRow[] }) {
  const router = useRouter();
  const eligible = payments.filter((p) => p.payment_status === 'SUCCESS' || p.payment_status === 'PARTIALLY_REFUNDED');
  const form = useForm<RefundRequestInput, unknown, RefundRequestValues>({ resolver: zodResolver(refundRequestSchema), defaultValues: { request_number: newKey('RR') } });
  async function submit(v: RefundRequestValues) {
    const { error } = await createClient().rpc('fin_request_refund', { p_request_number: v.request_number, p_student_account_id: accountId, p_payment_transaction_id: v.payment_transaction_id, p_amount: v.amount, p_reason: v.reason });
    if (error) return void toast.error(dbMessage(error, 'Could not request the refund.'));
    toast.success('Refund requested.');
    form.reset({ request_number: newKey('RR'), payment_transaction_id: '', amount: '', reason: '' });
    router.refresh();
  }
  if (eligible.length === 0) return <p className="text-sm text-muted-foreground">Refunds can be requested against successful payments.</p>;
  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Request refund">
      <TextField id="rn" label="Request number *" className="w-48" maxLength={60} {...form.register('request_number')} error={form.formState.errors.request_number?.message} />
      <SelectField id="rp" label="Payment *" className="w-64" options={eligible.map((p) => ({ id: p.payment_transaction_id, label: `${p.transaction_number} — ${money(p.amount)}` }))} {...form.register('payment_transaction_id')} error={form.formState.errors.payment_transaction_id?.message} />
      <TextField id="ra" label="Amount *" className="w-28" inputMode="decimal" {...form.register('amount')} error={form.formState.errors.amount?.message} />
      <TextField id="rr" label="Reason *" className="w-72" maxLength={500} {...form.register('reason')} error={form.formState.errors.reason?.message} />
      <div className="pt-6"><Button type="submit" disabled={form.formState.isSubmitting}>Request refund</Button></div>
    </form>
  );
}

export function RefundActions({ request, refundedTotal, modes, canApprove, canProcess }: { request: RefundRequestRow; refundedTotal: number; modes: { payment_mode_id: number; mode_name: string; is_online: boolean }[]; canApprove: boolean; canProcess: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const decision = useForm<RefundDecisionInput, unknown, { approved_amount?: number }>({ resolver: zodResolver(refundDecisionSchema) });
  const process = useForm<RefundProcessInput, unknown, RefundProcessValues>({ resolver: zodResolver(refundProcessSchema), defaultValues: { refund_transaction_number: newKey('RF') } });
  const decidable = request.request_status === 'SUBMITTED' || request.request_status === 'UNDER_REVIEW';
  const processable = request.request_status === 'APPROVED';
  const remaining = Math.max(0, (request.approved_amount ?? 0) - refundedTotal);

  async function decide(approve: boolean, v: { approved_amount?: number }) {
    if (approve && v.approved_amount !== undefined && v.approved_amount > request.requested_amount) return void decision.setError('approved_amount', { message: `At most the requested ${money(request.requested_amount)}` });
    setBusy(true);
    const { error } = await createClient().rpc('fin_decide_refund', { p_refund_request_id: request.refund_request_id, p_approve: approve, p_approved_amount: approve ? (v.approved_amount ?? null) : null });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'Could not record the decision.'));
    toast.success(approve ? 'Refund approved.' : 'Refund rejected.');
    setConfirm(null);
    router.refresh();
  }
  async function run(v: RefundProcessValues) {
    if (v.amount > remaining + 0.0001) return void process.setError('amount', { message: `At most ${money(remaining)} remains to refund` });
    const { error } = await createClient().rpc('fin_process_refund', { p_refund_transaction_number: v.refund_transaction_number, p_refund_request_id: request.refund_request_id, p_refund_mode_id: v.refund_mode_id, p_amount: v.amount, p_bank_reference: v.bank_reference ?? null });
    if (error) return void toast.error(dbMessage(error, 'Could not process the refund.'));
    toast.success('Refund processed.');
    process.reset({ refund_transaction_number: newKey('RF'), refund_mode_id: '', amount: '', bank_reference: '' });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {decidable && canApprove && (
        <form className="flex flex-wrap items-start gap-2" onSubmit={(ev) => ev.preventDefault()} noValidate aria-label={`Decide ${request.refund_request_number}`}>
          <TextField id={`ap${request.refund_request_id}`} label="Approved amount (blank = requested)" className="w-56" inputMode="decimal" {...decision.register('approved_amount')} error={decision.formState.errors.approved_amount?.message} />
          <div className="flex gap-2 pt-6">
            <Button type="button" disabled={busy} onClick={decision.handleSubmit(() => setConfirm('approve'))}>Approve…</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm('reject')}>Reject…</Button>
          </div>
        </form>
      )}
      {confirm && (
        <div role="alertdialog" aria-label="Confirm refund decision" className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="mb-2">{confirm === 'approve' ? 'Approve' : 'Reject'} refund request <strong>{request.refund_request_number}</strong>? A decision cannot be changed afterwards and is audited.</p>
          <div className="flex gap-2">
            <Button type="button" variant={confirm === 'reject' ? 'destructive' : 'default'} disabled={busy} onClick={decision.handleSubmit((v) => decide(confirm === 'approve', v))}>{busy ? 'Saving…' : 'Confirm'}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {processable && canProcess && remaining > 0 && (
        <form onSubmit={process.handleSubmit(run)} className="flex flex-wrap items-start gap-2" noValidate aria-label={`Process ${request.refund_request_number}`}>
          <TextField id={`rt${request.refund_request_id}`} label="Refund transaction no. *" className="w-48" maxLength={60} {...process.register('refund_transaction_number')} error={process.formState.errors.refund_transaction_number?.message} />
          <SelectField id={`rm${request.refund_request_id}`} label="Mode *" className="w-40" options={modes.filter((m) => !m.is_online).map((m) => ({ id: m.payment_mode_id, label: m.mode_name }))} {...process.register('refund_mode_id')} error={process.formState.errors.refund_mode_id?.message} />
          <TextField id={`rq${request.refund_request_id}`} label={`Amount * (remaining ${money(remaining)})`} className="w-48" inputMode="decimal" {...process.register('amount')} error={process.formState.errors.amount?.message} />
          <TextField id={`rb${request.refund_request_id}`} label="Reference" className="w-40" maxLength={120} {...process.register('bank_reference')} error={process.formState.errors.bank_reference?.message} />
          <div className="pt-6"><Button type="submit" disabled={process.formState.isSubmitting}>Process refund</Button></div>
        </form>
      )}
    </div>
  );
}
