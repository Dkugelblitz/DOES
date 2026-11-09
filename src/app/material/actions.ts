"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { BUCKET, DEFAULT_UPLOADS, EXT, type UploadSettings } from "@/lib/storage";

const TOPIC_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const topicPath = (id: string) => `/topics/${id}`;

async function me() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, uid: data.user?.id ?? null };
}

async function uploadSettings(supabase: Awaited<ReturnType<typeof createClient>>): Promise<UploadSettings> {
  const { data } = await supabase.from("content_documents").select("data").eq("key", "settings").single();
  return { ...DEFAULT_UPLOADS, ...(data?.data?.uploads ?? {}) };
}

// ---------------------------------------------------------------- notes
export async function saveNote(topicId: string, body: string): Promise<{ ok: boolean; error?: string; savedAt?: string }> {
  if (!TOPIC_ID.test(topicId)) return { ok: false, error: "Invalid topic." };
  if (body.length > 100_000) return { ok: false, error: "Notes can be up to 100,000 characters." };
  const { supabase } = await me();
  const { data, error } = await supabase.rpc("save_note", { p_topic_id: topicId, p_body: body });
  if (error) return { ok: false, error: error.message.includes("too often") ? "Saving too often. Wait a moment." : "Couldn't save your note. Your text is still here; try again." };
  return { ok: true, savedAt: (data as { saved_at: string }).saved_at };
}

// ---------------------------------------------------------------- links
export type FormResult = { ok?: string; error?: string };

export async function addLink(_: FormResult, form: FormData): Promise<FormResult> {
  const topicId = String(form.get("topic_id") ?? "");
  const kind = String(form.get("kind") ?? "Link");
  const title = String(form.get("title") ?? "").trim().slice(0, 300) || null;
  const url = String(form.get("url") ?? "").trim() || null;
  const excerpt = String(form.get("excerpt") ?? "").trim().slice(0, 20_000) || null;
  if (!TOPIC_ID.test(topicId) || !["Link", "Article", "Video", "Doc"].includes(kind)) return { error: "Invalid request." };
  if (!title && !url && !excerpt) return { error: "Add a title, a URL or an excerpt." };
  if (url && (!/^https?:\/\//i.test(url) || url.length > 2000)) return { error: "Links must start with http:// or https://" };
  const { supabase, uid } = await me();
  if (!uid) return { error: "Please sign in again." };
  const { error } = await supabase.from("links").insert({ user_id: uid, topic_id: topicId, kind, title, url, excerpt });
  if (error) return { error: "Couldn't save that link." };
  revalidatePath(topicPath(topicId));
  return { ok: "Saved." };
}

export async function deleteLink(_: FormResult, form: FormData): Promise<FormResult> {
  const id = String(form.get("id") ?? ""), topicId = String(form.get("topic_id") ?? "");
  if (!UUID.test(id)) return { error: "Invalid request." };
  const { supabase } = await me();
  const { error } = await supabase.from("links").delete().eq("id", id);
  if (error) return { error: "Couldn't remove that link." };
  if (TOPIC_ID.test(topicId)) revalidatePath(topicPath(topicId));
  return { ok: "Removed." };
}

// ---------------------------------------------------------------- sharing
export async function setShared(_: FormResult, form: FormData): Promise<FormResult> {
  const topicId = String(form.get("topic_id") ?? ""), on = form.get("shared") === "true";
  if (!TOPIC_ID.test(topicId)) return { error: "Invalid request." };
  const { supabase, uid } = await me();
  if (!uid) return { error: "Please sign in again." };
  const { error } = on
    ? await supabase.from("topic_shares").insert({ user_id: uid, topic_id: topicId })
    : await supabase.from("topic_shares").delete().eq("user_id", uid).eq("topic_id", topicId);
  if (error && !error.message.includes("duplicate")) return { error: "Couldn't change sharing." };
  revalidatePath(topicPath(topicId));
  return { ok: on ? "Shared with admins." : "No longer shared." };
}

// ---------------------------------------------------------------- uploads
// 1) prepareUpload checks the topic, type, size and quota, then issues one-time signed upload URLs.
// 2) The browser uploads straight to storage with those URLs (no storage policies for users).
// 3) finishUpload checks what actually landed in storage and records the attachment row; the
//    database trigger re-checks type, size and quota. Anything rejected is deleted again.
export type Prepared = { path: string; token: string; thumbPath?: string; thumbToken?: string } | { error: string };

export async function prepareUpload(input: { topicId: string; mime: string; bytes: number; withThumb: boolean }): Promise<Prepared> {
  const { topicId, mime, bytes, withThumb } = input;
  if (!TOPIC_ID.test(topicId)) return { error: "Invalid topic." };
  const { supabase, uid } = await me();
  if (!uid) return { error: "Please sign in again." };
  const { data: topic } = await supabase.from("topics").select("id").eq("id", topicId).maybeSingle();
  if (!topic) return { error: "This topic isn't available to you." };
  const s = await uploadSettings(supabase);
  if (!s.allowed_types.includes(mime)) return { error: "Only photos (JPEG, PNG, WebP, HEIC) and PDFs can be uploaded." };
  const limit = mime === "application/pdf" ? s.max_pdf_bytes : s.max_image_bytes;
  if (!(bytes > 0) || bytes > limit) return { error: `That file is too big. The limit is ${Math.round(limit / 1048576)} MB.` };
  const { data: used } = await supabase.from("attachments").select("bytes").eq("user_id", uid);
  const total = (used ?? []).reduce((a, r) => a + (r.bytes as number), 0);
  if (total + bytes > s.per_user_quota_bytes) return { error: `You've used ${(total / 1048576).toFixed(1)} MB of your ${Math.round(s.per_user_quota_bytes / 1048576)} MB. Remove some files first.` };

  const id = randomUUID(), store = createServiceClient().storage.from(BUCKET);
  const path = `${uid}/${id}.${EXT[mime]}`;
  const main = await store.createSignedUploadUrl(path);
  if (main.error || !main.data) return { error: "Uploads aren't available right now. Please try again later." };
  if (!withThumb || !mime.startsWith("image/")) return { path, token: main.data.token };
  const thumbPath = `${uid}/${id}.thumb.jpg`;
  const thumb = await store.createSignedUploadUrl(thumbPath);
  return thumb.error || !thumb.data ? { path, token: main.data.token } : { path, token: main.data.token, thumbPath, thumbToken: thumb.data.token };
}

export async function finishUpload(input: { topicId: string; path: string; thumbPath?: string; mime: string; name: string }): Promise<FormResult> {
  const { topicId, path, thumbPath, mime } = input;
  const { supabase, uid } = await me();
  if (!uid) return { error: "Please sign in again." };
  const own = (p?: string) => !!p && p.startsWith(`${uid}/`) && /^[0-9a-f-]+\/[0-9a-f-]+(\.thumb)?\.[a-z]+$/.test(p);
  if (!TOPIC_ID.test(topicId) || !own(path) || (thumbPath && !own(thumbPath))) return { error: "Invalid upload." };
  const store = createServiceClient().storage.from(BUCKET);
  const file = path.slice(uid.length + 1);
  const { data: listed } = await store.list(uid, { search: file, limit: 1 });
  const obj = listed?.find((o) => o.name === file);
  const size = Number(obj?.metadata?.size ?? 0), actualType = String(obj?.metadata?.mimetype ?? mime);
  const cleanup = () => store.remove([path, ...(thumbPath ? [thumbPath] : [])]);
  if (!obj || !size) { await cleanup(); return { error: "The upload didn't finish. Please try again." }; }
  const name = input.name.replace(/[\u0000-\u001f]/g, "").slice(0, 255) || "file";
  const { error } = await supabase.from("attachments").insert({
    user_id: uid, topic_id: topicId, storage_path: path, thumb_path: thumbPath ?? null, mime_type: actualType, bytes: size, original_name: name,
  });
  if (error) {
    await cleanup();
    return { error: error.message.includes("quota") ? "You've reached your storage limit." : error.message.includes("too large") ? "That file is too big." : error.message.includes("not allowed") ? "That file type isn't allowed." : "Couldn't save that file." };
  }
  revalidatePath(topicPath(topicId));
  return { ok: "Uploaded." };
}

export async function deleteAttachment(_: FormResult, form: FormData): Promise<FormResult> {
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Invalid request." };
  const { supabase, uid } = await me();
  if (!uid) return { error: "Please sign in again." };
  // RLS: only the owner can delete; we only remove storage objects for the row actually deleted.
  const { data, error } = await supabase.from("attachments").delete().eq("id", id).eq("user_id", uid).select("storage_path, thumb_path, topic_id");
  if (error || !data?.length) return { error: "Couldn't remove that file." };
  const row = data[0];
  await createServiceClient().storage.from(BUCKET).remove([row.storage_path, ...(row.thumb_path ? [row.thumb_path] : [])]);
  revalidatePath(topicPath(row.topic_id));
  return { ok: "Removed." };
}
