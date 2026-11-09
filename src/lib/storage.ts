import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

export const BUCKET = "attachments";

export type UploadSettings = {
  allowed_types: string[]; max_image_bytes: number; max_pdf_bytes: number;
  per_user_quota_bytes: number; signed_url_ttl_seconds: number;
};

export const DEFAULT_UPLOADS: UploadSettings = {
  allowed_types: ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"],
  max_image_bytes: 5 * 1024 * 1024, max_pdf_bytes: 10 * 1024 * 1024,
  per_user_quota_bytes: 25 * 1024 * 1024, signed_url_ttl_seconds: 3600,
};

export const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" };

/**
 * Short-lived signed URLs for files the caller may already read. Callers must load the
 * attachment rows with the user's own client first (RLS decides who may read them); this
 * only signs paths that came from those rows.
 */
export async function signPaths(paths: string[], ttl: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return out;
  const { data } = await createServiceClient().storage.from(BUCKET).createSignedUrls(unique, ttl);
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}
