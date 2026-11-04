import { fieldKind, humanize, type DetailColumn } from '@/lib/staff-validation';

export { REF_TABLES } from '@/lib/staff-validation';
export const SECTION_KINDS = ['student', 'employee', 'activity'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** Short text for a table cell. */
export function cellText(c: DetailColumn, value: unknown, labels: Record<string, Map<number, string>>): string {
  if (value === null || value === undefined || value === '') return '—';
  const kind = fieldKind(c);
  if (kind === 'boolean') return value ? 'Yes' : 'No';
  if (kind === 'ref') return labels[c.ref_table as string]?.get(Number(value)) ?? `#${String(value)}`;
  if (kind === 'choice') return humanize(String(value));
  if (kind === 'datetime') return new Date(String(value)).toLocaleString();
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** The columns shown in a list: required and short ones first, at most five. */
export function listColumns(columns: DetailColumn[]): DetailColumn[] {
  const rank = (c: DetailColumn) => (c.required ? 0 : 1) + (fieldKind(c) === 'longtext' ? 2 : 0);
  return [...columns].sort((a, b) => rank(a) - rank(b)).slice(0, 5);
}
