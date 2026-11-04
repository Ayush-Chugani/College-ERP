import { AppShell } from '@/components/app-shell';
import { primaryRoleLabel, visibleNav } from '@/lib/nav';
import { requireContext } from '@/lib/server-context';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx } = await requireContext();
  return (
    <AppShell nav={visibleNav(ctx)} user={{ name: ctx.username, role: primaryRoleLabel(ctx) }}>
      {children}
    </AppShell>
  );
}
