'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { label } from '@/lib/document-validation';
import { createClient } from '@/lib/supabase/client';

const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const msg = (e: { code?: string; message: string }, fb: string) => (['22023', '23505', '42501', '45000'].includes(e.code ?? '') ? e.message : fb);

export type Competency = { course_id: number; course_code: string; course_title: string; level: string | null; valid_from: string | null; valid_to: string | null; active: boolean };

/** Courses an employee is competent to teach (migration 063). HR edits; the employee reads. */
export function CompetenciesPanel({ employeeId, rows, canEdit, canDelete, courses }: { employeeId: number; rows: Competency[]; canEdit: boolean; canDelete: boolean; courses: { id: number; label: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState({ course: '', level: 'INTERMEDIATE', from: '', to: '' });
  const [busy, setBusy] = useState(false);
  const supabase = createClient();
  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc('emp_competency_save', { p_employee_id: employeeId, p_course_id: Number(f.course), p_level: f.level, p_valid_from: f.from || null, p_valid_to: f.to || null });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'The competency could not be saved.'));
    toast.success('Saved.');
    setF({ ...f, course: '' });
    router.refresh();
  }
  async function remove(c: Competency) {
    if (!window.confirm(`Remove ${c.course_code}?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc('emp_competency_delete', { p_employee_id: employeeId, p_course_id: c.course_id });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'It could not be removed.'));
    router.refresh();
  }
  return (
    <div className="space-y-3">
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No competencies recorded.</p> : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((c) => (
            <li key={c.course_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{c.course_code}</span> · {c.course_title} · {c.level ? label(c.level) : 'level not set'}<span className="text-muted-foreground">{c.valid_from || c.valid_to ? ` · ${c.valid_from ?? '…'} to ${c.valid_to ?? 'open'}` : ''}{c.active ? '' : ' · not current'}</span></span>
              <span className="flex gap-2">
                {canEdit && <Button type="button" variant="outline" onClick={() => setF({ course: String(c.course_id), level: c.level ?? 'INTERMEDIATE', from: c.valid_from ?? '', to: c.valid_to ?? '' })}>Edit</Button>}
                {canDelete && <Button type="button" variant="outline" disabled={busy} onClick={() => remove(c)}>Remove</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div className="w-72"><label htmlFor="cp-c" className="text-sm font-medium">Course *</label><select id="cp-c" className={sel} value={f.course} onChange={(e) => setF({ ...f, course: e.target.value })}><option value="">Select…</option>{courses.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
          <div className="w-40"><label htmlFor="cp-l" className="text-sm font-medium">Level *</label><select id="cp-l" className={sel} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'].map((l) => <option key={l} value={l}>{label(l)}</option>)}</select></div>
          <div className="w-40"><label htmlFor="cp-f" className="text-sm font-medium">Valid from</label><input id="cp-f" type="date" className={sel} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div className="w-40"><label htmlFor="cp-t" className="text-sm font-medium">Valid to</label><input id="cp-t" type="date" className={sel} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
          <Button type="button" disabled={busy || !f.course} onClick={save}>Save competency</Button>
        </div>
      )}
    </div>
  );
}

/** ISO timestamp this many days ahead, or null for an open-ended rule. */
function daysFromNow(days: string): string | null {
  return days ? new Date(Date.now() + Number(days) * 86_400_000).toISOString() : null;
}

type Rule = { id: number; who: string; can_view: boolean; can_download: boolean; valid_to: string | null; active: boolean };
/** Sharing one HR document with a named user or a role (migration 063). Shown to people who hold EMPLOYEE_DOCUMENT.UPDATE. */
export function DocumentSharing({ documentId }: { documentId: number }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [f, setF] = useState({ kind: 'user', who: '', download: false, days: '30' });
  const [busy, setBusy] = useState(false);
  const supabase = createClient();
  async function load() {
    const { data, error } = await supabase.rpc('emp_doc_rule_list', { p_document_id: documentId });
    if (error) return void toast.error(msg(error, 'The sharing rules could not be loaded.'));
    setRules(data as Rule[]);
  }
  async function add() {
    setBusy(true);
    const until = daysFromNow(f.days);
    const { error } = await supabase.rpc('emp_doc_rule_set', { p_document_id: documentId, p_role_code: f.kind === 'role' ? f.who : null, p_username: f.kind === 'user' ? f.who : null, p_can_view: true, p_can_download: f.download, p_valid_to: until });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'The rule could not be saved.'));
    toast.success('Shared.');
    setF({ ...f, who: '' });
    await load();
  }
  async function end(r: Rule) {
    setBusy(true);
    const { error } = await supabase.rpc('emp_doc_rule_end', { p_rule_id: r.id });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'The rule could not be ended.'));
    await load();
  }
  if (rules === null) return <Button type="button" variant="outline" onClick={load}>Sharing…</Button>;
  return (
    <div className="w-full space-y-2 rounded-md border border-border bg-muted p-2 text-sm">
      {rules.length === 0 ? <p className="text-muted-foreground">Shared with nobody beyond the usual permissions.</p> : (
        <ul className="divide-y divide-border">{rules.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1"><span>{r.who} · {r.can_download ? 'view and download' : 'view'}{r.valid_to ? ` · until ${r.valid_to.slice(0, 10)}` : ''} · {r.active ? 'active' : 'ended'}</span>{r.active && <Button type="button" variant="outline" disabled={busy} onClick={() => end(r)}>End</Button>}</li>)}</ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-28"><label htmlFor={`ds-k-${documentId}`} className="text-xs font-medium">Share with</label><select id={`ds-k-${documentId}`} className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="user">A user</option><option value="role">A role</option></select></div>
        <div className="w-48"><label htmlFor={`ds-w-${documentId}`} className="text-xs font-medium">{f.kind === 'role' ? 'Role code' : 'Username'}</label><input id={`ds-w-${documentId}`} className={sel} value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })} /></div>
        <div className="w-24"><label htmlFor={`ds-d-${documentId}`} className="text-xs font-medium">Days (blank = open)</label><input id={`ds-d-${documentId}`} inputMode="numeric" className={sel} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></div>
        <label className="flex items-center gap-1"><input type="checkbox" checked={f.download} onChange={(e) => setF({ ...f, download: e.target.checked })} /> Allow download</label>
        <Button type="button" disabled={busy || !f.who} onClick={add}>Share</Button>
      </div>
    </div>
  );
}
