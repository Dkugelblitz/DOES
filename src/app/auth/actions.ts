"use server";
import { redirect } from "next/navigation";
import { createClient, runAdminBootstrap } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/origin";

export type AuthState = { error?: string; info?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readCredentials(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!EMAIL.test(email)) return { error: "Enter a valid email address." } as const;
  if (password.length < 8) return { error: "Passwords need at least 8 characters." } as const;
  return { email, password } as const;
}

export async function signInWithPassword(_: AuthState, form: FormData): Promise<AuthState> {
  const c = readCredentials(form);
  if ("error" in c) return { error: c.error };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(c);
  // Same message for unknown email and wrong password, so accounts can't be enumerated.
  if (error) return { error: error.message.includes("Email not confirmed")
    ? "Please confirm your email first. Check your inbox for the link."
    : "That email and password don't match." };
  await runAdminBootstrap();
  redirect("/");
}

export async function signUpWithPassword(_: AuthState, form: FormData): Promise<AuthState> {
  const c = readCredentials(form);
  if ("error" in c) return { error: c.error };
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...c,
    options: { emailRedirectTo: `${await requestOrigin()}/auth/confirm` },
  });
  if (error) return { error: error.message.includes("rate limit")
    ? "Too many attempts. Please wait a few minutes and try again."
    : "We couldn't create that account. Try a different email or sign in." };
  return { info: "Check your inbox to confirm your email, then sign in." };
}

export async function signInWithGoogle(): Promise<void> {
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
