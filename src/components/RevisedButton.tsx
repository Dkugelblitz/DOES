"use client";
import { useState, useTransition } from "react";
import { markRevised } from "@/app/revision/actions";
import { toast } from "@/components/Toaster";

export function RevisedButton({ topicId, topicName }: { topicId: string; topicName: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (done) return <span className="ok" role="status">Revised ✓ Nicely done.</span>;
  return (
    <span className="row" style={{ gap: 6 }}>
      <button type="button" className="btn" disabled={pending} aria-label={`Mark ${topicName} as revised`}
        onClick={() => start(async () => { const r = await markRevised(topicId); if (r.ok) { setDone(true); toast(r.celebrate); } else setError(r.error ?? "Couldn't save."); })}>
        {pending ? "Saving…" : "Revised ✓"}
      </button>
      {error && <span className="error" role="status">{error}</span>}
    </span>
  );
}
