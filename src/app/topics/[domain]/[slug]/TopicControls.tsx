"use client";
import { useState, useTransition } from "react";
import { setSubtopicDone, setTopicStatus, type StatusResult } from "@/app/progress-actions";

type Sub = { id: string; name: string; done: boolean };

export function TopicControls({ topicId, status: initialStatus, subtopics: initialSubs }: { topicId: string; status: number; subtopics: Sub[] }) {
  const [status, setStatus] = useState(initialStatus);
  const [subs, setSubs] = useState(initialSubs);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const apply = (r: StatusResult) => {
    if ("error" in r) { setError(r.error); return false; }
    setError(null); setStatus(r.status); return true;
  };

  return (
    <div className="stack">
      <label>
        Status
        <select value={status} disabled={pending} onChange={(e) => {
          const next = Number(e.target.value), prev = status;
          setStatus(next);
          start(async () => { if (!apply(await setTopicStatus(topicId, next))) setStatus(prev); });
        }} style={{ maxWidth: 240 }}>
          <option value={0}>Not started</option>
          <option value={1}>In progress</option>
          <option value={2}>Done</option>
        </select>
      </label>

      {subs.length > 0 && (
        <fieldset className="subs">
          <legend>Subtopics <span className="muted">({subs.filter((s) => s.done).length}/{subs.length})</span></legend>
          <p className="muted" style={{ margin: "0 0 6px" }}>Ticking subtopics updates the status for you.</p>
          {subs.map((s) => (
            <label key={s.id} className="sub">
              <input type="checkbox" checked={s.done} onChange={(e) => {
                const done = e.target.checked;
                setSubs((xs) => xs.map((x) => (x.id === s.id ? { ...x, done } : x)));
                start(async () => {
                  if (!apply(await setSubtopicDone(s.id, done))) setSubs((xs) => xs.map((x) => (x.id === s.id ? { ...x, done: !done } : x)));
                });
              }} />
              <span>{s.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div role="status" aria-live="polite">{error && <p className="error">{error}</p>}</div>
    </div>
  );
}
