import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv, parseAdminEmails } from "@/lib/env";

/** Supabase client acting as the signed-in user (RLS applies). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl(), publicEnv.supabasePublishableKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session cookies instead.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS, so it is used only for narrowly scoped server tasks
 * (the ADMIN_EMAILS bootstrap and scheduled jobs). Never import this from client code.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("Missing SUPABASE_SECRET_KEY. See .env.example.");
  return createSupabaseClient(publicEnv.supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Promote any verified user whose email is in ADMIN_EMAILS. Safe to call on every sign-in. */
export async function runAdminBootstrap(): Promise<void> {
  const emails = parseAdminEmails(process.env.ADMIN_EMAILS);
  if (!emails.length) return;
  const { error } = await createServiceClient().rpc("bootstrap_admins", { p_emails: emails });
  if (error) console.error("ADMIN_EMAILS bootstrap failed:", error.message);
}
