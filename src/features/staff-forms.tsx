'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import type { Opt } from '@/features/activity-data';
import type { ActivityTypeOpt, Contributor, DetailSchema, StaffDetail } from '@/features/staff-data';
import {
  buildDetail, contributorSchema, detailToRaw, fieldKind, humanize, LOOKUP_TABLES, staffPayload, staffSchema,
  type ContributorInput, type ContributorValues, type DetailColumn, type RawDetail, type StaffInput, type StaffValues,
} from '@/lib/staff-validation';
import { createClient } from '@/lib/supabase/client';

type DbError = { code?: string; message: string };
function dbMessage(e: DbError, fallback: string): string {
  if (e.code === '45000' || e.code === '22023' || e.code === '23505') return e.message;
  if (e.code === '42501') return /Not authorised/.test(e.message) ? e.message : 'You are not allowed to do that.';
  return fallback;
}
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const area = 'w-full rounded-md border border-border bg-card p-2 text-sm';

type OptionMap = Record<string, Opt[]>;

/** Loads id/label options for the referenced tables of a column list (only the ones the forms may list). */
function useOptions(columns: DetailColumn[], reloadKey: number): OptionMap {
  const [map, setMap] = useState<OptionMap>({});
  useEffect(() => {
    let alive = true;
    const tables = [...new Set(columns.filter((c) => fieldKind(c) === 'ref').map((c) => c.ref_table as string))];
    const supabase = createClient();
    Promise.all(tables.map(async (t) => {
      const { data } = await supabase.rpc('staff_lookup_options', { p_table: t });
      return [t, ((data ?? []) as { id: number; label: string }[]).map((r) => ({ id: Number(r.id), label: r.label }))] as const;
    })).then((entries) => { if (alive) setMap(Object.fromEntries(entries)); });
    return () => { alive = false; };
  }, [columns, reloadKey]);
  return map;
}

export function DetailFields({ idPrefix, columns, raw, setRaw, errors, options, onAddNew }: {
  idPrefix: string; columns: DetailColumn[]; raw: RawDetail; setRaw: (name: string, value: string | boolean) => void; errors: Record<string, string>; options: OptionMap; onAddNew?: (table: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {columns.map((c) => {
        const id = `${idPrefix}-${c.name}`;
        const kind = fieldKind(c);
        const title = `${humanize(c.name)}${c.required ? ' *' : ''}`;
        const err = errors[c.name];
        const value = raw[c.name];
        const common = { id, 'aria-invalid': !!err, 'aria-describedby': err ? `${id}-err` : undefined };
        let control: React.ReactNode;
        if (kind === 'boolean') {
          return <label key={c.name} className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" id={id} checked={value === true} onChange={(e) => setRaw(c.name, e.target.checked)} /> {humanize(c.name)}</label>;
        } else if (kind === 'choice') {
          control = <select {...common} className={sel} value={String(value ?? '')} onChange={(e) => setRaw(c.name, e.target.value)}><option value="">— select —</option>{c.choices?.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</select>;
        } else if (kind === 'ref') {
          const list = options[c.ref_table as string] ?? [];
          control = (
            <div className="flex gap-2">
              <select {...common} className={sel} value={String(value ?? '')} onChange={(e) => setRaw(c.name, e.target.value)}><option value="">— select —</option>{list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
              {onAddNew && (LOOKUP_TABLES as readonly string[]).includes(c.ref_table as string) && <Button type="button" variant="outline" onClick={() => onAddNew(c.ref_table as string)} aria-label={`Add a new ${humanize(c.name).toLowerCase()}`}>New…</Button>}
            </div>
          );
        } else if (kind === 'longtext') {
          control = <textarea {...common} rows={3} maxLength={c.max_length ?? 5000} className={area} value={String(value ?? '')} onChange={(e) => setRaw(c.name, e.target.value)} />;
        } else {
          const type = kind === 'date' ? 'date' : kind === 'datetime' ? 'datetime-local' : kind === 'integer' || kind === 'number-id' || kind === 'decimal' ? 'text' : 'text';
          control = <input {...common} type={type} inputMode={kind === 'integer' || kind === 'number-id' ? 'numeric' : kind === 'decimal' ? 'decimal' : undefined} maxLength={c.max_length ?? undefined} className={sel} value={String(value ?? '')} onChange={(e) => setRaw(c.name, e.target.value)} />;
        }
        return (
          <div key={c.name} className={kind === 'longtext' ? 'sm:col-span-2' : undefined}>
            <label htmlFor={id} className="text-sm font-medium">{title}</label>
            {control}
            {kind === 'number-id' && <p className="mt-1 text-xs text-muted-foreground">Enter the reference number</p>}
            {err && <p id={`${id}-err`} role="alert" className="text-sm text-destructive">{err}</p>}
          </div>
        );
      })}
    </div>
  );
}

function LookupAdd({ table, onDone, onCancel }: { table: string; onDone: (id: number) => void; onCancel: () => void }) {
  const [schema, setSchema] = useState<DetailSchema | null>(null);
  const [raw, setRawState] = useState<RawDetail>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    createClient().rpc('staff_lookup_schema', { p_table: table }).then(({ data }) => setSchema((data as DetailSchema) ?? null));
  }, [table]);
  const columns = schema?.columns ?? [];
  const options = useOptions(columns, reload);
  async function save() {
    const { values, errors: errs } = buildDetail(columns, raw);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    const { data, error } = await createClient().rpc('staff_lookup_add', { p_table: table, p: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)) });
    setBusy(false);
    if (error) return void toast.error(dbMessage(error, 'It could not be added.'));
    toast.success('Added.');
    setReload((n) => n + 1);
    onDone(Number(data));
  }
  return (
    <div role="group" aria-label={`Add a new ${humanize(table).toLowerCase()}`} className="space-y-3 rounded-md border border-border bg-muted p-3">
      <p className="text-sm font-medium">New {humanize(table).toLowerCase()}</p>
      {!schema ? <p className="text-sm text-muted-foreground">Loading…</p> : <DetailFields idPrefix={`new-${table}`} columns={columns} raw={raw} setRaw={(n, v) => setRawState((r) => ({ ...r, [n]: v }))} errors={errors} options={options} />}
      <div className="flex gap-2"><Button type="button" disabled={busy || !schema} onClick={save}>Add</Button><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}

export type StaffLookups = { types: ActivityTypeOpt[]; years: Opt[]; levels: Opt[]; roles: Opt[] };

export function StaffActivityForm({ lookups, initial }: { lookups: StaffLookups; initial?: StaffDetail }) {
  const router = useRouter();
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const form = useForm<StaffInput, unknown, StaffValues>({
    resolver: zodResolver(staffSchema),
    defaultValues: initial
      ? { activity_type_id: s(initial.activity_type_id), activity_title: initial.activity_title, start_date: s(initial.start_date), end_date: s(initial.end_date), academic_year_id: s(initial.academic_year_id),
          participation_level_id: s(initial.participation_level_id), primary_role_type_id: s(initial.primary_role_type_id), description: s(initial.description), outcomes: s(initial.outcomes) }
      : { activity_type_id: '' },
  });
  const typeId = form.watch('activity_type_id');
  const e = form.formState.errors;
  const [schema, setSchema] = useState<DetailSchema>({ table: null, columns: [] });
  const [raw, setRawState] = useState<RawDetail>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!typeId) { setSchema({ table: null, columns: [] }); return; }
    let alive = true;
    createClient().rpc('staff_detail_schema', { p_activity_type_id: Number(typeId) }).then(({ data }) => {
      if (!alive) return;
      const sc = (data as DetailSchema) ?? { table: null, columns: [] };
      setSchema(sc);
      setRawState(initial && String(initial.activity_type_id) === typeId ? detailToRaw(sc.columns, initial.detail) : detailToRaw(sc.columns, {}));
      setDetailErrors({});
    });
    return () => { alive = false; };
  }, [typeId, initial]);

  const options = useOptions(schema.columns, reload);
  const setRaw = useCallback((name: string, value: string | boolean) => setRawState((r) => ({ ...r, [name]: value })), []);

  async function submit(v: StaffValues) {
    const { values, errors: errs } = buildDetail(schema.columns, raw);
    setDetailErrors(errs);
    if (Object.keys(errs).length > 0) return void toast.error('Please correct the highlighted fields.');
    const { data, error } = await createClient().rpc('staff_activity_save', { p_activity_id: initial?.staff_activity_id ?? null, p_employee_id: null, p: staffPayload(v), p_detail: schema.table ? values : null });
    if (error) return void toast.error(dbMessage(error, 'The record could not be saved.'));
    toast.success('Saved.');
    if (initial) router.refresh();
    else router.push(`/staff-profile/${data as number}`);
  }
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate aria-label="Staff record">
      <div className="flex flex-wrap items-start gap-3">
        <SelectField id="sp-type" label="Type *" className="w-72" options={lookups.types} {...form.register('activity_type_id')} error={e.activity_type_id?.message} />
        <SelectField id="sp-year" label="Academic year" className="w-40" options={lookups.years} {...form.register('academic_year_id')} />
        <SelectField id="sp-level" label="Level" className="w-44" options={lookups.levels} {...form.register('participation_level_id')} />
        <SelectField id="sp-role" label="Your role" className="w-52" options={lookups.roles} {...form.register('primary_role_type_id')} />
      </div>
      <TextField id="sp-title" label="Title *" className="max-w-2xl" maxLength={500} {...form.register('activity_title')} error={e.activity_title?.message} />
      <div className="flex flex-wrap gap-3">
        <TextField id="sp-start" type="date" label="Start date" className="w-44" {...form.register('start_date')} error={e.start_date?.message} />
        <TextField id="sp-end" type="date" label="End date" className="w-44" {...form.register('end_date')} error={e.end_date?.message} />
      </div>
      <div className="max-w-2xl"><label htmlFor="sp-desc" className="text-sm font-medium">Description</label><textarea id="sp-desc" rows={3} maxLength={5000} className={area} {...form.register('description')} /></div>
      <div className="max-w-2xl"><label htmlFor="sp-out" className="text-sm font-medium">Outcomes</label><textarea id="sp-out" rows={3} maxLength={5000} className={area} {...form.register('outcomes')} /></div>
      {schema.table && (
        <fieldset className="space-y-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">{humanize(schema.table)} details</legend>
          <DetailFields idPrefix="sd" columns={schema.columns} raw={raw} setRaw={setRaw} errors={detailErrors} options={options} onAddNew={setAdding} />
          {adding && <LookupAdd table={adding} onCancel={() => setAdding(null)} onDone={() => { setAdding(null); setReload((n) => n + 1); }} />}
        </fieldset>
      )}
      <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving…' : initial ? 'Save changes' : 'Create draft'}</Button>
    </form>
  );
}

export function ContributorPanel({ a, roles }: { a: StaffDetail; roles: Opt[] }) {
  const router = useRouter();
  const form = useForm<ContributorInput, unknown, ContributorValues>({ resolver: zodResolver(contributorSchema), defaultValues: { kind: 'EXTERNAL' } });
  const kind = form.watch('kind');
  const e = form.formState.errors;
  async function add(v: ContributorValues) {
    const supabase = createClient();
    let employeeId: number | null = null;
    if (v.kind === 'EMPLOYEE') {
      const { data } = await supabase.from('employee').select('employee_id').eq('employee_number', v.employee_number ?? '').maybeSingle();
      if (!data) return void form.setError('employee_number', { message: 'No visible employee has that number' });
      employeeId = Number((data as { employee_id: number }).employee_id);
    }
    const { error } = await supabase.rpc('staff_contributor_add', {
      p_activity_id: a.staff_activity_id, p_employee_id: employeeId, p_external_name: v.kind === 'EXTERNAL' ? v.external_name ?? null : null, p_external_email: v.external_email ?? null,
      p_affiliation: v.affiliation ?? null, p_role_type_id: v.role_type_id ?? null, p_is_corresponding: v.is_corresponding ?? false, p_details: v.details ?? null,
    });
    if (error) return void toast.error(dbMessage(error, 'The contributor could not be added.'));
    toast.success('Contributor added.');
    form.reset({ kind: v.kind });
    router.refresh();
  }
  async function remove(c: Contributor) {
    const { error } = await createClient().rpc('staff_contributor_remove', { p_contributor_id: c.contributor_id });
    if (error) return void toast.error(dbMessage(error, 'The contributor could not be removed.'));
    router.refresh();
  }
  return (
    <div className="space-y-3">
      {a.contributors.length === 0 ? <p className="text-sm text-muted-foreground">No other contributors.</p> : (
        <ul className="divide-y divide-border text-sm">
          {a.contributors.map((c) => (
            <li key={c.contributor_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{c.name}{c.is_corresponding ? ' (corresponding)' : ''}<span className="text-muted-foreground">{c.role ? ` · ${c.role}` : ''}{c.affiliation ? ` · ${c.affiliation}` : ''}{c.is_employee ? '' : ' · external'}</span></span>
              {a.can_edit && <Button type="button" variant="outline" onClick={() => remove(c)} aria-label={`Remove ${c.name}`}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {a.can_edit && (
        <form onSubmit={form.handleSubmit(add)} className="flex flex-wrap items-start gap-3" noValidate aria-label="Add a contributor">
          <div className="w-44"><label htmlFor="ct-k" className="text-sm font-medium">Contributor is</label><select id="ct-k" className={sel} {...form.register('kind')}><option value="EXTERNAL">Not an employee here</option><option value="EMPLOYEE">An employee here</option></select></div>
          {kind === 'EMPLOYEE' ? <TextField id="ct-n" label="Employee number *" className="w-44" {...form.register('employee_number')} error={e.employee_number?.message} /> : <TextField id="ct-e" label="Name *" className="w-52" maxLength={250} {...form.register('external_name')} error={e.external_name?.message} />}
          {kind === 'EXTERNAL' && <TextField id="ct-m" label="Email" className="w-52" maxLength={254} {...form.register('external_email')} error={e.external_email?.message} />}
          <TextField id="ct-a" label="Affiliation" className="w-56" maxLength={500} {...form.register('affiliation')} />
          <SelectField id="ct-r" label="Role" className="w-44" options={roles} {...form.register('role_type_id')} />
          <label className="mt-6 flex items-center gap-1 text-sm"><input type="checkbox" {...form.register('is_corresponding')} /> Corresponding</label>
          <Button type="submit" className="mt-5" disabled={form.formState.isSubmitting}>Add</Button>
        </form>
      )}
    </div>
  );
}
