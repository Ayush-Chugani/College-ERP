import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMyResults } from '@/features/assessment-data';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'My results' };

export default async function MyResultsPage() {
  const { supabase, ctx } = await requireContext();
  if (ctx.student_id === null) notFound();
  const terms = await getMyResults(supabase);
  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">My results</h1>
        <p className="text-sm text-muted-foreground">Only published results are shown.</p>
      </div>
      {terms.length === 0 ? (
        <p className="text-sm text-muted-foreground">No results have been published for you yet.</p>
      ) : (
        terms.map((t) => (
          <Card key={t.term_registration_id}>
            <CardHeader>
              <CardTitle>{t.term_name} · {t.semester_name}</CardTitle>
              <p className="text-sm text-muted-foreground">{t.programme_name} · {t.result_status} · SGPA {t.sgpa ?? '—'} · CGPA {t.cgpa ?? '—'} · credits {t.credits_earned}/{t.credits_registered}</p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted text-left"><tr>
                  <th scope="col" className="px-3 py-2 font-medium">Course</th><th scope="col" className="px-3 py-2 font-medium">Credits</th><th scope="col" className="px-3 py-2 font-medium">Internal</th>
                  <th scope="col" className="px-3 py-2 font-medium">External</th><th scope="col" className="px-3 py-2 font-medium">Total</th><th scope="col" className="px-3 py-2 font-medium">Grade</th>
                  <th scope="col" className="px-3 py-2 font-medium">Result</th>
                </tr></thead>
                <tbody>
                  {t.courses.map((c) => (
                    <tr key={c.course_code} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{c.course_code} — {c.course_title}</td><td className="px-3 py-2">{c.credits}</td><td className="px-3 py-2">{c.internal_marks ?? '—'}</td>
                      <td className="px-3 py-2">{c.external_marks ?? '—'}</td><td className="px-3 py-2">{c.total_marks ?? '—'}</td><td className="px-3 py-2">{c.grade_letter ?? '—'}</td>
                      <td className="px-3 py-2">{c.result_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
