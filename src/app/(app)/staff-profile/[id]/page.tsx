import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listLevels, listYears } from '@/features/activity-data';
import { listDocumentTypes } from '@/features/document-data';
import { EvidencePanel } from '@/features/evidence-panel';
import type { DetailSchema } from '@/features/staff-data';
import { getStaffActivity, listEvidenceTypesStaff, listRoleTypes, listStaffTypes, parseStaffId } from '@/features/staff-data';
import { ContributorPanel, StaffActivityForm } from '@/features/staff-forms';
import { WorkflowActions } from '@/features/workflow-actions';
import { requireContext } from '@/lib/server-context';
import { fieldKind, humanize, label } from '@/lib/staff-validation';

export const metadata: Metadata = { title: 'Staff record' };

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === '') return null;
  return <div className="flex gap-2 py-1 text-sm"><dt className="w-48 shrink-0 text-muted-foreground">{k}</dt><dd className="whitespace-pre-wrap break-words">{v}</dd></div>;
}

export default async function StaffRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseStaffId((await params).id);
  if (id === null) notFound();
  const { supabase } = await requireContext();
  const a = await getStaffActivity(supabase, id);
  if (!a) notFound();
  const [docTypes, evTypes, roles] = await Promise.all([listDocumentTypes(supabase), listEvidenceTypesStaff(supabase), listRoleTypes(supabase)]);
  const lookups = a.can_edit ? { types: await listStaffTypes(supabase), years: await listYears(supabase), levels: await listLevels(supabase), roles } : null;

  // read-only view: resolve referenced ids to names
  let readRows: { k: string; v: string }[] = [];
  if (!a.can_edit && a.detail_table) {
    const { data } = await supabase.rpc('staff_detail_schema', { p_activity_type_id: a.activity_type_id });
    const schema = data as DetailSchema;
    const labels: Record<string, Map<number, string>> = {};
    for (const t of new Set(schema.columns.filter((c) => fieldKind(c) === 'ref').map((c) => c.ref_table as string))) {
      const { data: opts } = await supabase.rpc('staff_lookup_options', { p_table: t });
      labels[t] = new Map(((opts ?? []) as { id: number; label: string }[]).map((o) => [Number(o.id), o.label]));
    }
    readRows = schema.columns.flatMap((c) => {
      const v = a.detail[c.name];
      if (v === null || v === undefined || v === '') return [];
      const kind = fieldKind(c);
      const text = kind === 'ref' ? labels[c.ref_table as string]?.get(Number(v)) ?? `#${String(v)}` : kind === 'boolean' ? (v ? 'Yes' : 'No') : kind === 'choice' ? humanize(String(v)) : String(v);
      return [{ k: humanize(c.name), v: text }];
    });
  }
  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{a.activity_title}</h1>
          <p className="text-sm text-muted-foreground">{a.type_name}{!a.is_owner ? ` · ${a.staff_name} (${a.employee_number})` : ''} · verification <span className="font-medium text-foreground">{label(a.verification_status)}</span> · approval <span className="font-medium text-foreground">{label(a.approval_status)}</span></p>
        </div>
        <Link href="/staff-profile" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">All records</Link>
      </div>
      {(a.verification_remarks || a.approval_remarks || a.rejection_reason) && (
        <Card><CardHeader><CardTitle>Reviewer remarks</CardTitle></CardHeader><CardContent><dl><Row k="Verification" v={a.verification_remarks} /><Row k="Approval" v={a.approval_remarks} /><Row k="Rejection reason" v={a.rejection_reason} /></dl></CardContent></Card>
      )}
      <Card><CardHeader><CardTitle>Actions</CardTitle></CardHeader><CardContent><WorkflowActions id={a.staff_activity_id} flags={a} rpcPrefix="staff_activity" afterDeleteHref="/staff-profile" /></CardContent></Card>
      {lookups ? (
        <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent><StaffActivityForm lookups={lookups} initial={a} /></CardContent></Card>
      ) : (
        <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent><dl>
          <Row k="Dates" v={a.start_date ? `${a.start_date}${a.end_date ? ` to ${a.end_date}` : ''}` : null} /><Row k="Description" v={a.description} /><Row k="Outcomes" v={a.outcomes} />
          {readRows.map((r) => <Row key={r.k} k={r.k} v={r.v} />)}
        </dl></CardContent></Card>
      )}
      <Card><CardHeader><CardTitle>Contributors</CardTitle></CardHeader><CardContent><ContributorPanel a={a} roles={roles} /></CardContent></Card>
      <Card><CardHeader><CardTitle>Evidence</CardTitle></CardHeader><CardContent><EvidencePanel a={{ activityId: a.staff_activity_id, ownerId: a.employee_id, ownerKind: 'employee', canEdit: a.can_edit, evidence: a.evidence }} documentTypes={docTypes} evidenceTypes={evTypes} /></CardContent></Card>
    </div>
  );
}
