'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/finance-validation';
import { createClient } from '@/lib/supabase/client';

export type Opt = { id: number; label: string; parent?: number };
export type StructureLookups = { institutions: Opt[]; programmes: Opt[]; years: Opt[]; categories: Opt[]; feeTypes: Opt[]; semesters: Opt[]; lateRules: Opt[] };
export type StructureDetail = {
  fee_structure_id: number; structure_code: string; structure_name: string; institution_id: number; institution_name: string; campus_id: number | null; programme_id: number | null; programme_name: string | null;
  academic_year_id: number; year_code: string; admission_category_id: number | null; version_number: number; effective_from: string; effective_to: string | null; approval_status: string; remarks: string | null;
  can_edit: boolean; can_submit: boolean; can_decide: boolean; can_version: boolean; can_delete: boolean;
  items: { id: number; fee_type_id: number; fee_type: string; semester_id: number | null; academic_term_id: number | null; amount: number; due_date: string | null; due_days: number | null; installment_allowed: boolean; waiver_allowed: boolean; late_fee_rule_id: number | null; display_order: number; remarks: string | null }[];
};
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const msg = (e: { code?: string; message: string }, fb: string) => (['22023', '23505', '42501', '45000'].includes(e.code ?? '') ? e.message : fb);
const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(fn: string, args: Record<string, unknown>, ok: string, fallback: string, after?: (data: unknown) => void) {
    setBusy(true);
    const { data, error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) { toast.error(msg(error, fallback)); return false; }
    toast.success(ok);
    if (after) after(data); else router.refresh();
    return true;
  }
  return { run, busy };
}

/** Header form: create (no `initial`) or edit a draft. */
export function StructureForm({ lookups, initial }: { lookups: StructureLookups; initial?: StructureDetail }) {
  const router = useRouter();
  const { run, busy } = useRun();
  const [f, setF] = useState({
    code: initial?.structure_code ?? '', name: initial?.structure_name ?? '', inst: String(initial?.institution_id ?? lookups.institutions[0]?.id ?? ''), prog: String(initial?.programme_id ?? ''),
    year: String(initial?.academic_year_id ?? lookups.years[0]?.id ?? ''), cat: String(initial?.admission_category_id ?? ''), from: initial?.effective_from ?? '', to: initial?.effective_to ?? '', remarks: initial?.remarks ?? '',
  });
  const progs = lookups.programmes.filter((p) => String(p.parent) === f.inst);
  const go = () => run('fin_structure_save', { p_id: initial?.fee_structure_id ?? null, p: { structure_code: f.code, structure_name: f.name, institution_id: Number(f.inst), programme_id: f.prog ? Number(f.prog) : null, academic_year_id: Number(f.year), admission_category_id: f.cat ? Number(f.cat) : null, effective_from: f.from, effective_to: f.to || null, remarks: f.remarks || null } },
    'Saved.', 'The fee structure could not be saved.', (id) => { if (initial) router.refresh(); else router.push(`/finance/structures/${String(id)}`); });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40"><label htmlFor="fs-c" className="text-sm font-medium">Code *</label><input id="fs-c" maxLength={50} className={sel} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
        <div className="w-72"><label htmlFor="fs-n" className="text-sm font-medium">Name *</label><input id="fs-n" maxLength={200} className={sel} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="w-56"><label htmlFor="fs-i" className="text-sm font-medium">Institution *</label><select id="fs-i" className={sel} value={f.inst} onChange={(e) => setF({ ...f, inst: e.target.value, prog: '' })}>{lookups.institutions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        <div className="w-56"><label htmlFor="fs-p" className="text-sm font-medium">Programme (blank = whole institution)</label><select id="fs-p" className={sel} value={f.prog} onChange={(e) => setF({ ...f, prog: e.target.value })}><option value="">All programmes</option>{progs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36"><label htmlFor="fs-y" className="text-sm font-medium">Academic year *</label><select id="fs-y" className={sel} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}>{lookups.years.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        <div className="w-48"><label htmlFor="fs-a" className="text-sm font-medium">Admission category</label><select id="fs-a" className={sel} value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })}><option value="">Any</option>{lookups.categories.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        <div className="w-40"><label htmlFor="fs-f" className="text-sm font-medium">Effective from *</label><input id="fs-f" type="date" className={sel} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
        <div className="w-40"><label htmlFor="fs-t" className="text-sm font-medium">Effective to</label><input id="fs-t" type="date" className={sel} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        <div className="w-64"><label htmlFor="fs-r" className="text-sm font-medium">Remarks</label><input id="fs-r" maxLength={500} className={sel} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></div>
        <Button type="button" disabled={busy || !f.code || !f.name || !f.from} onClick={go}>{initial ? 'Save changes' : 'Create draft'}</Button>
      </div>
    </div>
  );
}

export function ItemsPanel({ s, lookups }: { s: StructureDetail; lookups: StructureLookups }) {
  const { run, busy } = useRun();
  const empty = { id: null as number | null, type: '', sem: '', amount: '', due: '', days: '', inst: false, waive: false, late: '', order: '0' };
  const [f, setF] = useState(empty);
  const semOf = new Map(lookups.semesters.map((o) => [o.id, o.label]));
  const save = () => run('fin_structure_item_save', { p_structure_id: s.fee_structure_id, p_item_id: f.id, p: { fee_type_id: Number(f.type), semester_id: f.sem ? Number(f.sem) : null, amount: f.amount, due_date: f.due || null, due_days_from_registration: f.days || null, installment_allowed: f.inst, waiver_allowed: f.waive, late_fee_rule_id: f.late ? Number(f.late) : null, display_order: Number(f.order) || 0 } }, 'Item saved.', 'The item could not be saved.', () => { setF(empty); }).then(() => undefined);
  return (
    <div className="space-y-3">
      {s.items.length === 0 ? <p className="text-sm text-muted-foreground">No items yet.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left"><tr><th scope="col" className="px-2 py-1.5 font-medium">Fee</th><th scope="col" className="px-2 py-1.5 font-medium">Semester</th><th scope="col" className="px-2 py-1.5 text-right font-medium">Amount</th><th scope="col" className="px-2 py-1.5 font-medium">Due</th><th scope="col" className="px-2 py-1.5 font-medium">Flags</th><th scope="col" className="px-2 py-1.5" /></tr></thead>
          <tbody>{s.items.map((i) => (
            <tr key={i.id} className="border-t border-border">
              <td className="px-2 py-1.5">{i.fee_type}</td><td className="px-2 py-1.5">{i.semester_id ? semOf.get(i.semester_id) ?? i.semester_id : 'All'}</td><td className="px-2 py-1.5 text-right tabular-nums">{money(i.amount)}</td>
              <td className="px-2 py-1.5">{i.due_date ?? (i.due_days !== null ? `${i.due_days} days after registration` : '')}</td><td className="px-2 py-1.5">{[i.installment_allowed && 'instalments', i.waiver_allowed && 'waiver'].filter(Boolean).join(', ')}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{s.can_edit && <><Button type="button" variant="outline" onClick={() => setF({ id: i.id, type: String(i.fee_type_id), sem: String(i.semester_id ?? ''), amount: String(i.amount), due: i.due_date ?? '', days: String(i.due_days ?? ''), inst: i.installment_allowed, waive: i.waiver_allowed, late: String(i.late_fee_rule_id ?? ''), order: String(i.display_order) })}>Edit</Button>{' '}<Button type="button" variant="outline" disabled={busy} onClick={() => run('fin_structure_item_delete', { p_structure_id: s.fee_structure_id, p_item_id: i.id }, 'Removed.', 'The item could not be removed.')}>Remove</Button></>}</td>
            </tr>))}
          </tbody>
          <tfoot><tr className="border-t border-border font-medium"><td className="px-2 py-1.5" colSpan={2}>Total</td><td className="px-2 py-1.5 text-right tabular-nums">{money(s.items.reduce((a, i) => a + Number(i.amount), 0))}</td><td colSpan={3} /></tr></tfoot>
        </table></div>
      )}
      {s.can_edit && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-52"><label htmlFor="fi-t" className="text-sm font-medium">Fee type *</label><select id="fi-t" className={sel} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Select…</option>{lookups.feeTypes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
            <div className="w-36"><label htmlFor="fi-s" className="text-sm font-medium">Semester</label><select id="fi-s" className={sel} value={f.sem} onChange={(e) => setF({ ...f, sem: e.target.value })}><option value="">All</option>{lookups.semesters.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
            <div className="w-32"><label htmlFor="fi-a" className="text-sm font-medium">Amount *</label><input id="fi-a" inputMode="decimal" className={sel} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
            <div className="w-40"><label htmlFor="fi-d" className="text-sm font-medium">Due date</label><input id="fi-d" type="date" className={sel} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></div>
            <div className="w-32"><label htmlFor="fi-y" className="text-sm font-medium">or days after registration</label><input id="fi-y" inputMode="numeric" className={sel} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></div>
            <div className="w-44"><label htmlFor="fi-l" className="text-sm font-medium">Late-fee rule</label><select id="fi-l" className={sel} value={f.late} onChange={(e) => setF({ ...f, late: e.target.value })}><option value="">None</option>{lookups.lateRules.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.inst} onChange={(e) => setF({ ...f, inst: e.target.checked })} /> Instalments allowed</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.waive} onChange={(e) => setF({ ...f, waive: e.target.checked })} /> Waiver allowed</label>
          </div>
          <div className="flex gap-2"><Button type="button" disabled={busy || !f.type || !f.amount} onClick={save}>{f.id ? 'Save item' : 'Add item'}</Button>{f.id && <Button type="button" variant="outline" onClick={() => setF(empty)}>Cancel edit</Button>}</div>
        </div>
      )}
    </div>
  );
}

export function WorkflowPanel({ s }: { s: StructureDetail }) {
  const router = useRouter();
  const { run, busy } = useRun();
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm">Status: <span className="font-medium">{pretty(s.approval_status)}</span> · version {s.version_number}{s.remarks ? <span className="text-muted-foreground"> · {s.remarks}</span> : null}</p>
      <div className="flex flex-wrap gap-2">
        {s.can_submit && <Button type="button" disabled={busy} onClick={() => run('fin_structure_submit', { p_id: s.fee_structure_id }, 'Submitted for approval.', 'It could not be submitted.')}>Submit for approval</Button>}
        {s.can_decide && <><Button type="button" disabled={busy} onClick={() => run('fin_structure_decide', { p_id: s.fee_structure_id, p_approve: true, p_remarks: null }, 'Approved.', 'The decision could not be saved.')}>Approve</Button><Button type="button" variant="outline" onClick={() => setRejecting(true)}>Reject…</Button></>}
        {s.can_version && <Button type="button" variant="outline" disabled={busy} onClick={() => run('fin_structure_new_version', { p_id: s.fee_structure_id }, 'New draft version created.', 'The new version could not be created.', (id) => router.push(`/finance/structures/${String(id)}`))}>Create new version</Button>}
        {s.can_delete && <Button type="button" variant="outline" disabled={busy} onClick={() => { if (window.confirm('Delete this draft?')) void run('fin_structure_delete', { p_id: s.fee_structure_id }, 'Deleted.', 'It could not be deleted.', () => router.push('/finance/structures')); }}>Delete draft</Button>}
      </div>
      {rejecting && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted p-2">
          <div className="w-80 max-w-full"><label htmlFor="fw-r" className="text-sm font-medium">Reason *</label><input id="fw-r" maxLength={500} className={sel} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <Button type="button" disabled={busy || !reason.trim()} onClick={() => run('fin_structure_decide', { p_id: s.fee_structure_id, p_approve: false, p_remarks: reason }, 'Rejected.', 'The decision could not be saved.')}>Reject</Button>
          <Button type="button" variant="outline" onClick={() => setRejecting(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}
