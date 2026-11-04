import type { SupabaseClient } from '@supabase/supabase-js';
import type { HrDoc, Sensitive } from '@/features/hr-records';

export type Opt = { id: number; label: string };

/** Everything the HR records screen needs; a failure means "not allowed" and the caller shows a 404. */
export async function loadHrRecords(supabase: SupabaseClient, employeeId: number) {
  const [s, d, c, t] = await Promise.all([
    supabase.rpc('emp_sensitive_list', { p_employee_id: employeeId }),
    supabase.rpc('employee_document_list', { p_employee_id: employeeId }),
    supabase.from('employee_document_category').select('employee_document_category_id, category_name').eq('is_active', true).order('category_name'),
    supabase.from('document_type').select('document_type_id, document_name').eq('is_active', true).order('document_name'),
  ]);
  return {
    sensitive: s.error || !s.data ? null : (s.data as Sensitive),
    docs: (d.data ?? []) as HrDoc[],
    categories: ((c.data ?? []) as { employee_document_category_id: number; category_name: string }[]).map((x) => ({ id: x.employee_document_category_id, label: x.category_name })),
    types: ((t.data ?? []) as { document_type_id: number; document_name: string }[]).map((x) => ({ id: x.document_type_id, label: x.document_name })),
  };
}
