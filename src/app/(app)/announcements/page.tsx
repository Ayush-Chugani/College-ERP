import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getFeed } from '@/features/communication-data';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Announcements' };

export default async function AnnouncementsPage() {
  const { supabase, ctx } = await requireContext();
  const items = await getFeed(supabase, 50);
  const manage = ctx.permissions.some((p) => p.startsWith('COMMUNICATION.'));

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Announcements</h1>
          <p className="text-sm text-muted-foreground">Notices published for you.</p>
        </div>
        {manage && <Link href="/announcements/manage" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Manage announcements</Link>}
      </div>
      {items.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">There are no announcements for you right now.</CardContent></Card>
      ) : items.map((a) => (
        <Card key={a.announcement_id}>
          <CardHeader>
            <CardTitle><Link href={`/announcements/${a.announcement_id}`} className="text-primary underline-offset-4 hover:underline">{a.title}</Link></CardTitle>
            <p className="text-xs text-muted-foreground">{a.type_name} · {a.department_name ?? 'Institution'} · {new Date(a.publish_from).toLocaleDateString()}</p>
          </CardHeader>
          <CardContent><p className="line-clamp-3 whitespace-pre-wrap text-sm">{a.description}</p></CardContent>
        </Card>
      ))}
    </div>
  );
}
