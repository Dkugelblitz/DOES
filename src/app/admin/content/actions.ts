"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Thin wrappers: the admin_save_* database functions re-check admin, validate, version and audit.
export type Saved = { ok?: string; error?: string };

const lines = (v: FormDataEntryValue | null) => String(v ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const lvl = (v: FormDataEntryValue | null) => { const n = Number(v); return [1, 2, 3].includes(n) ? n : null; };

function fail(message: string): Saved {
  if (message.includes("admin only")) return { error: "You no longer have admin access." };
  if (message.includes("check constraint")) return { error: "Core (Pareto) levels can't be below the minimum level." };
  return { error: message.length < 200 ? message.charAt(0).toUpperCase() + message.slice(1) + "." : "Couldn't save. Please check the fields." };
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  return supabase.rpc(fn, args);
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function saveTopic(_: Saved, form: FormData): Promise<Saved> {
  const id = String(form.get("id") ?? "");
  const patch = {
    ...(id ? { id } : { domain_slug: String(form.get("domain_slug") ?? "") }),
    name: String(form.get("name") ?? "").trim(),
    module_slug: String(form.get("module_slug") ?? ""),
    min_level: lvl(form.get("min_level")) ?? 1,
    pareto_levels: form.getAll("pareto").map(Number).filter((n) => [1, 2, 3].includes(n)),
    sort_order: Number(form.get("sort_order")) || undefined,
    archived: form.get("archived") === "on",
    subtopics: lines(form.get("subtopics")),
  };
  const { data, error } = await rpc("admin_save_topic", { p: patch });
  if (error) return fail(error.message);
  refresh();
  if (!id) redirect(`/admin/content/topics/${(data as { id: string }).id}`);
  return { ok: "Saved. Learners see the change straight away." };
}

export async function saveCard(_: Saved, form: FormData): Promise<Saved> {
  const id = String(form.get("id") ?? "");
  const override = lvl(form.get("min_level_override"));
  const { data, error } = await rpc("admin_save_card", { p: {
    ...(id ? { id } : {}), deck: String(form.get("deck") ?? "").trim(), question: String(form.get("question") ?? "").trim(),
    answer: String(form.get("answer") ?? "").trim(), topic_id: String(form.get("topic_id") ?? "").trim(),
    min_level_override: override, archived: form.get("archived") === "on",
  } });
  if (error) return fail(error.message);
  refresh();
  if (!id) redirect(`/admin/content/cards/${(data as { id: string }).id}`);
  return { ok: "Saved." };
}

export async function saveDesign(_: Saved, form: FormData): Promise<Saved> {
  const id = String(form.get("id") ?? "");
  const { data, error } = await rpc("admin_save_design", { p: {
    ...(id ? { id } : {}), title: String(form.get("title") ?? "").trim(), min_level: lvl(form.get("min_level")) ?? 3,
    points: lines(form.get("points")), topic_ids: lines(form.get("topic_ids")), archived: form.get("archived") === "on",
  } });
  if (error) return fail(error.message);
  refresh();
  if (!id) redirect(`/admin/content/designs/${(data as { id: string }).id}`);
  return { ok: "Saved." };
}

export async function saveDocument(_: Saved, form: FormData): Promise<Saved> {
  const key = String(form.get("key") ?? "");
  let data: unknown;
  try { data = JSON.parse(String(form.get("json") ?? "")); } catch (e) { return { error: `That isn't valid JSON: ${(e as Error).message}` }; }
  const { error } = await rpc("admin_save_document", { p_key: key, p_data: data });
  if (error) return fail(error.message);
  refresh();
  return { ok: "Saved. The new version is live." };
}

export async function restoreVersion(_: Saved, form: FormData): Promise<Saved> {
  const type = String(form.get("type") ?? ""), id = String(form.get("entity_id") ?? ""), version = Number(form.get("version"));
  if (!["topic", "card", "design", "document"].includes(type) || !id || !Number.isInteger(version)) return { error: "Invalid request." };
  const { error } = await rpc("admin_restore_version", { p_type: type, p_id: id, p_version: version });
  if (error) return fail(error.message);
  refresh();
  return { ok: `Restored version ${version} as a new version.` };
}
