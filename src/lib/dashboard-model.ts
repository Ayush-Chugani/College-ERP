/** Pure shaping of dashboard RPC rows into chart series. Kept free of React / Supabase so it can be unit tested. */

export type Slice = { name: string; value: number };
export type StackedRow = { name: string } & Record<string, number | string>;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Humanise an enum value: PARTIALLY_PAID -> Partially paid. */
export function humanise(code: string): string {
  const s = code.replace(/_/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Collapse rows of (label, count) into slices, summing duplicates, dropping zeros, largest first (ties alphabetical). */
export function toSlices(rows: { label: string; n: number | string }[]): Slice[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.label, (m.get(r.label) ?? 0) + num(r.n));
  return [...m.entries()].filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

export const sumSlices = (s: Slice[]) => s.reduce((t, x) => t + x.value, 0);

export type EnrolmentRow = { programme_id: number; label: string; enrolment_status: string; n: number | string };

/** One stacked bar per programme with a key per status; programmes ordered by total size, at most `limit` (the rest become "Other programmes"). */
export function stackEnrolments(rows: EnrolmentRow[], limit = 8): { data: StackedRow[]; statuses: string[]; total: number } {
  const byProg = new Map<number, { name: string; counts: Map<string, number> }>();
  const statuses = new Set<string>();
  for (const r of rows) {
    const status = humanise(r.enrolment_status);
    statuses.add(status);
    const p = byProg.get(r.programme_id) ?? { name: r.label, counts: new Map<string, number>() };
    p.counts.set(status, (p.counts.get(status) ?? 0) + num(r.n));
    byProg.set(r.programme_id, p);
  }
  const sizeOf = (p: { counts: Map<string, number> }) => [...p.counts.values()].reduce((a, b) => a + b, 0);
  const sorted = [...byProg.values()].sort((a, b) => sizeOf(b) - sizeOf(a) || a.name.localeCompare(b.name));
  const keep = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const toRow = (name: string, counts: Map<string, number>): StackedRow => {
    const row: StackedRow = { name };
    for (const s of statuses) row[s] = counts.get(s) ?? 0;
    return row;
  };
  const data = keep.map((p) => toRow(p.name, p.counts));
  if (rest.length) {
    const merged = new Map<string, number>();
    for (const p of rest) for (const [s, v] of p.counts) merged.set(s, (merged.get(s) ?? 0) + v);
    data.push(toRow(`Other programmes (${rest.length})`, merged));
  }
  return { data, statuses: [...statuses].sort(), total: sorted.reduce((t, p) => t + sizeOf(p), 0) };
}

export type FeeMonth = { month: string; collected: number | string; payments: number | string };

/** Month labels like "Mar 2026" from a YYYY-MM-DD date (UTC, no locale dependence). */
export function monthLabel(iso: string): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = Number(iso.slice(5, 7));
  return `${names[m - 1] ?? '???'} ${iso.slice(0, 4)}`;
}

export function feeSeries(rows: FeeMonth[]): { name: string; collected: number; payments: number }[] {
  return rows.map((r) => ({ name: monthLabel(r.month), collected: num(r.collected), payments: num(r.payments) }));
}

/** Indian digit grouping with no decimals for tiles (₹ 12,34,567). */
export function rupees(n: number | string | null | undefined): string {
  return `₹ ${Math.round(num(n)).toLocaleString('en-IN')}`;
}

export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

export type TermResultRow = { result_status: string; published: boolean; n: number | string };
export function resultSlices(rows: TermResultRow[]): { published: Slice[]; unpublished: Slice[] } {
  const pick = (flag: boolean) => toSlices(rows.filter((r) => r.published === flag).map((r) => ({ label: humanise(r.result_status), n: r.n })));
  return { published: pick(true), unpublished: pick(false) };
}

export type EmployeeRow = { employment_type: string; employment_status: string; n: number | string };
export function employeeSlices(rows: EmployeeRow[]): { byStatus: Slice[]; byType: Slice[] } {
  return {
    byStatus: toSlices(rows.map((r) => ({ label: humanise(r.employment_status), n: r.n }))),
    byType: toSlices(rows.map((r) => ({ label: humanise(r.employment_type), n: r.n }))),
  };
}

/** Stable colour per label so a status keeps its colour across charts. Semantic statuses get fixed hues; others cycle a palette. */
const PALETTE = ['#1e40af', '#0f766e', '#b45309', '#7c3aed', '#be185d', '#475569', '#15803d', '#0369a1'];
const SEMANTIC: Record<string, string> = {
  active: '#15803d', completed: '#1e40af', pass: '#15803d', paid: '#15803d', approved: '#15803d', admitted: '#15803d', conducted: '#15803d', present: '#15803d',
  fail: '#b91c1c', rejected: '#b91c1c', cancelled: '#b91c1c', withdrawn: '#b91c1c', failed: '#b91c1c', overdue: '#b91c1c',
  pending: '#b45309', planned: '#64748b', draft: '#64748b', submitted: '#0369a1', incomplete: '#b45309', withheld: '#b45309', 'on hold': '#b45309',
};
export function colourFor(label: string, index: number): string {
  return SEMANTIC[label.toLowerCase()] ?? PALETTE[index % PALETTE.length] ?? '#475569';
}
