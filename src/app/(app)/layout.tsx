import { MfaPanel } from '@/components/account-panels';
import { AppShell } from '@/components/app-shell';
import { primaryRoleLabel, visibleNav } from '@/lib/nav';
import { requireContext } from '@/lib/server-context';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, supabase } = await requireContext();
  const { data: count } = await supabase.rpc('my_notification_count'); // a failed count must never break the page
  return (
    <AppShell nav={visibleNav(ctx)} user={{ name: ctx.username, role: primaryRoleLabel(ctx) }} notificationCount={typeof count === 'number' ? count : 0}>
      {ctx.mfa_setup_required ? (
        <div className="max-w-2xl space-y-3">
          <h1 className="text-xl font-semibold">Two-step verification is required</h1>
          <p className="text-sm text-muted-foreground">Your role requires an authenticator app. Set it up below; the rest of the system opens as soon as you have.</p>
          <MfaPanel />
        </div>
      ) : children}
    </AppShell>
  );
}
