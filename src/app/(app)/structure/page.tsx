import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { loadTree, type Row } from '@/features/structure-data';
import { can } from '@/lib/context';
import { CONFIG, hrefFor, type Kind } from '@/lib/structure-config';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Institution structure' };

const btn = 'inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90';

function group(rows: Row[], column: string) {
  const m = new Map<number, Row[]>();
  for (const r of rows) {
    const k = Number(r[column]);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}

function Item({ kind, row, children }: { kind: Kind; row: Row; children?: React.ReactNode }) {
  const c = CONFIG[kind];
  return (
    <li className="py-1">
      <Link href={hrefFor(kind, Number(row[c.pk]))} className="text-primary underline-offset-4 hover:underline">
        {String(row[c.labelColumn])}
      </Link>{' '}
      <span className="text-muted-foreground">({String(row[c.codeColumn])})</span>
      {!row.is_active && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">inactive</span>}
      {children}
    </li>
  );
}

export default async function StructurePage() {
  const { supabase, ctx } = await requireContext();
  if (!ctx.readable_modules.includes('INSTITUTION')) notFound();
  const t = await loadTree(supabase);
  const inst = group(t.institutions, 'university_id');
  const camp = group(t.campuses, 'institution_id');
  const dept = group(t.departments, 'campus_id');
  const prog = group(t.programmes, 'department_id');
  const empty = t.universities.length + t.institutions.length === 0;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Institution structure</h1>
          <p className="text-sm text-muted-foreground">University → institution → campus → department → programme. Everyone signed in can see the directory; changes are limited by your scope.</p>
        </div>
        <div className="flex gap-2">
          {can(ctx, CONFIG.universities.perms.create) && (
            <Link href="/structure/universities/new" className={btn}>
              New university
            </Link>
          )}
          {can(ctx, CONFIG.institutions.perms.create) && (
            <Link href="/structure/institutions/new" className={btn}>
              New institution
            </Link>
          )}
        </div>
      </div>

      <Card className="p-5 text-sm">
        {empty ? (
          <p className="text-muted-foreground">Nothing has been set up yet. A global administrator creates the university and institution first.</p>
        ) : (
          <ul>
            {t.universities.map((u) => (
              <Item key={`u${u.university_id}`} kind="universities" row={u}>
                <ul className="ml-5 border-l border-border pl-4">
                  {(inst.get(Number(u.university_id)) ?? []).map((i) => (
                    <Item key={`i${i.institution_id}`} kind="institutions" row={i}>
                      <ul className="ml-5 border-l border-border pl-4">
                        {(camp.get(Number(i.institution_id)) ?? []).map((c) => (
                          <Item key={`c${c.campus_id}`} kind="campuses" row={c}>
                            <ul className="ml-5 border-l border-border pl-4">
                              {(dept.get(Number(c.campus_id)) ?? []).map((d) => (
                                <Item key={`d${d.department_id}`} kind="departments" row={d}>
                                  <ul className="ml-5 border-l border-border pl-4">
                                    {(prog.get(Number(d.department_id)) ?? []).map((p) => (
                                      <Item key={`p${p.programme_id}`} kind="programmes" row={p} />
                                    ))}
                                  </ul>
                                </Item>
                              ))}
                            </ul>
                          </Item>
                        ))}
                      </ul>
                    </Item>
                  ))}
                </ul>
              </Item>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
