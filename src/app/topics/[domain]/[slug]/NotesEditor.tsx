"use client";
import { useEffect, useRef, useState } from "react";
import { saveNote } from "@/app/material/actions";
import { Markdown } from "@/components/Markdown";

type Status = "idle" | "dirty" | "saving" | "saved" | "error";

/** Markdown notes with Write/Preview tabs. Saves 1 second after you stop typing, and on blur. */
export function NotesEditor({ topicId, initial }: { topicId: string; initial: string }) {
  const [body, setBody] = useState(initial);
  const [tab, setTab] = useState<"write" | "preview">(initial ? "preview" : "write");
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");
  const saved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = async (text: string) => {
    if (text === saved.current) { setStatus("saved"); return; }
    setStatus("saving");
    const r = await saveNote(topicId, text);
    if (r.ok) { saved.current = text; setStatus("saved"); setMsg(""); }
    else { setStatus("error"); setMsg(r.error ?? "Couldn't save."); }
  };

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (body !== saved.current) { e.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [body]);

  const onChange = (text: string) => {
    setBody(text); setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(text), 1000);
  };

  const label = { idle: "", dirty: "Unsaved changes…", saving: "Saving…", saved: "Saved", error: msg }[status];

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" role="tablist" aria-label="Notes view">
        {(["write", "preview"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`btn${tab === t ? " primary" : ""}`} onClick={() => setTab(t)}>
            {t === "write" ? "Write" : "Preview"}
          </button>
        ))}
        <span role="status" aria-live="polite" className={status === "error" ? "error" : "muted"} style={{ marginLeft: "auto" }}>{label}</span>
      </div>
      {tab === "write" ? (
        <>
          <label className="sr-only" htmlFor={`notes-${topicId}`}>Your notes (Markdown)</label>
          <textarea id={`notes-${topicId}`} value={body} rows={10} maxLength={100000}
            onChange={(e) => onChange(e.target.value)} onBlur={() => { if (timer.current) clearTimeout(timer.current); save(body); }}
            placeholder={"Your notes, trade-offs, interview answers…\n\nMarkdown works: # heading, - bullet, **bold**, `code`, [link](https://…)"} />
        </>
      ) : body.trim() ? (
        <div className="note-preview"><Markdown>{body}</Markdown></div>
      ) : (
        <p className="muted">No notes yet. Switch to Write to add some.</p>
      )}
    </div>
  );
}
