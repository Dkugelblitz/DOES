/** Small, dependency-free formatting helpers shared by server pages. */

export function fmtDate(iso: string | null | undefined, timeZone = "UTC"): string {
  if (!iso) return "–";
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function fmtDateTime(iso: string | null | undefined, timeZone = "UTC"): string {
  if (!iso) return "–";
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 45) return `${Math.round(s / 86400)} days ago`;
  return `${Math.round(s / (86400 * 30))} months ago`;
}

export const LEVEL_SHORT: Record<number, string> = { 1: "DE", 2: "PDE", 3: "DA" };
