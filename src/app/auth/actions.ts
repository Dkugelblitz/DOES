"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient, runAdminBootstrap } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/origin";
import { NEXT_COOKIE, safeNext } from "@/lib/next-path";

// DEOS is Google sign-in only: no passwords to store, reset or leak, and no sign-up emails.
// The Email provider should also be switched off in Supabase so this holds server-side.

export async function signInWithGoogle(form: FormData): Promise<void> {
  // Remember where to return after Google, without adding query strings to the
  // redirect URL (Supabase's allow-list matches it exactly).
  const next = safeNext(form.get("next"));
  (await cookies()).set(NEXT_COOKIE, next, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 600 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await requestOrigin()}/auth/callback` },
  });
  if (error || !data.url) redirect("/sign-in?error=google");
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

/** Sign out and come back to `next` after signing in again (used before sensitive admin actions). */
export async function reauthenticate(form: FormData): Promise<void> {
  const next = safeNext(form.get("next"));
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/sign-in?reauth=1&next=${encodeURIComponent(next)}`);
}
