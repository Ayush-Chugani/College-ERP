'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NOTIFICATION_KINDS, safeInternalHref } from '@/lib/account-validation';
import { createClient } from '@/lib/supabase/client';

export type NotificationRow = { notif_key: string; kind: string; title: string; body: string | null; href: string | null; at: string | null };

export function NotificationList({ rows }: { rows: NotificationRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function dismiss(key: string) {
    setBusy(true);
    const { error } = await createClient().rpc('notification_dismiss', { p_key: key });
    setBusy(false);
    if (error) return void toast.error('It could not be dismissed.');
    router.refresh();
  }
  async function dismissAll() {
    setBusy(true);
    const { error } = await createClient().rpc('notification_dismiss_all');
    setBusy(false);
    if (error) return void toast.error('They could not be dismissed.');
    router.refresh();
  }
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">You are all caught up.</p>;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button type="button" variant="outline" disabled={busy} onClick={dismissAll}>Dismiss all</Button></div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((n) => (
          <li key={n.notif_key} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{NOTIFICATION_KINDS[n.kind] ?? n.kind}{n.at ? ` · ${new Date(n.at).toLocaleDateString()}` : ''}</div>
              <Link href={safeInternalHref(n.href)} className="font-medium text-primary underline-offset-4 hover:underline">{n.title}</Link>
              {n.body && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{n.body}</p>}
            </div>
            <Button type="button" variant="outline" disabled={busy} onClick={() => dismiss(n.notif_key)} aria-label={`Dismiss: ${n.title}`}>Dismiss</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
