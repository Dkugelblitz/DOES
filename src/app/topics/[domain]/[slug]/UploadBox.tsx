"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { finishUpload, prepareUpload } from "@/app/material/actions";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const BUCKET = "attachments";

/** Resize an image in the browser (keeps the free storage tier lean). Null if it can't be decoded. */
async function shrink(file: Blob, maxPx: number, quality: number): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); // flatten transparency for JPEG
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", quality));
  } catch {
    return null;
  }
}

export function UploadBox({ topicId, usedBytes, quotaBytes }: { topicId: string; usedBytes: number; quotaBytes: number }) {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<{ name: string; text: string; ok: boolean }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const say = (name: string, text: string, ok: boolean) => setLines((l) => [...l.filter((x) => x.name !== name), { name, text, ok }]);

  const handle = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setLines([]);
    const supabase = createClient();
    for (const f of Array.from(files).slice(0, 10)) {
      say(f.name, "Preparing…", true);
      let body: Blob = f, mime = f.type || "application/octet-stream", thumb: Blob | null = null;
      if (["image/jpeg", "image/png", "image/webp"].includes(mime)) {
        const small = await shrink(f, 1600, 0.85);
        if (small && small.size < f.size) { body = small; mime = "image/jpeg"; }
        thumb = await shrink(f, 320, 0.75);
      }
      const prep = await prepareUpload({ topicId, mime, bytes: body.size, withThumb: !!thumb });
      if ("error" in prep) { say(f.name, prep.error, false); continue; }
      say(f.name, "Uploading…", true);
      const up = await supabase.storage.from(BUCKET).uploadToSignedUrl(prep.path, prep.token, body, { contentType: mime });
      if (up.error) { say(f.name, "Upload failed. Check your connection and try again.", false); continue; }
      if (thumb && prep.thumbPath && prep.thumbToken)
        await supabase.storage.from(BUCKET).uploadToSignedUrl(prep.thumbPath, prep.thumbToken, thumb, { contentType: "image/jpeg" });
      const done = await finishUpload({ topicId, path: prep.path, thumbPath: thumb ? prep.thumbPath : undefined, mime, name: f.name });
      say(f.name, done.error ?? "Uploaded ✓", !done.error);
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  };

  const mb = (b: number) => (b / 1048576).toFixed(1);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="upload">
        <span>{busy ? "Uploading…" : "Add photos or PDFs"}</span>
        <span className="muted" style={{ fontWeight: 400 }}>Photos up to 5 MB (shrunk automatically), PDFs up to 10 MB. You can use your phone camera.</span>
        <input ref={input} type="file" accept={ACCEPT} multiple disabled={busy} onChange={(e) => handle(e.target.files)} />
      </label>
      <div className="muted" style={{ fontSize: "0.85rem" }}>Using {mb(usedBytes)} MB of {mb(quotaBytes)} MB.</div>
      <ul className="mini" aria-live="polite">
        {lines.map((l) => <li key={l.name}><span>{l.name}</span><span className={l.ok ? "muted" : "error"}>{l.text}</span></li>)}
      </ul>
    </div>
  );
}
