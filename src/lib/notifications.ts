/** Turns a stored notification into a short, friendly sentence. */
export function describeNotification(kind: string, payload: Record<string, unknown>, levelName: (n: number) => string): string {
  const lvl = typeof payload.level === "number" ? levelName(payload.level) : "a level";
  const note = typeof payload.note === "string" && payload.note.trim() ? ` Note from the admin: “${payload.note.trim()}”` : "";
  switch (kind) {
    case "request_approved": return `Good news: your request for ${lvl} was approved. It's ready on your roadmap.${note}`;
    case "request_denied": return `Your request for ${lvl} wasn't approved this time.${note}`;
    case "level_granted": return `You now have access to ${lvl}${typeof payload.expires_at === "string" ? ` until ${payload.expires_at.slice(0, 10)}` : ""}.`;
    case "level_revoked": return `Your access to ${lvl} has ended. Your progress and notes are kept, and come back if it's granted again.`;
    case "admin_granted": return "You're now an admin. The Admin tab is in the top bar.";
    case "admin_removed": return "Your admin access has been removed.";
    default: return "You have an update.";
  }
}
