export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className="max-w-5xl animate-pulse space-y-4">
      <div className="h-7 w-48 rounded-md bg-muted" />
      <div className="h-4 w-80 max-w-full rounded-md bg-muted" />
      <div className="h-64 rounded-lg border border-border bg-muted/50" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
