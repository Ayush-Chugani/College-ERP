import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl space-y-3 p-8">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">It does not exist, or you do not have access to it.</p>
      <Link href="/dashboard" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Go to the dashboard</Link>
    </main>
  );
}
