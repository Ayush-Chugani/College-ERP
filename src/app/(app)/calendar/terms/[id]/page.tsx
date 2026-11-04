import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getTerm, parseId } from '@/features/academic-data';
import { DeleteButton, TermForm } from '@/features/academic-forms';
import type { TermInput } from '@/lib/academic-validation';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Edit term' };

export default async function TermPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  if (!can(ctx, 'ACADEMIC_CALENDAR.ALL.CONFIGURE')) notFound();
  const t = await getTerm(supabase, id);
  if (!t) notFound();
  const defaults: TermInput = {
    term_code: t.term_code,
    term_name: t.term_name,
    term_type: t.term_type as TermInput['term_type'],
    start_date: t.start_date,
    end_date: t.end_date,
    registration_start_date: t.registration_start_date ?? '',
    registration_end_date: t.registration_end_date ?? '',
    status: t.status as TermInput['status'],
  };
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Edit term {t.term_name}</h1>
      <TermForm yearId={t.academic_year_id} id={id} defaults={defaults} />
      <Card>
        <CardHeader>
          <CardTitle>Delete term</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">Refused while registrations or offerings use this term. Otherwise set its status to CLOSED.</p>
          <DeleteButton table="academic_term" id={id} label="term" redirectTo={`/calendar/years/${t.academic_year_id}`} />
        </CardContent>
      </Card>
    </div>
  );
}
