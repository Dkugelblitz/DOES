"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok?: string; error?: string };

export async function requestLevel(_: Result, form: FormData): Promise<Result> {
  const level = Number(form.get("level"));
  if (![1, 2, 3].includes(level)) return { error: "Choose a level to request." };
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_level", { p_level: level, p_note: note });
  if (error) {
    const m = error.message;
    return { error: /already|too many/.test(m) ? m.charAt(0).toUpperCase() + m.slice(1) + "." : "Couldn't send your request. Please try again." };
  }
  revalidatePath("/account");
  return { ok: "Request sent. An admin will review it, and you'll see the answer here." };
}

export async function cancelRequest(_: Result, form: FormData): Promise<Result> {
  const id = Number(form.get("request_id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_level_request", { p_request: id });
  if (error) return { error: "Couldn't cancel that request." };
  revalidatePath("/account");
  return { ok: "Request cancelled." };
}

export async function markNotificationsRead(): Promise<void> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", auth.user.id).is("read_at", null);
  revalidatePath("/", "layout");
}
