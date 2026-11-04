'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { HOLD_TYPES, type HoldRow, type PaymentReceiptRow, type ReceiptDetail } from '@/features/finance-data';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (['22023', '45000', '42501'].includes(e.code ?? '')) return e.message;
  return fallback;
}
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const pretty = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function ReceiptCell({ receipt, paymentId, canIssue, payable }: { receipt: PaymentReceiptRow | undefined; paymentId: number; canIssue: boolean; payable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function issue() {
    setBusy(true);
    const { error } = await createClient().rpc('fin_issue_receipt', { p_payment_transaction_id: paymentId });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The receipt could not be issued.'));
    toast.success('Receipt issued.');
    router.refresh();
  }
  if (receipt?.fee_receipt_id) {
    return <Link href={`/finance/receipt/${receipt.fee_receipt_id}`} className="text-primary underline-offset-4 hover:underline">Receipt {receipt.receipt_number}{receipt.receipt_status && receipt.receipt_status !== 'ISSUED' ? ` (${pretty(receipt.receipt_status)})` : ''}</Link>;
  }
  if (canIssue && payable) return <Button type="button" variant="outline" disabled={busy} onClick={issue}>Issue receipt</Button>;
  return null;
}

export function HoldsPanel({ accountId, holds, canManage }: { accountId: number; holds: HoldRow[]; canManage: boolean }) {
  const router = useRouter();
  const [type, setType] = useState<string>('REGISTRATION');
  const [reason, setReason] = useState('');
  const [releasing, setReleasing] = useState<{ id: number; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function place() {
    if (!reason.trim()) return void toast.error('Enter the reason for the hold.');
    setBusy(true);
    const { error } = await createClient().rpc('fin_hold_place', { p_student_account_id: accountId, p_hold_type: type, p_reason: reason });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The hold could not be placed.'));
    toast.success('Hold placed.');
    setReason('');
    router.refresh();
  }
  async function release() {
    if (!releasing || !releasing.reason.trim()) return void toast.error('Enter the reason for releasing the hold.');
    setBusy(true);
    const { error } = await createClient().rpc('fin_hold_release', { p_hold_id: releasing.id, p_reason: releasing.reason });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The hold could not be released.'));
    toast.success('Hold released.');
    setReleasing(null);
    router.refresh();
  }
  return (
    <div className="space-y-3">
      {holds.length === 0 ? <p className="text-sm text-muted-foreground">No holds.</p> : (
        <ul className="divide-y divide-border text-sm">
          {holds.map((h) => (
            <li key={h.financial_hold_id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <span><span className="font-medium">{pretty(h.hold_type)}</span> · {pretty(h.hold_status)} <span className="text-muted-foreground">· {h.hold_reason} · {h.placed_at.slice(0, 10)}{h.release_reason ? ` · released: ${h.release_reason}` : ''}</span></span>
              {canManage && h.hold_status === 'ACTIVE' && (releasing?.id === h.financial_hold_id
                ? <span className="flex flex-wrap items-center gap-2"><input aria-label="Reason for releasing" maxLength={500} className={`${sel} w-64`} value={releasing.reason} onChange={(e) => setReleasing({ id: h.financial_hold_id, reason: e.target.value })} /><Button type="button" disabled={busy} onClick={release}>Release</Button><Button type="button" variant="outline" onClick={() => setReleasing(null)}>Cancel</Button></span>
                : <Button type="button" variant="outline" onClick={() => setReleasing({ id: h.financial_hold_id, reason: '' })}>Release…</Button>)}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48"><label htmlFor="hd-t" className="text-sm font-medium">Hold on</label><select id="hd-t" className={sel} value={type} onChange={(e) => setType(e.target.value)}>{HOLD_TYPES.map((t) => <option key={t} value={t}>{pretty(t)}</option>)}</select></div>
          <div className="w-80 max-w-full"><label htmlFor="hd-r" className="text-sm font-medium">Reason</label><input id="hd-r" maxLength={500} className={sel} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <Button type="button" disabled={busy} onClick={place}>Place hold</Button>
        </div>
      )}
    </div>
  );
}

export function ReceiptActions({ receipt }: { receipt: ReceiptDetail }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(replace: boolean) {
    if (!reason.trim()) return void toast.error('Enter a reason.');
    setBusy(true);
    const { data, error } = await createClient().rpc('fin_cancel_receipt', { p_receipt_id: receipt.fee_receipt_id, p_reason: reason, p_replace: replace });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'The receipt could not be changed.'));
    toast.success(replace ? 'Replacement issued.' : 'Receipt cancelled.');
    if (replace && data) router.push(`/finance/receipt/${data as number}`); else router.refresh();
  }
  return (
    <div className="space-y-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => window.print()}>Print</Button>
        <Link href={`/finance/account/${receipt.student_account_id}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Back to the account</Link>
      </div>
      {receipt.can_cancel && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted p-3">
          <div className="w-80 max-w-full"><label htmlFor="rc-r" className="text-sm font-medium">Reason to cancel or replace</label><input id="rc-r" maxLength={500} className={sel} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <Button type="button" variant="outline" disabled={busy} onClick={() => run(false)}>Cancel receipt</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => run(true)}>Replace with a new receipt</Button>
        </div>
      )}
    </div>
  );
}
