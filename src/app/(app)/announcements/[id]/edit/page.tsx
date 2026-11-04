import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDetail, loadEditorLookups, parseAnnId } from '@/features/communication-data';
import { AnnouncementForm } from '@/features/communication-forms';
import { toLocalInput } from '@/lib/communication-validation';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Edit announcement' };

export default async function EditAnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseAnnId((await params).id);
  if (id === null) notFound();
  const { supabase } = await requireContext();
  const a = await getDetail(supabase, id);
  if (!a || !a.can_edit) notFound();
  const l = await loadEditorLookups(supabase);
  // keep the current department selectable even if the editor could not otherwise post there
  const departments = a.department_id !== null && !l.departments.some((d) => d.id === a.department_id) && a.department_name ? [...l.departments, { id: a.department_id, label: a.department_name }] : l.departments;
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Edit announcement</h1>
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <AnnouncementForm
            id={id}
            types={l.types}
            departments={departments}
            canPostGlobal={l.canPostGlobal || a.department_id === null}
            defaults={{
              announcement_type_id: String(a.type_id), department_id: a.department_id === null ? '' : String(a.department_id), title: a.title, description: a.description,
              publish_from: toLocalInput(a.publish_from), publish_to: a.publish_to ? toLocalInput(a.publish_to) : '', audience_type: a.audience_type as 'ALL',
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
