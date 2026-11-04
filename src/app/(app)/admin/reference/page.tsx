import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Reference data' };
type T = { tbl: string; label: string; module_code: string };
const GROUPS: Record<string, string> = { PLATFORM: 'Platform', EMPLOYEE: 'Employees', STAFF_PROFILE: 'Staff profile and research', FEES: 'Fees' };

export default async function ReferencePage() {
  const { supabase } = await requireContext();
  const { data } = await supabase.rpc('ref_list');
  const tables = (data ?? []) as T[];
  if (tables.length === 0) notFound();
  return (
    <div className="max-w-4xl space-y-4">
      <div><h1 className="text-xl font-semibold">Reference data</h1><p className="text-sm text-muted-foreground">Lists used by forms across the system. Rows that are in use cannot be deleted.</p></div>
      {Object.keys(GROUPS).map((g) => {
        const list = tables.filter((t) => t.module_code === g);
        if (list.length === 0) return null;
        return (
          <Card key={g}>
            <CardHeader><CardTitle>{GROUPS[g]}</CardTitle></CardHeader>
            <CardContent><ul className="grid gap-1 sm:grid-cols-2">{list.map((t) => <li key={t.tbl}><Link href={`/admin/reference/${t.tbl}`} className="text-sm text-primary underline-offset-4 hover:underline">{t.label}</Link></li>)}</ul></CardContent>
          </Card>
        );
      })}
    </div>
  );
}
