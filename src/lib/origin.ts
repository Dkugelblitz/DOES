import "server-only";
import { headers } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * The origin the user is actually on (e.g. https://deosin.netlify.app or http://localhost:3000),
 * so auth redirects come back to the same site that set the sign-in cookie.
 * Supabase only redirects to URLs on its Redirect URLs allow-list, so a forged Host header
 * can't send users elsewhere. Falls back to NEXT_PUBLIC_SITE_URL.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
    const proto = (h.get("x-forwarded-proto") ?? (local ? "http" : "https")).split(",")[0].trim();
    return `${proto === "http" ? "http" : "https"}://${host}`;
  }
  return publicEnv.siteUrl();
}
