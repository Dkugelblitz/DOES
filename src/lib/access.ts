import "server-only";
import { forbidden, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Level = 1 | 2 | 3;
export type Access = {
  user_id: string;
  is_admin: boolean;
  levels: Level[];
  active_level: Level | null;
  onboarded: boolean;
};

/**
 * Reads the caller's access from the database (never from the JWT).
 * `user` is set when signed in; `access` is null when signed out or the account is disabled.
 */
export async function getSession(): Promise<{ user: { id: string; email?: string } | null; access: Access | null }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { user: null, access: null };
  const { data, error } = await supabase.rpc("my_access");
  return { user: { id: auth.user.id, email: auth.user.email }, access: error || !data ? null : (data as Access) };
}

export async function getAccess(): Promise<Access | null> {
  return (await getSession()).access;
}

/** For pages that need a fully onboarded, enabled user. */
export async function requireOnboarded(): Promise<Access> {
  const { user, access } = await getSession();
  if (!user) redirect("/sign-in");
  if (!access) redirect("/disabled");
  if (!access.onboarded) redirect("/onboarding");
  return access;
}

/** For admin pages: 403 unless is_admin is true in the database on this request. */
export async function requireAdmin(): Promise<Access> {
  const access = await requireOnboarded();
  if (!access.is_admin) forbidden();
  return access;
}
