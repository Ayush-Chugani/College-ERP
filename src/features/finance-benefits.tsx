'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { AccountExtras, AssessmentRow, ExtrasLookups, ItemRow, Opt } from '@/features/finance-data';
import { money } from '@/lib/finance-validation';
import { createClient } from '@/lib/supabase/client';

const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const pretty = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
function msg(e: { code?: string; message: string }, fallback: string) {
  return ['22023', '45000', '42501', '23505'].includes(e.code ?? '') ? e.message : fallback;
}
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const Field = ({ id, label, w = 'w-40', children }: { id: string; label: string; w?: string; children: React.ReactNode }) => <div className={w}><label htmlFor={id} className="text-sm font-medium">{label}</label>{children}</div>;

/** Runs one RPC, toasts the outcome and refreshes the page. */
function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(fn: string, args: Record<string, unknown>, ok: string, fallback: string): Promise<unknown> {
    setBusy(true);
    const { data, error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) { toast.error(msg(error, fallback)); return undefined; }
    toast.success(ok);
    router.refresh();
    return data ?? true;
  }
  return { run, busy };
}

type Props = { accountId: number; extras: AccountExtras; lookups: ExtrasLookups; assessments: AssessmentRow[]; items: ItemRow[]; years: Opt[]; feeTypes: Opt[]; studentId: number };

export function BenefitsPanel({ extras, lookups, items, studentId, years }: Pick<Props, 'extras' | 'lookups' | 'items' | 'studentId' | 'years'>) {
  const { run, busy } = useRun();
  const [kind, setKind] = useState<'CONCESSION' | 'SCHOLARSHIP' | 'SPONSORSHIP'>('CONCESSION');
  const [f, setF] = useState({ type: '', year: years[0] ? String(years[0].id) : '', amount: '', pct: '', ref: '', authority: '', remarks: '' });
  const [act, setAct] = useState<{ key: string; mode: 'approve' | 'reject' | 'apply'; amount: string; text: string; item: string } | null>(null);
  const typeOpts = kind === 'CONCESSION' ? lookups.concessionTypes : kind === 'SCHOLARSHIP' ? lookups.schemes : [];
  const can = extras.can;
  async function create() {
    const r = await run('fin_benefit_create', { p_kind: kind, p_student_id: studentId, p_academic_year_id: Number(f.year), p_type_id: kind === 'SPONSORSHIP' ? null : Number(f.type), p_amount: num(f.amount), p_percentage: num(f.pct), p_reference: f.ref || null, p_authority: f.authority || null, p_remarks: f.remarks || null }, 'Request recorded.', 'The request could not be recorded.');
    if (r) setF({ ...f, amount: '', pct: '', ref: '', authority: '', remarks: '' });
  }
  async function go() {
    if (!act) return;
    const [k, id] = act.key.split(':') as [string, string];
    const done = act.mode === 'apply'
      ? await run('fin_benefit_apply', { p_kind: k, p_benefit_id: Number(id), p_assessment_item_id: Number(act.item), p_amount: num(act.amount) }, 'Benefit applied.', 'The benefit could not be applied.')
      : await run('fin_benefit_decide', { p_kind: k, p_id: Number(id), p_approve: act.mode === 'approve', p_amount: act.mode === 'approve' ? num(act.amount) : null, p_percentage: null, p_remarks: act.text || null }, act.mode === 'approve' ? 'Approved.' : 'Rejected.', 'The decision could not be saved.');
    if (done) setAct(null);
  }
  const usable = (s: string) => s === 'APPROVED' || s === 'SANCTIONED';
  return (
    <div className="space-y-3">
      {extras.benefits.length === 0 ? <p className="text-sm text-muted-foreground">No concessions, scholarships or sponsorships.</p> : (
        <ul className="divide-y divide-border text-sm">
          {extras.benefits.map((b) => {
            const key = `${b.kind}:${b.id}`;
            return (
              <li key={key} className="space-y-2 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-medium">{pretty(b.kind)}</span> · {b.name} · <span className="font-medium">{pretty(b.status)}</span> <span className="text-muted-foreground">· {b.percentage !== null ? `${b.percentage}%` : b.amount !== null ? money(b.amount) : ''}{b.applied > 0 ? ` · applied ${money(b.applied)}` : ''}</span></span>
                  <span className="flex gap-2">
                    {can.benefit_approve && (b.status === 'SUBMITTED' || b.status === 'PENDING') && <><Button type="button" variant="outline" onClick={() => setAct({ key, mode: 'approve', amount: '', text: '', item: '' })}>Approve…</Button><Button type="button" variant="outline" onClick={() => setAct({ key, mode: 'reject', amount: '', text: '', item: '' })}>Reject…</Button></>}
                    {can.benefit_apply && usable(b.status) && <Button type="button" variant="outline" onClick={() => setAct({ key, mode: 'apply', amount: '', text: '', item: items[0] ? String(items[0].assessment_item_id) : '' })}>Apply to a fee…</Button>}
                  </span>
                </div>
                {act?.key === key && (
                  <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted p-2">
                    {act.mode === 'apply' && <Field id="bf-i" label="Fee item" w="w-64"><select id="bf-i" className={sel} value={act.item} onChange={(e) => setAct({ ...act, item: e.target.value })}>{items.filter((i) => !['CANCELLED', 'WAIVED', 'PAID'].includes(i.item_status)).map((i) => <option key={i.assessment_item_id} value={i.assessment_item_id}>{i.description ?? `Item ${i.assessment_item_id}`} (balance {money(i.balance_amount)})</option>)}</select></Field>}
                    {act.mode !== 'reject' && <Field id="bf-a" label={act.mode === 'apply' ? 'Amount (blank = all that is left)' : 'Amount (blank = as requested)'} w="w-56"><input id="bf-a" inputMode="decimal" className={sel} value={act.amount} onChange={(e) => setAct({ ...act, amount: e.target.value })} /></Field>}
                    {act.mode !== 'apply' && <Field id="bf-t" label={act.mode === 'reject' ? 'Reason *' : 'Remarks'} w="w-72"><input id="bf-t" maxLength={500} className={sel} value={act.text} onChange={(e) => setAct({ ...act, text: e.target.value })} /></Field>}
                    <Button type="button" disabled={busy} onClick={go}>Confirm</Button>
                    <Button type="button" variant="outline" onClick={() => setAct(null)}>Cancel</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {can.benefit_create && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <Field id="bn-k" label="Request a"><select id="bn-k" className={sel} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="CONCESSION">Concession</option><option value="SCHOLARSHIP">Scholarship</option><option value="SPONSORSHIP">Sponsorship</option></select></Field>
          {kind !== 'SPONSORSHIP' && <Field id="bn-t" label="Type *" w="w-56"><select id="bn-t" className={sel} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Select…</option>{typeOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>}
          {kind === 'SPONSORSHIP' && <Field id="bn-u" label="Sponsoring authority *" w="w-52"><input id="bn-u" maxLength={200} className={sel} value={f.authority} onChange={(e) => setF({ ...f, authority: e.target.value })} /></Field>}
          <Field id="bn-y" label="Academic year" w="w-32"><select id="bn-y" className={sel} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}>{years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</select></Field>
          <Field id="bn-a" label="Amount" w="w-32"><input id="bn-a" inputMode="decimal" className={sel} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          {kind === 'CONCESSION' && <Field id="bn-p" label="or percentage" w="w-28"><input id="bn-p" inputMode="decimal" className={sel} value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></Field>}
          <Field id="bn-r" label={kind === 'SPONSORSHIP' ? 'Sanction reference *' : 'Application number'} w="w-44"><input id="bn-r" maxLength={100} className={sel} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></Field>
          <Field id="bn-m" label="Remarks" w="w-56"><input id="bn-m" maxLength={500} className={sel} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
          <Button type="button" disabled={busy} onClick={create}>Submit request</Button>
        </div>
      )}
    </div>
  );
}

export function AdjustmentsPanel({ accountId, extras, items }: Pick<Props, 'accountId' | 'extras' | 'items'>) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ item: '', type: 'WAIVER', amount: '', reason: '' });
  const [rej, setRej] = useState<{ id: number; reason: string } | null>(null);
  const itemOf = new Map(items.map((i) => [i.assessment_item_id, i.description ?? `Item ${i.assessment_item_id}`]));
  async function create() {
    const r = await run('fin_adjustment_create', { p_number: `ADJ-${accountId}-${Date.now()}`, p_student_account_id: accountId, p_assessment_item_id: Number(f.item), p_type: f.type, p_amount: num(f.amount), p_reason: f.reason }, 'Adjustment requested.', 'The adjustment could not be requested.');
    if (r) setF({ ...f, amount: '', reason: '' });
  }
  return (
    <div className="space-y-3">
      {extras.adjustments.length === 0 ? <p className="text-sm text-muted-foreground">No adjustments.</p> : (
        <ul className="divide-y divide-border text-sm">
          {extras.adjustments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{a.number}</span> · {pretty(a.type)} {money(a.amount)} · {a.item_id ? itemOf.get(a.item_id) ?? `item ${a.item_id}` : ''} · <span className="font-medium">{pretty(a.status)}</span> <span className="text-muted-foreground">· {a.reason}</span></span>
              {extras.can.adjust_approve && a.status === 'SUBMITTED' && (rej?.id === a.id
                ? <span className="flex flex-wrap items-center gap-2"><input aria-label="Reason to reject" maxLength={500} className={`${sel} w-56`} value={rej.reason} onChange={(e) => setRej({ id: a.id, reason: e.target.value })} /><Button type="button" disabled={busy} onClick={async () => { if (await run('fin_adjustment_decide', { p_adjustment_id: a.id, p_approve: false, p_remarks: rej.reason }, 'Rejected.', 'The decision could not be saved.')) setRej(null); }}>Reject</Button></span>
                : <span className="flex gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => run('fin_adjustment_decide', { p_adjustment_id: a.id, p_approve: true, p_remarks: null }, 'Approved.', 'The decision could not be saved.')}>Approve</Button><Button type="button" variant="outline" onClick={() => setRej({ id: a.id, reason: '' })}>Reject…</Button></span>)}
            </li>
          ))}
        </ul>
      )}
      {extras.can.adjust_create && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <Field id="aj-i" label="Fee item *" w="w-64"><select id="aj-i" className={sel} value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}><option value="">Select…</option>{items.filter((i) => !['CANCELLED', 'WAIVED'].includes(i.item_status)).map((i) => <option key={i.assessment_item_id} value={i.assessment_item_id}>{i.description ?? `Item ${i.assessment_item_id}`} (net {money(i.net_amount)})</option>)}</select></Field>
          <Field id="aj-t" label="Type"><select id="aj-t" className={sel} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['WAIVER', 'CREDIT', 'WRITE_OFF', 'DEBIT'].map((t) => <option key={t} value={t}>{pretty(t)}</option>)}</select></Field>
          <Field id="aj-a" label="Amount *" w="w-32"><input id="aj-a" inputMode="decimal" className={sel} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field id="aj-r" label="Reason *" w="w-72"><input id="aj-r" maxLength={500} className={sel} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <Button type="button" disabled={busy || !f.item} onClick={create}>Request adjustment</Button>
        </div>
      )}
    </div>
  );
}

export function InstalmentsPanel({ extras, lookups, assessments }: Pick<Props, 'extras' | 'lookups' | 'assessments'>) {
  const { run, busy } = useRun();
  const open = assessments.filter((a) => ['ASSESSED', 'PARTIALLY_PAID', 'OVERDUE'].includes(a.assessment_status) && a.balance_amount > 0);
  const [f, setF] = useState({ a: '', plan: '', due: '' });
  const byAssessment = new Map<number, typeof extras.instalments>();
  for (const i of extras.instalments) byAssessment.set(i.assessment_id, [...(byAssessment.get(i.assessment_id) ?? []), i]);
  const numberOf = new Map(assessments.map((a) => [a.fee_assessment_id, a.assessment_number]));
  return (
    <div className="space-y-3">
      {byAssessment.size === 0 ? <p className="text-sm text-muted-foreground">No instalment schedules.</p> : [...byAssessment.entries()].map(([aid, rows]) => (
        <div key={aid} className="rounded-md border border-border text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-3 py-2"><span className="font-medium">{numberOf.get(aid) ?? `Assessment ${aid}`}</span>
            {extras.can.assess_update && <span className="flex gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => run('fin_instalment_refresh', { p_assessment_id: aid }, 'Schedule refreshed.', 'The schedule could not be refreshed.')}>Refresh</Button><Button type="button" variant="outline" disabled={busy} onClick={() => run('fin_instalment_cancel', { p_assessment_id: aid }, 'Schedule cancelled.', 'The schedule could not be cancelled.')}>Cancel schedule</Button></span>}
          </div>
          <table className="w-full"><thead className="text-left"><tr><th scope="col" className="px-3 py-1.5 font-medium">#</th><th scope="col" className="px-3 py-1.5 font-medium">Due</th><th scope="col" className="px-3 py-1.5 text-right font-medium">Amount</th><th scope="col" className="px-3 py-1.5 text-right font-medium">Paid</th><th scope="col" className="px-3 py-1.5 font-medium">Status</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-border"><td className="px-3 py-1.5">{r.number}</td><td className="px-3 py-1.5">{r.due}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(r.amount)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(r.paid)}</td><td className="px-3 py-1.5">{pretty(r.status)}</td></tr>)}</tbody></table>
        </div>
      ))}
      {extras.can.assess_update && open.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <Field id="in-a" label="Assessment *" w="w-56"><select id="in-a" className={sel} value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })}><option value="">Select…</option>{open.filter((a) => !byAssessment.has(a.fee_assessment_id)).map((a) => <option key={a.fee_assessment_id} value={a.fee_assessment_id}>{a.assessment_number} ({money(a.net_payable_amount)})</option>)}</select></Field>
          <Field id="in-p" label="Plan *" w="w-48"><select id="in-p" className={sel} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}><option value="">Select…</option>{lookups.plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
          <Field id="in-d" label="First due date *"><input id="in-d" type="date" className={sel} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
          <Button type="button" disabled={busy || !f.a || !f.plan || !f.due} onClick={() => run('fin_instalment_apply', { p_assessment_id: Number(f.a), p_plan_id: Number(f.plan), p_first_due: f.due }, 'Schedule created.', 'The schedule could not be created.')}>Create schedule</Button>
        </div>
      )}
    </div>
  );
}

export function PenaltiesPanel({ accountId, extras, lookups, assessments, years, feeTypes }: Pick<Props, 'accountId' | 'extras' | 'lookups' | 'assessments' | 'years' | 'feeTypes'>) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ type: '', year: years[0] ? String(years[0].id) : '', amount: '', reason: '', due: '', ruleA: '', rule: '' });
  const [w, setW] = useState<{ id: number; amount: string; reason: string } | null>(null);
  async function suggest() {
    const { data, error } = await createClient().rpc('fin_late_fee_suggest', { p_assessment_id: Number(f.ruleA), p_rule_id: Number(f.rule), p_as_of: null });
    if (error) return void toast.error(msg(error, 'The late fee could not be calculated.'));
    const v = Number(data);
    if (v > 0) { setF({ ...f, amount: String(v), reason: f.reason || 'Late payment' }); toast.success(`Suggested late fee: ${money(v)}`); } else toast.message('No late fee is due under that rule.');
  }
  return (
    <div className="space-y-3">
      {extras.penalties.length === 0 ? <p className="text-sm text-muted-foreground">No penalties or late fees.</p> : (
        <ul className="divide-y divide-border text-sm">
          {extras.penalties.map((p) => (
            <li key={p.id} className="space-y-2 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium">{money(p.amount)}</span>{p.waived > 0 ? ` (waived ${money(p.waived)})` : ''} · {pretty(p.status)} <span className="text-muted-foreground">· {p.date} · {p.reason}</span></span>
                {extras.can.adjust_approve && ['ASSESSED', 'PARTIALLY_PAID'].includes(p.status) && <Button type="button" variant="outline" onClick={() => setW({ id: p.id, amount: '', reason: '' })}>Waive…</Button>}
              </div>
              {w?.id === p.id && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted p-2">
                  <Field id="pw-a" label="Amount *" w="w-32"><input id="pw-a" inputMode="decimal" className={sel} value={w.amount} onChange={(e) => setW({ ...w, amount: e.target.value })} /></Field>
                  <Field id="pw-r" label="Reason *" w="w-72"><input id="pw-r" maxLength={500} className={sel} value={w.reason} onChange={(e) => setW({ ...w, reason: e.target.value })} /></Field>
                  <Button type="button" disabled={busy} onClick={async () => { if (await run('fin_penalty_waive', { p_penalty_id: p.id, p_amount: num(w.amount), p_reason: w.reason }, 'Waived.', 'The waiver could not be saved.')) setW(null); }}>Confirm</Button>
                  <Button type="button" variant="outline" onClick={() => setW(null)}>Cancel</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {extras.can.assess_create && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field id="pn-sa" label="Late fee for" w="w-56"><select id="pn-sa" className={sel} value={f.ruleA} onChange={(e) => setF({ ...f, ruleA: e.target.value })}><option value="">Assessment…</option>{assessments.map((a) => <option key={a.fee_assessment_id} value={a.fee_assessment_id}>{a.assessment_number}</option>)}</select></Field>
            <Field id="pn-sr" label="Rule" w="w-44"><select id="pn-sr" className={sel} value={f.rule} onChange={(e) => setF({ ...f, rule: e.target.value })}><option value="">Rule…</option>{lookups.lateRules.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
            <Button type="button" variant="outline" disabled={!f.ruleA || !f.rule} onClick={suggest}>Calculate late fee</Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field id="pn-t" label="Fee type *" w="w-56"><select id="pn-t" className={sel} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Select…</option>{feeTypes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
            <Field id="pn-y" label="Academic year" w="w-32"><select id="pn-y" className={sel} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}>{years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</select></Field>
            <Field id="pn-a" label="Amount *" w="w-32"><input id="pn-a" inputMode="decimal" className={sel} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field id="pn-d" label="Due date"><input id="pn-d" type="date" className={sel} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
            <Field id="pn-r" label="Reason *" w="w-64"><input id="pn-r" maxLength={500} className={sel} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            <Button type="button" disabled={busy || !f.type} onClick={async () => { if (await run('fin_penalty_assess', { p_student_account_id: accountId, p_fee_type_id: Number(f.type), p_amount: num(f.amount), p_reason: f.reason, p_academic_year_id: Number(f.year), p_due_date: f.due || null }, 'Penalty assessed.', 'The penalty could not be assessed.')) setF({ ...f, amount: '', reason: '' }); }}>Assess penalty</Button>
          </div>
        </div>
      )}
    </div>
  );
}
