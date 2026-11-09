"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { celebrate } from "@/lib/celebrate";

const TOPIC_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;

export async function markRevised(topicId: string): Promise<{ ok: boolean; wasDue?: boolean; error?: string; celebrate?: string[] }> {
  if (!TOPIC_ID.test(topicId)) return { ok: false, error: "Invalid topic." };
  const supabase = await createClient();
  const before = (await supabase.rpc("my_game")).data as { xp: number; badges: { id: string; earned_at: string | null }[] } | null;
  const { data, error } = await supabase.rpc("mark_revised", { p_topic_id: topicId });
  if (error) return { ok: false, error: error.message.includes("done before") ? "Mark the topic done first." : "Couldn't save that. Please try again." };
  revalidatePath("/", "layout");
  const after = (await supabase.rpc("my_game")).data as { xp: number; badges: { id: string; name: string; icon: string; earned_at: string | null }[] } | null;
  const had = new Set(before?.badges.filter((b) => b.earned_at).map((b) => b.id));
  const delta = before && after ? { xp_before: before.xp, xp_after: after.xp, new_badges: after.badges.filter((b) => b.earned_at && !had.has(b.id)) } : undefined;
  return { ok: true, wasDue: (data as { was_due: boolean }).was_due, celebrate: await celebrate(delta, { lead: "Revised, nicely done." }) };
}

export async function setBookmark(topicId: string, on: boolean): Promise<{ ok: boolean }> {
  if (!TOPIC_ID.test(topicId)) return { ok: false };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false };
  const { error } = on
    ? await supabase.from("bookmarks").insert({ user_id: auth.user.id, topic_id: topicId })
    : await supabase.from("bookmarks").delete().eq("user_id", auth.user.id).eq("topic_id", topicId);
  if (error && !error.message.includes("duplicate")) return { ok: false };
  revalidatePath("/", "layout");
  return { ok: true };
}

export type ToggleResult = { ok?: string; error?: string };

export async function setEmailReminders(_: ToggleResult, form: FormData): Promise<ToggleResult> {
  const on = form.get("on") === "true";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Please sign in again." };
  const { error } = await supabase.from("profiles").update({ email_reminders: on }).eq("id", auth.user.id);
  if (error) return { error: "Couldn't change that setting." };
  revalidatePath("/account");
  return { ok: on ? "Email reminders are on." : "Email reminders are off." };
}
