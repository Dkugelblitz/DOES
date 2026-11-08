"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client (publishable key only; RLS protects all data). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
