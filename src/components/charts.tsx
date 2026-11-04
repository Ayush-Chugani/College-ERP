'use client';

import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { colourFor, type Slice, type StackedRow } from '@/lib/dashboard-model';

const axis = { fontSize: 12, fill: '#64748b' } as const;

/** Every chart is followed by its numbers as a table, so the information never depends on colour or hover. */
function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-primary">View as table</summary>
      <table className="mt-2 w-full">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-left"><tr>{head.map((h, i) => <th key={h} scope="col" className={`px-2 py-1 font-medium ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className={`px-2 py-1 ${j > 0 ? 'text-right tabular-nums' : ''}`}>{typeof c === 'number' ? c.toLocaleString('en-IN') : c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

export function SliceBars({ title, data }: { title: string; data: Slice[] }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  const height = Math.max(120, data.length * 36 + 24);
  return (
    <figure aria-label={title}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke="#e2e8f0" />
            <XAxis type="number" allowDecimals={false} tick={axis} />
            <YAxis type="category" dataKey="name" width={110} tick={axis} />
            <Tooltip cursor={{ fill: '#f1f5f9' }} />
            <Bar dataKey="value" name="Count" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={d.name} fill={colourFor(d.name, i)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption={title} head={['Category', 'Count']} rows={data.map((d) => [d.name, d.value])} />
    </figure>
  );
}

export function StackedBars({ title, data, keys }: { title: string; data: StackedRow[]; keys: string[] }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  return (
    <figure aria-label={title}>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={axis} interval={0} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
            <YAxis allowDecimals={false} tick={axis} />
            <Tooltip cursor={{ fill: '#f1f5f9' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={colourFor(k, i)} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption={title} head={['Programme', ...keys]} rows={data.map((r) => [String(r.name), ...keys.map((k) => Number(r[k] ?? 0))])} />
    </figure>
  );
}

export function MonthlyBars({ title, data, unit }: { title: string; data: { name: string; collected: number; payments: number }[]; unit: string }) {
  if (data.every((d) => d.collected === 0)) return <p className="text-sm text-muted-foreground">No successful payments in this period.</p>;
  return (
    <figure aria-label={title}>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={axis} />
            <YAxis tick={axis} tickFormatter={(v: number) => v.toLocaleString('en-IN')} width={72} />
            <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => `${unit} ${Number(v).toLocaleString('en-IN')}`} />
            <Bar dataKey="collected" name="Collected" fill="#1e40af" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption={title} head={['Month', 'Collected', 'Payments']} rows={data.map((d) => [d.name, d.collected, d.payments])} />
    </figure>
  );
}
