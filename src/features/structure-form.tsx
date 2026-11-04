'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, type FieldValues, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { FieldError, Label } from '@/components/ui/input';
import { buildSchema, CONFIG, defaultValues, hrefFor, toPayload, type FieldDef, type Kind } from '@/lib/structure-config';
import { createClient } from '@/lib/supabase/client';

type Option = { id: number; label: string };

function message(e: { code?: string }, noun: string): string {
  if (e.code === '23505') return `That ${noun} code is already in use (codes are unique within their parent).`;
  if (e.code === '23514') return 'The values break a database rule (check the numbers and options).';
  if (e.code === '23503') return `The selected parent does not exist.`;
  if (e.code === '42501') return `You are not allowed to change ${noun}s here.`;
  return `Could not save the ${noun}.`;
}

function Field({ f, register, errors }: { f: FieldDef; register: ReturnType<typeof useForm>['register']; errors: Record<string, { message?: string } | undefined> }) {
  const err = errors[f.name]?.message;
  const id = `f_${f.name}`;
  if (f.type === 'bool')
    return (
      <label className="flex items-center gap-2 pt-6 text-sm">
        <input type="checkbox" {...register(f.name)} /> {f.label}
      </label>
    );
  if (f.type === 'enum')
    return (
      <div>
        <Label htmlFor={id}>{f.label} *</Label>
        <select id={id} aria-invalid={!!err} className="flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm" {...register(f.name)}>
          <option value="">— select —</option>
          {f.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <FieldError message={err} />
      </div>
    );
  const required = 'required' in f && f.required ? ' *' : '';
  const inputType = f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : f.type === 'phone' ? 'tel' : 'text';
  return (
    <TextField
      id={id}
      type={inputType}
      inputMode={f.type === 'int' ? 'numeric' : undefined}
      label={`${f.label}${required}`}
      maxLength={'max' in f && f.type !== 'int' ? f.max : undefined}
      {...register(f.name)}
      error={err}
    />
  );
}

export function StructureForm({
  kind,
  mode,
  id,
  defaults,
  parents,
  parentId,
}: {
  kind: Kind;
  mode: 'create' | 'edit';
  id?: number;
  defaults?: Record<string, unknown>;
  parents?: Option[];
  parentId?: number;
}) {
  const cfg = CONFIG[kind];
  const router = useRouter();
  const schema = buildSchema(kind, mode);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FieldValues>({
    resolver: zodResolver(schema) as unknown as Resolver<FieldValues>,
    defaultValues: { ...defaultValues(kind), ...(cfg.parent && parentId ? { [cfg.parent.column]: String(parentId) } : {}), ...(defaults ?? {}) },
  });

  async function onSubmit(values: FieldValues) {
    const payload = toPayload(kind, values, mode);
    const supabase = createClient();
    let newId: number | undefined = id;

    if (cfg.viaRpc) {
      const res = mode === 'create' ? await supabase.rpc('institution_create', { p: payload }) : await supabase.rpc('institution_update', { p_id: id, p: payload });
      if (res.error) {
        if (res.error.code === '22023') return void toast.error(res.error.message);
        return void toast.error(message(res.error, cfg.singular));
      }
      if (mode === 'create') newId = res.data as number;
    } else {
      const q = mode === 'create' ? supabase.from(cfg.table).insert(payload) : supabase.from(cfg.table).update(payload).eq(cfg.pk, id as number);
      const { data, error } = await q.select(cfg.pk);
      if (error) return void toast.error(message(error, cfg.singular));
      if (!data || data.length === 0) return void toast.error('Not found, or you are not allowed to change it.');
      newId = Number((data[0] as unknown as Record<string, number>)[cfg.pk]);
    }
    toast.success(mode === 'create' ? `${cfg.singular[0]?.toUpperCase()}${cfg.singular.slice(1)} created.` : 'Changes saved.');
    router.push(hrefFor(kind, newId));
    router.refresh();
  }

  const errs = errors as Record<string, { message?: string } | undefined>;
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      {cfg.parent && mode === 'create' && (
        <div className="sm:col-span-2">
          <SelectField
            id="f_parent"
            label={`${cfg.parent.label} *`}
            options={parents ?? []}
            emptyHint={`No ${cfg.parent.label.toLowerCase()} is available. Create one first.`}
            {...register(cfg.parent.column)}
            error={errs[cfg.parent.column]?.message}
          />
        </div>
      )}
      {cfg.fields.map((f) => (
        <Field key={f.name} f={f} register={register as never} errors={errs} />
      ))}
      <div className="flex gap-3 sm:col-span-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : mode === 'create' ? `Create ${cfg.singular}` : 'Save changes'}
        </Button>
        <Link href={mode === 'edit' ? hrefFor(kind, id) : '/structure'} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
          Cancel
        </Link>
      </div>
    </form>
  );
}
