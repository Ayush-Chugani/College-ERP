import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MfaChallengeForm } from './mfa-form';

export const metadata: Metadata = { title: 'Verification code' };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return (
    <Card>
      <CardHeader><CardTitle>Enter your verification code</CardTitle></CardHeader>
      <CardContent><MfaChallengeForm next={sp.next} /></CardContent>
    </Card>
  );
}
