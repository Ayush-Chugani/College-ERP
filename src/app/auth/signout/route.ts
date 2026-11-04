import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** POST only (so a cross-site GET/image cannot sign users out). 303 turns the POST into a GET on /login. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.nextUrl.origin), { status: 303 });
}
