import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BenefitsPanel, AdjustmentsPanel, InstalmentsPanel, PenaltiesPanel } from '@/features/finance-benefits';
import { getAccount, loadAccountLedger, loadExtras, loadReceiptsAndHolds, parseFinId } from '@/features/finance-data';
import { HoldsPanel, ReceiptCell } from '@/features/finance-extras';
import { AllocateForm, AssessmentForm, PaymentForm, RefundActions, RefundRequestForm } from '@/features/finance-forms';
import { can } from '@/lib/context';
import { money } from '@/lib/finance-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Fee account' };

const th = 'px-3 py-2 font-medium';

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseFinId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const acct = await getAccount(supabase, id);
  if (!acct) notFound(); // missing or out of scope: same response
  const [L, RH, X] = await Promise.all([loadAccountLedger(supabase, id), loadReceiptsAndHolds(supabase, id), loadExtras(supabase, id)]);
  const receiptOf = new Map(RH.receipts.map((r) => [r.payment_transaction_id, r]));

  const yearOf = new Map(L.years.map((y) => [y.id, y.label]));
  const modeOf = new Map(L.modes.map((m) => [m.payment_mode_id, m.mode_name]));
  const allocatedBy = new Map<number, number>();
  for (const a of L.allocations) allocatedBy.set(a.payment_transaction_id, (allocatedBy.get(a.payment_transaction_id) ?? 0) + Number(a.allocated_amount));
  const refundedBy = new Map<number, number>();
  for (const r of L.refunds) if (r.refund_status !== 'FAILED' && r.refund_status !== 'CANCELLED') refundedBy.set(r.refund_request_id, (refundedBy.get(r.refund_request_id) ?? 0) + Number(r.refund_amount));
  const itemsBy = (aid: number) => L.items.filter((i) => i.fee_assessment_id === aid);
  const blocked = acct.account_status === 'CLOSED' ? 'This account is closed; payments cannot be recorded.' : null;

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{acct.display_name}</h1>
          <p className="text-sm text-muted-foreground">{acct.student_number} · account {acct.account_number} · <span className="font-medium text-foreground">{acct.account_status}</span></p>
        </div>
        <Link href="/finance" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">All accounts</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[['Payable', acct.total_payable], ['Paid', acct.total_paid], ['Balance', acct.total_balance], ['Credit balance', acct.credit_balance]].map(([k, v]) => (
          <Card key={String(k)}><CardContent className="pt-5"><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-semibold tabular-nums">{money(v as number)}</div></CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Fee assessments</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {L.assessments.length === 0 ? <p className="text-sm text-muted-foreground">No fees have been assessed.</p> : L.assessments.map((a) => (
            <div key={a.fee_assessment_id} className="rounded-md border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-3 py-2 text-sm">
                <span><span className="font-medium">{a.assessment_number}</span> · {a.assessment_type} · {yearOf.get(a.academic_year_id) ?? `year ${a.academic_year_id}`} · {a.assessment_date}{a.due_date ? ` · due ${a.due_date}` : ''}</span>
                <span><span className="font-medium">{a.assessment_status}</span> · payable {money(a.net_payable_amount)} · paid {money(a.amount_paid)} · balance {money(a.balance_amount)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left"><tr><th scope="col" className={th}>Item</th><th scope="col" className={`${th} text-right`}>Net</th><th scope="col" className={`${th} text-right`}>Paid</th><th scope="col" className={`${th} text-right`}>Balance</th><th scope="col" className={th}>Status</th></tr></thead>
                  <tbody>{itemsBy(a.fee_assessment_id).map((i) => (
                    <tr key={i.assessment_item_id} className="border-t border-border"><td className="px-3 py-1.5">{i.description ?? `Item ${i.assessment_item_id}`}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(i.net_amount)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(i.amount_paid)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(i.balance_amount)}</td><td className="px-3 py-1.5">{i.item_status}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          ))}
          {can(ctx, 'FEES.FEE_ASSESSMENT.CREATE') && (
            acct.account_status === 'ACTIVE' ? <AssessmentForm accountId={id} years={L.years} feeTypes={L.feeTypes} /> : <p className="text-sm text-muted-foreground">New assessments need an ACTIVE account (this one is {acct.account_status}).</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {L.payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : L.payments.map((p) => {
            const unalloc = Math.round((Number(p.amount) - (allocatedBy.get(p.payment_transaction_id) ?? 0)) * 100) / 100;
            return (
              <div key={p.payment_transaction_id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-medium">{p.transaction_number}</span> · {modeOf.get(p.payment_mode_id) ?? `mode ${p.payment_mode_id}`} · {p.transaction_date.slice(0, 10)}{p.bank_reference_number ? ` · ref ${p.bank_reference_number}` : ''}{p.payer_name ? ` · ${p.payer_name}` : ''}</span>
                  <span><span className="font-medium">{p.payment_status}</span> · {money(p.amount)} · unallocated {money(unalloc)}</span>
                </div>
                <div className="mt-2"><ReceiptCell receipt={receiptOf.get(p.payment_transaction_id)} paymentId={p.payment_transaction_id} canIssue={can(ctx, 'FEES.FEE_PAYMENT.CREATE')} payable={p.payment_status === 'SUCCESS' || p.payment_status === 'PARTIALLY_REFUNDED'} /></div>
                {can(ctx, 'FEES.FEE_PAYMENT.CREATE') && <div className="mt-2"><AllocateForm key={`${p.payment_transaction_id}-${unalloc}-${L.items.map((i) => i.balance_amount).join(',')}`} payment={p} unallocated={unalloc} items={L.items} /></div>}
              </div>
            );
          })}
          {can(ctx, 'FEES.FEE_PAYMENT.CREATE') && <PaymentForm accountId={id} modes={L.modes} blocked={blocked} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Concessions, scholarships and sponsorships</CardTitle></CardHeader>
        <CardContent><BenefitsPanel extras={X.extras} lookups={X.lookups} items={L.items} studentId={acct.student_id} years={L.years} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Instalments</CardTitle></CardHeader>
        <CardContent><InstalmentsPanel extras={X.extras} lookups={X.lookups} assessments={L.assessments} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Late fees and penalties</CardTitle></CardHeader>
        <CardContent><PenaltiesPanel accountId={id} extras={X.extras} lookups={X.lookups} assessments={L.assessments} years={L.years} feeTypes={L.feeTypes} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Adjustments and waivers</CardTitle></CardHeader>
        <CardContent><AdjustmentsPanel accountId={id} extras={X.extras} items={L.items} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Holds</CardTitle></CardHeader>
        <CardContent><HoldsPanel accountId={id} holds={RH.holds} canManage={can(ctx, 'FEES.FEE_ASSESSMENT.UPDATE')} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Refunds</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {L.requests.length === 0 ? <p className="text-sm text-muted-foreground">No refund requests.</p> : L.requests.map((r) => (
            <div key={r.refund_request_id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium">{r.refund_request_number}</span> · {r.request_date} · {r.refund_reason}</span>
                <span><span className="font-medium">{r.request_status}</span> · requested {money(r.requested_amount)}{r.approved_amount !== null ? ` · approved ${money(r.approved_amount)}` : ''} · refunded {money(refundedBy.get(r.refund_request_id) ?? 0)}</span>
              </div>
              <div className="mt-2">
                <RefundActions key={`${r.refund_request_id}-${r.request_status}-${refundedBy.get(r.refund_request_id) ?? 0}`} request={r} refundedTotal={refundedBy.get(r.refund_request_id) ?? 0} modes={L.modes} canApprove={can(ctx, 'FEES.FEE_REFUND.APPROVE')} canProcess={can(ctx, 'FEES.FEE_REFUND.UPDATE')} />
              </div>
            </div>
          ))}
          {can(ctx, 'FEES.FEE_REFUND.CREATE') && <RefundRequestForm accountId={id} payments={L.payments} />}
        </CardContent>
      </Card>
    </div>
  );
}
