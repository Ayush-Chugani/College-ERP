import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getYear, listTerms, parseId } from '@/features/academic-data';
import { DeleteButton, TermForm } from '@/features/academic-forms';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Academic year' };

export default async function YearDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const year = await getYear(supabase, id);
  if (!year) notFound();
  const terms = await listTerms(supabase, id);
  const canManage = can(ctx, 'ACADEMIC_CALENDAR.ALL.CONFIGURE');

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Academic year {year.year_code}</h1>
          <p className="text-sm text-muted-foreground">
            {year.start_date} → {year.end_date} · {year.status}
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Link href={`/calendar/years/${id}/edit`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Edit
            </Link>
          )}
          <Link href="/calendar" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
            Back
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Terms</CardTitle>
        </CardHeader>
        <CardContent>
          {terms.length === 0 ? (
            <p className="text-sm text-muted-foreground">No terms in this year yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {terms.map((t) => (
                <li key={t.academic_term_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{t.term_name}</span> <span className="text-muted-foreground">({t.term_code} · {t.term_type})</span>
                    <br />
                    <span className="text-muted-foreground">
                      {t.start_date} → {t.end_date} · {t.status}
                      {t.registration_start_date ? ` · registration ${t.registration_start_date} → ${t.registration_end_date ?? '…'}` : ''}
                    </span>
                  </span>
                  {canManage && (
                    <Link href={`/calendar/terms/${t.academic_term_id}`} className="text-primary underline-offset-4 hover:underline">
                      Edit
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Add term</CardTitle>
            </CardHeader>
            <CardContent>
              <TermForm yearId={id} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Delete academic year</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">Only possible while nothing refers to this year (no terms, enrolments or fees). Otherwise set its status to CLOSED.</p>
              <DeleteButton table="academic_year" id={id} label="academic year" redirectTo="/calendar" />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
