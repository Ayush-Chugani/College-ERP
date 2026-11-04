import type { SupabaseClient } from '@supabase/supabase-js';
import { CONFIG, type Kind } from '@/lib/structure-config';

export type Row = Record<string, string | number | boolean | null> & { is_active: boolean };

export type Tree = {
  universities: Row[];
  institutions: Row[];
  campuses: Row[];
  departments: Row[];
  programmes: Row[];
};

const LIMIT = 1000;

/** Everything visible to the caller (the directory is readable by every active user; writes are scope-checked). */
export async function loadTree(supabase: SupabaseClient): Promise<Tree> {
  const get = async (kind: Kind): Promise<Row[]> => {
    const c = CONFIG[kind];
    const { data } = await supabase.from(c.table).select('*').order(c.labelColumn).limit(LIMIT);
    return (data ?? []) as Row[];
  };
  const [universities, institutions, campuses, departments, programmes] = await Promise.all(
    (['universities', 'institutions', 'campuses', 'departments', 'programmes'] as Kind[]).map(get),
  );
  return { universities: universities ?? [], institutions: institutions ?? [], campuses: campuses ?? [], departments: departments ?? [], programmes: programmes ?? [] };
}

export async function getRow(supabase: SupabaseClient, kind: Kind, id: number): Promise<Row | null> {
  const c = CONFIG[kind];
  const { data } = await supabase.from(c.table).select('*').eq(c.pk, id).maybeSingle();
  return (data as Row | null) ?? null;
}

export async function listChildren(supabase: SupabaseClient, kind: Kind, parentId: number): Promise<Row[]> {
  const parent = CONFIG[kind];
  const child = parent.child ? CONFIG[parent.child.kind] : null;
  if (!child || !child.parent) return [];
  const { data } = await supabase.from(child.table).select('*').eq(child.parent.column, parentId).order(child.labelColumn).limit(LIMIT);
  return (data ?? []) as Row[];
}

export async function parentOptions(supabase: SupabaseClient, kind: Kind): Promise<{ id: number; label: string }[]> {
  const parent = CONFIG[kind].parent;
  if (!parent) return [];
  const pc = CONFIG[parent.kind];
  const { data } = await supabase.from(pc.table).select(`${pc.pk}, ${pc.labelColumn}`).order(pc.labelColumn).limit(LIMIT);
  return ((data ?? []) as unknown as Record<string, string | number>[]).map((r) => ({ id: Number(r[pc.pk]), label: String(r[pc.labelColumn]) }));
}

export function parseRowId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
