import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';

/**
 * Service-role client. SERVER ONLY: the key bypasses row-level security. It is read from SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix, so
 * Next.js never ships it to the browser) and may only be used after the caller has been authorised with their own session.
 */
export function serviceRoleConfigured(): boolean {
  return typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' && process.env.SUPABASE_SERVICE_ROLE_KEY.length > 20;
}

export function createAdminClient(): SupabaseClient {
  if (typeof window !== 'undefined') throw new Error('The service-role client must never be created in the browser');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
