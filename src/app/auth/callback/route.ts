import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/security/redirect";
import { createClient } from "@/lib/supabase/server";

/** OAuth + email-confirmation landing: exchanges the PKCE code for a session. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That sign-in link is invalid or has expired.")}`);
}
