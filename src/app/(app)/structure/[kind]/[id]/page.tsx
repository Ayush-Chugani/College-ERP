import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/features/academic-forms';
import { getRow, listChildren, parseRowId } from '@/features/structure-data';
import { StructureForm } from '@/features/structure-form';
import { can } from '@/lib/context';
import { CONFIG, hrefFor, parseKind } from '@/lib/structure-config';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Details' };

export default async function StructureDetailPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind: rawKind, id: rawId } = await params;
  const kind = parseKind(rawKind);
  const id = parseRowId(rawId);
  if (!kind || id === null) notFound();
  const cfg = CONFIG[kind];
  const { supabase, ctx } = await requireContext();
  const row = await getRow(supabase, kind, id);
  if (!row) notFound(); // missing or not visible: same response

  const children = await listChildren(supabase, kind, id);
  const parentRow = cfg.parent ? await getRow(supabase, cfg.parent.kind, Number(row[cfg.parent.column])) : null;
  const childCfg = cfg.child ? CONFIG[cfg.child.kind] : null;
  const canUpdate = can(ctx, cfg.perms.update);
  const canDelete = !!cfg.perms.delete && can(ctx, cfg.perms.delete);
  const canAddChild = !!childCfg && can(ctx, childCfg.perms.create);

  const defaults: Record<string, unknown> = {};
  for (const f of cfg.fields) {
    const v = row[f.name];
    defaults[f.name] = f.type === 'bool' ? Boolean(v) : v == null ? '' : String(v);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{String(row[cfg.labelColumn])}</h1>
          <p className="text-sm text-muted-foreground">
            {cfg.singular} · {String(row[cfg.codeColumn])}
            {parentRow && cfg.parent ? (
              <>
                {' '}
                · {cfg.parent.label.toLowerCase()}{' '}
                <Link href={hrefFor(cfg.parent.kind, Number(parentRow[CONFIG[cfg.parent.kind].pk]))} className="text-primary underline-offset-4 hover:underline">
                  {String(parentRow[CONFIG[cfg.parent.kind].labelColumn])}
                </Link>
              </>
            ) : null}
            {!row.is_active ? ' · inactive' : ''}
          </p>
        </div>
        <Link href="/structure" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
          Back to structure
        </Link>
      </div>

      {childCfg && (
        <Card>
          <CardHeader>
            <CardTitle>{childCfg.plural}</CardTitle>
          </CardHeader>
          <CardContent>
            {children.length === 0 ? (
              <p className="text-sm text-muted-foreground">No {childCfg.plural.toLowerCase()} yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {children.map((c) => (
                  <li key={Number(c[childCfg.pk])}>
                    <Link href={hrefFor(childCfg.kind, Number(c[childCfg.pk]))} className="text-primary underline-offset-4 hover:underline">
                      {String(c[childCfg.labelColumn])}
                    </Link>{' '}
                    <span className="text-muted-foreground">({String(c[childCfg.codeColumn])})</span>
                    {!c.is_active && <span className="ml-2 text-xs text-muted-foreground">inactive</span>}
                  </li>
                ))}
              </ul>
            )}
            {canAddChild && (
              <Link href={`${hrefFor(childCfg.kind)}/new?parent=${id}`} className="mt-3 inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
                Add {cfg.child?.label}
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{canUpdate ? 'Edit details' : 'Details'}</CardTitle>
        </CardHeader>
        <CardContent>
          {canUpdate ? (
            <StructureForm kind={kind} mode="edit" id={id} defaults={defaults} />
          ) : (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
              {cfg.fields.map((f) => (
                <div key={f.name} className="contents">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd>{f.type === 'bool' ? (row[f.name] ? 'Yes' : 'No') : row[f.name] == null || row[f.name] === '' ? '—' : String(row[f.name])}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      {canDelete && cfg.table !== 'institution' && (
        <Card>
          <CardHeader>
            <CardTitle>Delete {cfg.singular}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Refused while anything is attached to it. Otherwise untick “Active” to deactivate it.</p>
            <DeleteButton table={cfg.table as 'university' | 'campus' | 'department' | 'programme'} id={id} label={cfg.singular} redirectTo="/structure" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
