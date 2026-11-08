// Centralised environment access. Public values are safe in the browser;
// server-only values must never be imported from client components.

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const publicEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: () =>
    required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  // Trailing slashes are stripped so "https://x.netlify.app/" doesn't produce "//auth/callback".
  siteUrl: () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").trim().replace(/\/+$/, ""),
};

/** Parse ADMIN_EMAILS ("a@x.com, b@y.com") into a normalised list. */
export function parseAdminEmails(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
}
