import type { Metadata } from 'next';
import { NotificationList, type NotificationRow } from '@/components/notification-list';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const { supabase } = await requireContext();
  const { data, error } = await supabase.rpc('my_notifications', { p_limit: 100 });
  return (
    <div className="max-w-3xl space-y-4">
      <div><h1 className="text-xl font-semibold">Notifications</h1><p className="text-sm text-muted-foreground">Decisions on your submissions, announcements and work waiting for you.</p></div>
      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">Could not load your notifications.</p>}
      <NotificationList rows={(data ?? []) as NotificationRow[]} />
    </div>
  );
}
