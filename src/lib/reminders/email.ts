// Builds the daily revision reminder. Pure, no imports: used by the scheduled job and tests.
// Tone: warm and specific, never guilt-inducing (no "you missed", no shaming about overdue).

export type DueTopic = { topic_id: string; name: string; days: number; state: "due" | "overdue" };
export type ReminderInput = { name: string | null; dueCount: number; topics: DueTopic[]; siteUrl: string; unsubscribeUrl: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildReminder(r: ReminderInput): { subject: string; text: string; html: string } {
  const first = r.name?.trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first},` : "Hi,";
  const n = r.dueCount;
  const subject = n === 1 ? `1 topic is ready for a quick review` : `${n} topics are ready for a quick review`;
  const lead = n === 1
    ? "One topic you finished is ready for a quick review. A few minutes now locks it in for the interview."
    : `${n} topics you finished are ready for a quick review. A few minutes on each locks them in for the interview.`;
  const more = n > r.topics.length ? `…and ${n - r.topics.length} more on your home page.` : "";
  const ago = (d: number) => (d === 1 ? "1 day ago" : `${d} days ago`);
  const home = r.siteUrl.replace(/\/+$/, "");

  const text = [
    hi, "", lead, "",
    ...r.topics.map((t) => `• ${t.name} (last reviewed ${ago(t.days)})`),
    ...(more ? [more] : []), "",
    `Open DEOS: ${home}/`, "",
    "You're building real depth, one review at a time.", "",
    `Don't want these emails? Turn them off: ${r.unsubscribeUrl}`,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f5f1;font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d1d1b">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e3e1da;border-radius:12px;padding:24px">
<p style="margin:0 0 12px">${esc(hi)}</p>
<p style="margin:0 0 12px">${esc(lead)}</p>
<ul style="padding-left:20px;margin:0 0 12px">${r.topics.map((t) => `<li><a href="${esc(`${home}/topics/${t.topic_id}`)}" style="color:#c24e24">${esc(t.name)}</a> <span style="color:#5f5e58">· last reviewed ${esc(ago(t.days))}</span></li>`).join("")}</ul>
${more ? `<p style="margin:0 0 12px;color:#5f5e58">${esc(more)}</p>` : ""}
<p style="margin:16px 0"><a href="${esc(`${home}/`)}" style="display:inline-block;background:#c24e24;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600">Open my revision list</a></p>
<p style="margin:0;color:#5f5e58">You're building real depth, one review at a time.</p>
</div>
<p style="max-width:520px;margin:12px auto 0;font-size:13px;color:#5f5e58;text-align:center">You get this because email reminders are on in DEOS. <a href="${esc(r.unsubscribeUrl)}" style="color:#5f5e58">Turn them off</a>.</p>
</body></html>`;
  return { subject, text, html };
}
