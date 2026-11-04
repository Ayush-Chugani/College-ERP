import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'No access' };

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Account not activated</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            You are signed in, but your account is not linked to an active SIMS profile (it may be pending, locked or disabled). Contact your
            administrator.
          </p>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
