import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadHrRecords } from '@/features/hr-data';
import { CompetenciesPanel, type Competency } from '@/features/hr-extras';
import { HrDocuments, IdentityPanel } from '@/features/hr-records';
import { can, type SimsContext } from '@/lib/context';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Shared body of /my-hr and /employees/[id]/hr. Returns null when the caller may see neither part. */
export async function HrView({ supabase, ctx, employeeId }: { supabase: SupabaseClient; ctx: SimsContext; employeeId: number }) {
  const r = await loadHrRecords(supabase, employeeId);
  const isOwner = ctx.employee_id === employeeId;
  const [comp, courses] = await Promise.all([
    supabase.rpc('emp_competency_list', { p_employee_id: employeeId }),
    can(ctx, 'EMPLOYEE.ALL.CREATE') ? supabase.from('course_catalog').select('course_id, course_code, course_title').order('course_code').limit(1000) : Promise.resolve({ data: [] }),
  ]);
  const c = (comp.data ?? { rows: [], can_edit: false, can_delete: false }) as { rows: Competency[]; can_edit: boolean; can_delete: boolean };
  if (!r.sensitive && r.docs.length === 0 && !isOwner && !can(ctx, 'EMPLOYEE.EMPLOYEE_DOCUMENT.READ')) return null;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Identity numbers and bank accounts</CardTitle></CardHeader>
        <CardContent>
          {r.sensitive ? <IdentityPanel employeeId={employeeId} data={r.sensitive} /> : <p className="text-sm text-muted-foreground">You are not allowed to see these records.</p>}
          <p className="mt-4 text-xs text-muted-foreground">Numbers are stored encrypted and shown masked. Showing a full number needs a purpose and is logged.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Courses this person can teach</CardTitle></CardHeader>
        <CardContent><CompetenciesPanel employeeId={employeeId} rows={c.rows} canEdit={c.can_edit} canDelete={c.can_delete} courses={((courses.data ?? []) as { course_id: number; course_code: string; course_title: string }[]).map((x) => ({ id: x.course_id, label: `${x.course_code} — ${x.course_title}` }))} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>HR documents</CardTitle></CardHeader>
        <CardContent>
          <HrDocuments employeeId={employeeId} docs={r.docs} categories={r.categories} types={r.types} ownerId={ctx.employee_id}
            canReview={can(ctx, 'EMPLOYEE.EMPLOYEE_DOCUMENT.VERIFY')} canDelete={can(ctx, 'EMPLOYEE.EMPLOYEE_DOCUMENT.DELETE')} canUpload={isOwner || can(ctx, 'EMPLOYEE.EMPLOYEE_DOCUMENT.CREATE')} canShare={can(ctx, 'EMPLOYEE.EMPLOYEE_DOCUMENT.UPDATE')} />
        </CardContent>
      </Card>
    </div>
  );
}
