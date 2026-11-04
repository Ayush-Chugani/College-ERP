'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { label } from '@/lib/staff-validation';
import { createClient } from '@/lib/supabase/client';

type Row = { agency_id: number; agency: string; status: string; url: string | null; remarks: string | null; year: number | null };
type Data = { rows: Row[]; kind: 'JOURNAL' | 'CONFERENCE'; can_edit: boolean };
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const STATUSES = ['CLAIMED', 'VERIFIED', 'DISCONTINUED', 'NOT_INDEXED'];

/** Indexing of a journal publication or conference activity (migration 055). Loads on the client so a page without the right can simply show nothing. */
export function IndexingPanel({ activityId }: { activityId: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [agencies, setAgencies] = useState<{ id: number; label: string }[]>([]);
  const [f, setF] = useState({ agency: '', status: 'CLAIMED', year: '', url: '', remarks: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const supabase = createClient();
    const [d, a] = await Promise.all([supabase.rpc('staff_indexing_list', { p_activity_id: activityId }), supabase.rpc('section_lookup_options', { p_table: 'indexing_agency' })]);
    setData(d.error ? null : (d.data as Data));
    setAgencies(((a.data ?? []) as { id: number; label: string }[]).map((x) => ({ id: Number(x.id), label: x.label })));
  }, [activityId]);
  useEffect(() => { void load(); }, [load]);
  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    const { error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) return void toast.error(['22023', '42501'].includes((error as { code?: string }).code ?? '') ? error.message : 'The change could not be saved.');
    toast.success(ok);
    await load();
  }
  if (!data) return <p className="text-sm text-muted-foreground">Indexing is not available for this record.</p>;
  return (
    <div className="space-y-3">
      {data.rows.length === 0 ? <p className="text-sm text-muted-foreground">No indexing recorded.</p> : (
        <ul className="divide-y divide-border text-sm">
          {data.rows.map((r) => (
            <li key={r.agency_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{r.agency}</span> · {label(r.status)}{r.year ? ` · ${r.year}` : ''}{r.url ? <> · <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">source</a></> : null}{r.remarks ? <span className="text-muted-foreground"> · {r.remarks}</span> : null}</span>
              {data.can_edit && <Button type="button" variant="outline" disabled={busy} onClick={() => run('staff_indexing_delete', { p_activity_id: activityId, p_agency_id: r.agency_id }, 'Removed.')}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {data.can_edit && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div className="w-52"><label htmlFor="ix-a" className="text-sm font-medium">Agency *</label><select id="ix-a" className={sel} value={f.agency} onChange={(e) => setF({ ...f, agency: e.target.value })}><option value="">Select…</option>{agencies.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
          <div className="w-40"><label htmlFor="ix-s" className="text-sm font-medium">Status</label><select id="ix-s" className={sel} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
          {data.kind === 'JOURNAL' && <div className="w-24"><label htmlFor="ix-y" className="text-sm font-medium">Year</label><input id="ix-y" inputMode="numeric" maxLength={4} className={sel} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></div>}
          <div className="w-64"><label htmlFor="ix-u" className="text-sm font-medium">Source link</label><input id="ix-u" maxLength={1000} className={sel} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></div>
          <div className="w-52"><label htmlFor="ix-r" className="text-sm font-medium">Remarks</label><input id="ix-r" maxLength={500} className={sel} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></div>
          <Button type="button" disabled={busy || !f.agency} onClick={() => run('staff_indexing_save', { p_activity_id: activityId, p_agency_id: Number(f.agency), p_status: f.status, p_year: f.year ? Number(f.year) : null, p_url: f.url || null, p_remarks: f.remarks || null }, 'Saved.')}>Save indexing</Button>
        </div>
      )}
    </div>
  );
}
