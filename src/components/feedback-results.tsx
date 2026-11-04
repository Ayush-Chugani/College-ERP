import { SliceBars } from '@/components/charts';
import type { Results } from '@/features/feedback-data';

/** Aggregated feedback. Suppressed groups show only the count; free text appears only when the server returned it. */
export function ResultsView({ results }: { results: Results | null }) {
  if (!results) return <p className="text-sm text-destructive">The results could not be loaded.</p>;
  if (results.suppressed)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {results.response_count === 0
          ? 'There are no results you can see here.'
          : `Results are shown once at least ${results.minimum} responses are available, so that nobody can be identified. There ${results.response_count === 1 ? 'is' : 'are'} ${results.response_count} so far.`}
      </p>
    );
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{results.response_count} responses · {results.anonymous ? 'anonymous' : 'named'} · results visible to {results.visibility.toLowerCase().replace('_', ' ')}</p>
      {results.questions.map((q, i) => (
        <section key={q.questionnaire_item_id} aria-label={q.question_text} className="space-y-2">
          <h3 className="text-sm font-semibold">{i + 1}. {q.question_text}</h3>
          <p className="text-xs text-muted-foreground">{q.answered} answered{q.average !== null ? ` · average ${Number(q.average).toFixed(2)}` : ''}</p>
          {q.response_type !== 'TEXT' && <SliceBars title={q.question_text} data={q.distribution.map((d) => ({ name: d.label, value: Number(d.count) }))} />}
          {q.response_type === 'TEXT' && (q.texts.length === 0 ? <p className="text-sm text-muted-foreground">Written answers are not shown to you.</p> : (
            <ul className="space-y-1 text-sm">{q.texts.map((t, k) => <li key={k} className="rounded-md border border-border bg-card px-3 py-1.5">{t}</li>)}</ul>
          ))}
        </section>
      ))}
    </div>
  );
}
