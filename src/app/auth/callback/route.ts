import { NextResponse, type NextRequest } from "next/server";
import { createClient, runAdminBootstrap } from "@/lib/supabase/server";

// OAuth (Google) return URL: exchange the PKCE code for a session, then bootstrap admins.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await runAdminBootstrap();
      return NextResponse.redirect(new URL("/", url.origin));
    }
  }
  return NextResponse.redirect(new URL("/sign-in?error=callback", url.origin));
}
