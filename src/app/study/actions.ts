"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fill, pick, type Messages } from "@/lib/messages";

export type StudyState = {
  server_now: string;
  running: { id: string; started_at: string; topic_id: string | null; topic_name: string | null } | null;
  today_minutes: number;
  saved_minutes?: number;
  auto_saved_minutes?: number;
  topics_done?: number;
  error?: string;
  closing?: { summary: string; totals: string; farewell: string; xpToday: number };
};

const TOPIC_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;

async function call(fn: string, args: Record<string, unknown> = {}): Promise<StudyState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { server_now: new Date().toISOString(), running: null, today_minutes: 0, error: "Couldn't reach the server. Your time so far is safe." };
  return data as StudyState;
}

export async function startStudy(topicId: string | null): Promise<StudyState> {
  if (topicId && !TOPIC_ID.test(topicId)) topicId = null;
  return call("start_study_session", { p_topic_id: topicId });
}

export async function heartbeatStudy(): Promise<StudyState> {
  return call("heartbeat_study_session");
}

/** Pause (finish = false) or finish for the day (finish = true, adds the closing message). */
export async function stopStudy(finish = false): Promise<StudyState> {
  const r = await call("stop_study_session");
  revalidatePath("/", "layout");
  if (!finish || r.error) return r;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const [{ data: doc }, { data: game }, { data: xp }] = await Promise.all([
    supabase.from("content_documents").select("data").eq("key", "messages").single(),
    supabase.rpc("my_game"),
    supabase.from("xp_events").select("points").eq("user_id", auth.user?.id ?? "").gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
  ]);
  const m = doc?.data as Messages | undefined;
  const g = game as { stats: { topics_done: number; study_minutes: number } } | null;
  return {
    ...r,
    closing: {
      summary: r.saved_minutes ? fill(m?.closing.summary_with_minutes, { minutes: r.saved_minutes }) : (m?.closing.summary_no_minutes ?? ""),
      totals: fill(m?.closing.totals, { topics_done: g?.stats.topics_done ?? 0, hours: ((g?.stats.study_minutes ?? 0) / 60).toFixed(1) }),
      farewell: pick(m?.closing.farewells) ?? "",
      xpToday: (xp ?? []).reduce((a, x) => a + (x.points as number), 0),
    },
  };
}
