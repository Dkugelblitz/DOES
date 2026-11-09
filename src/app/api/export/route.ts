import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// "Download my data": everything the signed-in user owns, as JSON. Uses the user's own client,
// so RLS guarantees it only ever contains their rows. Files are listed (not embedded).
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const uid = auth.user.id;
  const own = (t: string, cols = "*") => supabase.from(t).select(cols).eq("user_id", uid);
  const [profile, grants, progress, subs, notes, links, files, bookmarks, sessions, sprint, cards, requests] = await Promise.all([
    supabase.from("profiles").select("email, display_name, timezone, hours_per_topic, hours_per_day, interview_date, created_at").eq("id", uid).single(),
    own("level_grants", "level, granted_at, expires_at, revoked_at, source"),
    own("topic_progress", "topic_id, status, done_at, first_done_at, last_revised_at"),
    own("subtopic_progress", "subtopic_id, done"),
    own("notes", "topic_id, body_md, updated_at"),
    own("links", "topic_id, kind, title, url, excerpt, created_at"),
    own("attachments", "topic_id, original_name, mime_type, bytes, created_at"),
    own("bookmarks", "topic_id, created_at"),
    own("study_sessions", "topic_id, started_at, ended_at, minutes, status"),
    own("sprint_progress", "item_id, done"),
    own("card_mastery", "card_id, mastered"),
    own("level_requests", "requested_level, status, note, created_at, decided_at, decision_note"),
  ]);
  const body = {
    exported_at: new Date().toISOString(), format: "deos-export-v1",
    profile: profile.data, level_grants: grants.data, topic_progress: progress.data, subtopic_progress: subs.data,
    notes: notes.data, links: links.data, attachments: files.data, bookmarks: bookmarks.data, study_sessions: sessions.data,
    sprint_progress: sprint.data, card_mastery: cards.data, level_requests: requests.data,
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="deos-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
