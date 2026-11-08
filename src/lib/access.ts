import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Level = 1 | 2 | 3;
export type Access = {
  user_id: string;
  is_admin: boolean;
  levels: Level[];
  active_level: Level | null;
  onboarded: boolean;
};

/** Reads the caller's access from the database (never from the JWT). Null if signed out or disabled. */
export async function getAccess(): Promise<Access | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.rpc("my_access");
  if (error || !data) return null;
  return data as Access;
}

/** For pages that need a fully onboarded user. */
export async function requireOnboarded(): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect("/sign-in");
  if (!access.onboarded) redirect("/onboarding");
  return access;
}

/** For admin pages. Checks is_admin in the database on every request. */
export async function requireAdmin(): Promise<Access> {
  const access = await requireOnboarded();
  if (!access.is_admin) redirect("/");
  return access;
}
