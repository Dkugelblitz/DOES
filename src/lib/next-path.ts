/** Only allow same-site relative paths as post-sign-in destinations (no open redirects). */
export function safeNext(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\") || s.length > 300) return "/";
  if (/[\u0000-\u001f]/.test(s)) return "/";
  return s;
}

export const NEXT_COOKIE = "deos_next";
