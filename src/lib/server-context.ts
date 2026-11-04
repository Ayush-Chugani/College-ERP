import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { parseContext } from '@/lib/context';

/** Authenticated + provisioned user or redirect. Uses getUser() (server-validated), then the DB-side identity mapping. */
export async function requireContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data, error } = await supabase.rpc('my_context');
  const ctx = error ? null : parseContext(data);
  if (!ctx) {
    // The database withholds the identity of a password-only session when the account has an authenticator: ask for the code instead of showing "no access".
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') redirect('/mfa');
    redirect('/no-access');
  }
  return { supabase, authUser: user, ctx };
}
