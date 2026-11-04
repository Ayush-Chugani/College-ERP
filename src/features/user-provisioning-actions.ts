'use server';

import { createAdminClient, serviceRoleConfigured } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { parseContext } from '@/lib/context';
import { authCreateMessage, provisionSchema, type ProvisionInput, type ProvisionResult } from '@/lib/user-provisioning';

/**
 * Creates a Supabase Auth user and its SIMS account. Order matters:
 *  1. the CALLER is authorised with their own session (iam_can_provision), before the service-role key is touched;
 *  2. the Auth user is created with the admin API (email confirmed, so no mail is needed);
 *  3. the SIMS account is created and linked by a service-role-only database function;
 *  4. if step 3 fails, the Auth user from step 2 is removed again, so no half-created user is left.
 * The password is never logged, stored by SIMS or returned.
 */
export async function createUserAction(input: ProvisionInput): Promise<ProvisionResult> {
  const parsed = provisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'Your session has expired. Sign in again.' };
  const { data: ctxRaw } = await supabase.rpc('my_context');
  const ctx = parseContext(ctxRaw);
  const { data: allowed } = await supabase.rpc('iam_can_provision');
  if (!ctx || allowed !== true) return { ok: false, error: 'You are not allowed to create users.' };
  if (!serviceRoleConfigured()) return { ok: false, error: 'User creation is not configured on this server (SUPABASE_SERVICE_ROLE_KEY is missing).' };

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({ email: v.email, password: v.password, email_confirm: true });
  if (created.error || !created.data.user) return { ok: false, error: authCreateMessage(created.error?.message, created.error?.status) };
  const authId = created.data.user.id;

  const { data: userId, error } = await admin.rpc('iam_provision_user', {
    p_auth_user: authId, p_email: v.email, p_student_number: v.student_number ?? null, p_employee_number: v.employee_number ?? null, p_actor_user_id: ctx.user_id,
  });
  if (error || typeof userId !== 'number') {
    await admin.auth.admin.deleteUser(authId); // roll back the Auth user so nothing is left half-created
    const safe = error && (error.code === '22023' || error.code === '23505') ? error.message : 'The account could not be created.';
    return { ok: false, error: safe };
  }
  return { ok: true, userId, email: v.email };
}
