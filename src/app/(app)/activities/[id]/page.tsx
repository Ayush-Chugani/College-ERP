import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActivity, listActivityTypes, listEvidenceTypes, listLevels, listModes, listYears, parseActId } from '@/features/activity-data';
import { ActivityForm, EvidencePanel, TeamPanel, WorkflowActions } from '@/features/activity-forms';
import { listDocumentTypes } from '@/features/document-data';
import { label } from '@/lib/activity-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Activity' };

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === '') return null;
  return <div className="flex gap-2 py-1 text-sm"><dt className="w-40 shrink-0 text-muted-foreground">{k}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>;
}

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseActId((await params).id);
  if (id === null) notFound();
  const { supabase } = await requireContext();
  const a = await getActivity(supabase, id);
  if (!a) notFound();
  const [lookups, docTypes, evTypes] = await Promise.all([
    a.can_edit ? Promise.all([listActivityTypes(supabase), listYears(supabase), listLevels(supabase), listModes(supabase)]) : Promise.resolve([[], [], [], []] as never[][]),
    listDocumentTypes(supabase),
    listEvidenceTypes(supabase),
  ]);
  const [types, years, levels, modes] = lookups as [never[], never[], never[], never[]];
  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{a.activity_title}</h1>
          <p className="text-sm text-muted-foreground">{a.type_name}{!a.is_owner ? ` · ${a.student_name} (${a.student_number})` : ''} · verification <span className="font-medium text-foreground">{label(a.verification_status)}</span> · approval <span className="font-medium text-foreground">{label(a.approval_status)}</span></p>
        </div>
        <Link href="/activities" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">All activities</Link>
      </div>
      {(a.verification_remarks || a.approval_remarks || a.rejection_reason) && (
        <Card><CardHeader><CardTitle>Reviewer remarks</CardTitle></CardHeader><CardContent><dl>
          <Row k="Verification" v={a.verification_remarks} /><Row k="Approval" v={a.approval_remarks} /><Row k="Rejection reason" v={a.rejection_reason} />
        </dl></CardContent></Card>
      )}
      <Card><CardHeader><CardTitle>Actions</CardTitle></CardHeader><CardContent><WorkflowActions a={a} />{a.requires_team_details && <p className="mt-2 text-xs text-muted-foreground">This type of activity needs a team name before it can be submitted.</p>}</CardContent></Card>
      {a.can_edit ? (
        <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent><ActivityForm lookups={{ types, years, levels, modes }} initial={a} /></CardContent></Card>
      ) : (
        <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent><dl>
          <Row k="Event" v={a.event_name} /><Row k="Organiser" v={a.organizer_name} /><Row k="Team" v={a.team_name} /><Row k="Role" v={a.participation_role} />
          <Row k="Dates" v={a.start_date ? `${a.start_date}${a.end_date ? ` to ${a.end_date}` : ''}` : null} /><Row k="Venue" v={[a.venue_name, a.city].filter(Boolean).join(', ')} />
          <Row k="Achievement" v={`${label(a.achievement_type)}${a.position_rank ? ` (rank ${a.position_rank})` : ''}`} /><Row k="Award" v={a.award_name} />
          <Row k="Link" v={a.activity_url} /><Row k="Description" v={a.description} /><Row k="Outcomes" v={a.outcomes} />
        </dl></CardContent></Card>
      )}
      <Card><CardHeader><CardTitle>Team</CardTitle></CardHeader><CardContent><TeamPanel a={a} /></CardContent></Card>
      <Card><CardHeader><CardTitle>Evidence</CardTitle></CardHeader><CardContent><EvidencePanel a={a} documentTypes={docTypes} evidenceTypes={evTypes} /></CardContent></Card>
    </div>
  );
}
