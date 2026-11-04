import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** POST only (so a cross-site GET/image cannot sign users out). 303 turns the POST into a GET on /login. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  try {
    await supabase.rpc('auth_logout_record'); // best effort: signing out must never fail because the audit write did
  } catch {
    /* ignore */
  }
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.nextUrl.origin), { status: 303 });
}
