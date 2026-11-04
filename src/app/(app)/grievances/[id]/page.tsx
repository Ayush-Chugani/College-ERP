import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDetail, parseGrvId } from '@/features/grievance-data';
import { ActionForm, StudentRespond } from '@/features/grievance-forms';
import { label } from '@/lib/grievance-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Grievance' };

export default async function GrievancePage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseGrvId((await params).id);
  if (id === null) notFound();
  const { supabase } = await requireContext();
  const g = await getDetail(supabase, id);
  if (!g) notFound(); // missing or not permitted: same response

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{g.subject}</h1>
          <p className="text-sm text-muted-foreground">
            {g.grievance_number} · {g.category_name}{g.department_name ? ` · ${g.department_name}` : ''} · priority {label(g.priority).toLowerCase()} · <span className="font-medium text-foreground">{label(g.status)}</span>
            {!g.is_owner && <> · {g.student_name} ({g.student_number})</>}
          </p>
        </div>
        <Link href="/grievances" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">All grievances</Link>
      </div>

      <Card><CardHeader><CardTitle>Description</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm">{g.description}</p></CardContent></Card>

      {g.resolution && (
        <Card><CardHeader><CardTitle>{g.status === 'REJECTED' ? 'Reason it was rejected' : 'Resolution'}</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm">{g.resolution}</p>{g.resolved_at && <p className="mt-1 text-xs text-muted-foreground">{new Date(g.resolved_at).toLocaleString()}</p>}</CardContent></Card>
      )}

      <Card>
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm">
            {g.actions.map((a, i) => (
              <li key={i} className="rounded-md border border-border bg-card px-3 py-2">
                <div className="font-medium">{label(a.action_type)}{a.new_status ? ` → ${label(a.new_status)}` : ''} <span className="font-normal text-muted-foreground">· {new Date(a.action_at).toLocaleString()}</span></div>
                {a.action_notes && <p className="mt-1 whitespace-pre-wrap">{a.action_notes}</p>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {g.is_owner && <Card><CardHeader><CardTitle>Your response</CardTitle></CardHeader><CardContent><StudentRespond grievanceId={id} status={g.status} />{g.status !== 'RESOLVED' && g.status !== 'REJECTED' && <p className="text-sm text-muted-foreground">You can respond once the grievance is resolved or rejected.</p>}</CardContent></Card>}
      {g.can_act && <Card><CardHeader><CardTitle>Handle this grievance</CardTitle></CardHeader><CardContent><ActionForm grievanceId={id} status={g.status} /></CardContent></Card>}
    </div>
  );
}
