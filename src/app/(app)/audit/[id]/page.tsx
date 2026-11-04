import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAudit, parseId } from '@/features/iam-data';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Audit entry' };

function Json({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent><pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(value, null, 2)}</pre></CardContent></Card>;
}

export default async function AuditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const { supabase } = await requireContext();
  const a = await getAudit(supabase, id);
  if (!a) notFound();
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{a.module_code} · {a.action_code}</h1>
          <p className="text-sm text-muted-foreground">{new Date(a.activity_at).toLocaleString()} · {a.username ?? 'system'} · {a.entity_name ?? '—'}{a.entity_id ? ` #${a.entity_id}` : ''}</p>
        </div>
        <Link href="/audit" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Audit log</Link>
      </div>
      <Json title="Before" value={a.before_values} />
      <Json title="After" value={a.after_values} />
      <Json title="Details" value={a.details} />
    </div>
  );
}
