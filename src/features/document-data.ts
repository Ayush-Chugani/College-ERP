import type { SupabaseClient } from '@supabase/supabase-js';

export type DocRow = {
  student_document_id: number; document_type: string; requires_verification: boolean; original_file_name: string; mime_type: string; file_size_bytes: number; document_number: string | null;
  issue_date: string | null; expiry_date: string | null; verification_status: string; effective_status: string; verified_at: string | null; remarks: string | null; uploaded_at: string;
};
export type Opt = { id: number; label: string };

export async function listDocuments(supabase: SupabaseClient, studentId: number) {
  const { data, error } = await supabase.rpc('student_document_list', { p_student_id: studentId });
  return { rows: (data ?? []) as DocRow[], error: error?.message ?? null };
}
export async function listDocumentTypes(supabase: SupabaseClient): Promise<Opt[]> {
  const { data } = await supabase.from('document_type').select('document_type_id, document_name').eq('is_active', true).order('document_name');
  return ((data ?? []) as { document_type_id: number; document_name: string }[]).map((t) => ({ id: t.document_type_id, label: t.document_name }));
}
