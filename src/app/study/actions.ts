"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type StudyState = {
  server_now: string;
  running: { id: string; started_at: string; topic_id: string | null; topic_name: string | null } | null;
  today_minutes: number;
  saved_minutes?: number;
  auto_saved_minutes?: number;
  topics_done?: number;
  error?: string;
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

export async function stopStudy(): Promise<StudyState> {
  const r = await call("stop_study_session");
  revalidatePath("/insights");
  return r;
}
