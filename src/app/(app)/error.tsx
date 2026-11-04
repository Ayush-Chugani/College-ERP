'use client';

import { Button } from '@/components/ui/button';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="max-w-xl space-y-3 rounded-lg border border-border bg-card p-6">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">This page could not be shown. Your data has not been changed. Try again, and if the problem continues tell the administrator{error.digest ? ` (reference ${error.digest})` : ''}.</p>
      <Button type="button" onClick={reset}>Try again</Button>
    </div>
  );
}
