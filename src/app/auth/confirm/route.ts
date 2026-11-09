import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createClient, runAdminBootstrap } from "@/lib/supabase/server";
import { NEXT_COOKIE, safeNext } from "@/lib/next-path";

// Email confirmation link target. Works with either Supabase email template:
//  - the default template ({{ .ConfirmationURL }}), which arrives here with ?code=...
//  - a custom one linking to {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await createClient();

  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (token_hash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash })).error;

  if (ok) {
    await runAdminBootstrap(); // email is now verified, so ADMIN_EMAILS can apply
    const jar = await cookies();
      const next = safeNext(jar.get(NEXT_COOKIE)?.value);
      jar.delete(NEXT_COOKIE);
      return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/sign-in?error=confirm", url.origin));
}
