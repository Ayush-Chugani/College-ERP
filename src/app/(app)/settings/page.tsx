import type { Metadata } from 'next';
import { MfaPanel, ProfileForm } from '@/components/account-panels';
import { NewPasswordForm } from '@/components/new-password-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Settings' };

type Login = { login_at: string; logout_at: string | null; was_successful: boolean; failure_reason: string | null; ip_address: string | null };
type Profile = { kind: 'student' | 'employee' | 'none'; name?: string; number?: string; primary_email?: string | null; primary_phone?: string | null };

export default async function SettingsPage() {
  const { ctx, authUser, supabase } = await requireContext();
  const [{ data: profileData }, { data: loginData }] = await Promise.all([supabase.rpc('my_profile'), supabase.rpc('my_recent_logins', { p_limit: 8 })]);
  const profile = (profileData ?? { kind: 'none' }) as Profile;
  const logins = (loginData ?? []) as Login[];
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
            <dt className="text-muted-foreground">Sign-in email</dt>
            <dd>{authUser.email ?? ctx.email ?? '—'}</dd>
            {profile.kind !== 'none' && (<><dt className="text-muted-foreground">{profile.kind === 'student' ? 'Student' : 'Employee'}</dt><dd>{profile.name} <span className="text-muted-foreground">({profile.number})</span></dd></>)}
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
      {profile.kind !== 'none' && (
        <Card>
          <CardHeader><CardTitle>Contact details</CardTitle></CardHeader>
          <CardContent><ProfileForm initial={{ primary_email: profile.primary_email ?? null, primary_phone: profile.primary_phone ?? null }} /></CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <NewPasswordForm redirectTo="/settings" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Two-step verification</CardTitle></CardHeader>
        <CardContent><MfaPanel /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent sign-ins</CardTitle></CardHeader>
        <CardContent>
          {logins.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
            <ul className="divide-y divide-border text-sm">
              {logins.map((l, i) => (
                <li key={`${l.login_at}-${i}`} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{new Date(l.login_at).toLocaleString()}{l.ip_address ? <span className="text-muted-foreground"> · {l.ip_address}</span> : null}</span>
                  <span className={l.was_successful ? 'text-muted-foreground' : 'text-destructive'}>{l.was_successful ? (l.logout_at ? 'Signed out' : 'Signed in') : 'Failed attempt'}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
