import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SEARCH_LABELS, SEARCH_ROUTES, searchParams } from '@/lib/account-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Search' };

type Hit = { kind: string; id: number; title: string; subtitle: string | null };

export default async function SearchPage({ searchParams: sp }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase } = await requireContext();
  const { q } = searchParams.parse(await sp);
  const ready = (q ?? '').length >= 2;
  const { data, error } = ready ? await supabase.rpc('global_search', { p_q: q, p_limit: 10 }) : { data: [], error: null };
  const hits = (data ?? []) as Hit[];
  const kinds = Object.keys(SEARCH_LABELS).filter((k) => hits.some((h) => h.kind === k));
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Search</h1>
      <form method="get" action="/search" className="flex gap-2" role="search">
        <input name="q" defaultValue={q ?? ''} aria-label="Search" placeholder="Name, number, code" maxLength={80} className="h-9 w-full max-w-md rounded-md border border-border bg-card px-3 text-sm" autoFocus />
        <Button type="submit">Search</Button>
      </form>
      {q !== undefined && !ready && <p className="text-sm text-muted-foreground">Type at least two characters.</p>}
      {error && <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-destructive">The search failed. Try again.</p>}
      {ready && !error && hits.length === 0 && <p className="text-sm text-muted-foreground">Nothing found that you are allowed to see.</p>}
      {kinds.map((k) => (
        <Card key={k}>
          <CardHeader><CardTitle>{SEARCH_LABELS[k]}</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {hits.filter((h) => h.kind === k).map((h) => (
                <li key={`${k}-${h.id}`} className="py-2"><Link href={SEARCH_ROUTES[k]?.(Number(h.id)) ?? '/dashboard'} className="text-primary underline-offset-4 hover:underline">{h.title}</Link>{h.subtitle && <span className="text-muted-foreground"> · {h.subtitle}</span>}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
