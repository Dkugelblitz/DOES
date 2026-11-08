"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type StatusResult = { status: number; subtopics_done?: number; subtopics_total?: number } | { error: string };

const TOPIC_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const SUBTOPIC_ID = /^[a-z0-9-]+\/[a-z0-9-]+#[a-z0-9-]+$/;

export async function setTopicStatus(topicId: string, status: number): Promise<StatusResult> {
  if (!TOPIC_ID.test(topicId) || ![0, 1, 2].includes(status)) return { error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_topic_status", { p_topic_id: topicId, p_status: status });
  if (error) return { error: "Couldn't save that. Please try again." };
  revalidatePath("/", "layout");
  return data as StatusResult;
}

export async function setSubtopicDone(subtopicId: string, done: boolean): Promise<StatusResult> {
  if (!SUBTOPIC_ID.test(subtopicId)) return { error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_subtopic_done", { p_subtopic_id: subtopicId, p_done: done });
  if (error) return { error: "Couldn't save that. Please try again." };
  revalidatePath("/", "layout");
  return data as StatusResult;
}

export type SettingsState = { error?: string; saved?: boolean };

export async function updateStudySettings(_: SettingsState, form: FormData): Promise<SettingsState> {
  const hpt = Number(form.get("hours_per_topic"));
  const hpd = Number(form.get("hours_per_day"));
  const date = String(form.get("interview_date") ?? "").trim();
  if (!(hpt >= 0.5 && hpt <= 40)) return { error: "Hours per topic must be between 0.5 and 40." };
  if (!(hpd >= 0.5 && hpd <= 24)) return { error: "Hours per day must be between 0.5 and 24." };
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a valid interview date." };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Please sign in again." };
  const { error } = await supabase.from("profiles")
    .update({ hours_per_topic: hpt, hours_per_day: hpd, interview_date: date || null })
    .eq("id", auth.user.id);
  if (error) return { error: "Couldn't save your settings. Please try again." };
  revalidatePath("/", "layout");
  return { saved: true };
}
