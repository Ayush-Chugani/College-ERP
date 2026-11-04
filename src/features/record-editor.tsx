'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DetailFields, useOptions } from '@/features/staff-forms';
import { cellText, listColumns } from '@/lib/record-validation';
import { buildDetail, detailToRaw, humanize, type DetailColumn, type RawDetail } from '@/lib/staff-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (['22023', '23505', '45000', '42501'].includes(e.code ?? '')) return e.message;
  return fallback;
}

export type EditorApi = {
  schema: () => Promise<{ columns: DetailColumn[]; pk: string; label: string } | null>;
  rows: () => Promise<{ rows: Record<string, unknown>[]; canCreate: boolean; canUpdate: boolean; canDelete: boolean } | { error: string }>;
  save: (id: number | null, values: Record<string, unknown>) => Promise<DbError | null>;
  remove: (id: number) => Promise<DbError | null>;
};

/** Student / employee sub-record sections. */
export function sectionApi(kind: string, parentId: number, section: string): EditorApi {
  const supabase = createClient();
  return {
    async schema() {
      const { data } = await supabase.rpc('section_schema', { p_kind: kind, p_section: section });
      return data ? { columns: (data as { columns: DetailColumn[] }).columns, pk: (data as { pk: string }).pk, label: (data as { label: string }).label } : null;
    },
    async rows() {
      const { data, error } = await supabase.rpc('section_rows', { p_kind: kind, p_parent_id: parentId, p_section: section });
      if (error || !data) return { error: error?.message ?? 'Could not load.' };
      const d = data as { rows: Record<string, unknown>[]; can_create: boolean; can_update: boolean; can_delete: boolean };
      return { rows: d.rows, canCreate: d.can_create, canUpdate: d.can_update, canDelete: d.can_delete };
    },
    async save(id, values) {
      const { error } = await supabase.rpc('section_save', { p_kind: kind, p_parent_id: parentId, p_section: section, p_id: id, p: id === null ? Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)) : values });
      return error;
    },
    async remove(id) {
      const { error } = await supabase.rpc('section_delete', { p_kind: kind, p_parent_id: parentId, p_section: section, p_id: id });
      return error;
    },
  };
}

/** Reference data tables. */
export function refApi(table: string): EditorApi {
  const supabase = createClient();
  return {
    async schema() {
      const { data } = await supabase.rpc('ref_schema', { p_table: table });
      return data ? { columns: (data as { columns: DetailColumn[] }).columns, pk: (data as { pk: string }).pk, label: (data as { label: string }).label } : null;
    },
    async rows() {
      const { data, error } = await supabase.rpc('ref_rows', { p_table: table });
      if (error || !data) return { error: error?.message ?? 'Could not load.' };
      return { rows: data as Record<string, unknown>[], canCreate: true, canUpdate: true, canDelete: true };
    },
    async save(id, values) {
      const { error } = await supabase.rpc('ref_save', { p_table: table, p_id: id, p: id === null ? Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)) : values });
      return error;
    },
    async remove(id) {
      const { error } = await supabase.rpc('ref_delete', { p_table: table, p_id: id });
      return error;
    },
  };
}

export function RecordEditor({ api, title }: { api: EditorApi; title?: string }) {
  const router = useRouter();
  const [meta, setMeta] = useState<{ columns: DetailColumn[]; pk: string; label: string } | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<EditorApi['rows']>> | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; raw: RawDetail } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [m, d] = await Promise.all([api.schema(), api.rows()]);
    setMeta(m);
    setData(d);
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const columns = useMemo(() => meta?.columns ?? [], [meta]);
  const options = useOptions(columns, 0, 'section_lookup_options');
  const labels = useMemo(() => Object.fromEntries(Object.entries(options).map(([t, list]) => [t, new Map(list.map((o) => [o.id, o.label]))])), [options]);
  const shown = useMemo(() => listColumns(columns), [columns]);

  async function save() {
    if (!editing) return;
    const { values, errors: errs } = buildDetail(columns, editing.raw);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return void toast.error('Please correct the highlighted fields.');
    setBusy(true);
    const error = await api.save(editing.id, values);
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'It could not be saved.'));
    toast.success('Saved.');
    setEditing(null);
    await load();
    router.refresh();
  }
  async function remove(id: number) {
    setBusy(true);
    const error = await api.remove(id);
    setBusy(false);
    setConfirmId(null);
    if (error) return void toast.error(dbMessage(error, 'It could not be deleted.'));
    toast.success('Deleted.');
    await load();
    router.refresh();
  }

  if (!meta || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if ('error' in data) return <p role="alert" className="text-sm text-destructive">You cannot view this section.</p>;
  const pk = meta.pk;
  return (
    <div className="space-y-3">
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {data.rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted text-left"><tr>
              {shown.map((c) => <th key={c.name} scope="col" className="px-3 py-2 font-medium">{humanize(c.name)}</th>)}
              <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const id = Number(r[pk]);
                return (
                  <tr key={id} className="border-b border-border last:border-0">
                    {shown.map((c) => <td key={c.name} className="px-3 py-2">{cellText(c, r[c.name], labels)}</td>)}
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {data.canUpdate && <Button type="button" variant="outline" disabled={busy} onClick={() => { setErrors({}); setEditing({ id, raw: detailToRaw(columns, r) }); }} aria-label={`Edit row ${id}`}>Edit</Button>}{' '}
                      {data.canDelete && (confirmId === id
                        ? <span className="inline-flex items-center gap-1 text-xs">Delete? <Button type="button" disabled={busy} onClick={() => remove(id)}>Yes</Button><Button type="button" variant="outline" onClick={() => setConfirmId(null)}>No</Button></span>
                        : <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmId(id)} aria-label={`Delete row ${id}`}>Delete</Button>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.canCreate && !editing && <Button type="button" onClick={() => { setErrors({}); setEditing({ id: null, raw: detailToRaw(columns, {}) }); }}>Add</Button>}
      {editing && (
        <div role="group" aria-label={editing.id === null ? 'Add a row' : 'Edit the row'} className="space-y-3 rounded-md border border-border bg-muted p-3">
          <DetailFields idPrefix="re" columns={columns} raw={editing.raw} setRaw={(n, v) => setEditing((e) => (e ? { ...e, raw: { ...e.raw, [n]: v } } : e))} errors={errors} options={options} />
          <div className="flex gap-2"><Button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div>
        </div>
      )}
    </div>
  );
}

export function SectionTabs({ kind, parentId, sections }: { kind: string; parentId: number; sections: { section: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.section ?? '');
  const api = useMemo(() => sectionApi(kind, parentId, active), [kind, parentId, active]);
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Record sections" className="flex flex-wrap gap-1 border-b border-border">
        {sections.map((s) => (
          <button key={s.section} type="button" role="tab" aria-selected={active === s.section} onClick={() => setActive(s.section)}
            className={`rounded-t-md px-3 py-2 text-sm ${active === s.section ? 'border-b-2 border-primary font-medium text-primary' : 'text-muted-foreground hover:bg-muted'}`}>{s.label}</button>
        ))}
      </div>
      <div role="tabpanel"><RecordEditor key={active} api={api} /></div>
    </div>
  );
}
