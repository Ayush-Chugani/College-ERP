import { AppShell } from '@/components/app-shell';
import { primaryRoleLabel, visibleNav } from '@/lib/nav';
import { requireContext } from '@/lib/server-context';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, supabase } = await requireContext();
  const { data: count } = await supabase.rpc('my_notification_count'); // a failed count must never break the page
  return (
    <AppShell nav={visibleNav(ctx)} user={{ name: ctx.username, role: primaryRoleLabel(ctx) }} notificationCount={typeof count === 'number' ? count : 0}>
      {children}
    </AppShell>
  );
}
