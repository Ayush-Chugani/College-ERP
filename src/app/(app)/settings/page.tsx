import type { Metadata } from 'next';
import { NewPasswordForm } from '@/components/new-password-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const { ctx, authUser } = await requireContext();
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Username</dt>
            <dd>{ctx.username}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{authUser.email ?? ctx.email ?? '—'}</dd>
            <dt className="text-muted-foreground">Roles</dt>
            <dd>
              {ctx.roles.length === 0 ? (
                'None'
              ) : (
                <ul className="space-y-1">
                  {ctx.roles.map((r, i) => (
                    <li key={`${r.role_code}-${i}`}>
                      {r.role_name} <span className="text-muted-foreground">({r.scope_type.toLowerCase()})</span>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Name, roles and scopes are managed by an administrator.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <NewPasswordForm redirectTo="/settings" />
        </CardContent>
      </Card>
    </div>
  );
}
