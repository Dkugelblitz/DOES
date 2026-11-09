"use client";
import { useActionState } from "react";
import Link from "next/link";
import { requestLevel, type Result } from "@/app/account/actions";

type LevelOption = { level: number; name: string; icon: string; description: string };

/** Shown to people who aren't invited yet: ask for access (goes to the admin Requests queue). */
export function WaitingRoom({ levels, pending }: { levels: LevelOption[]; pending: number[] }) {
  const [state, action, isPending] = useActionState<Result, FormData>(requestLevel, {});
  const name = (n: number) => levels.find((l) => l.level === n)?.name ?? `Level ${n}`;
  if (pending.length || state.ok) {
    return (
      <div className="stack">
        <p style={{ margin: 0 }}><strong>Request sent ✅</strong>{pending.length ? ` (${pending.map(name).join(", ")})` : ""}</p>
        <p className="muted" style={{ margin: 0 }}>You&apos;ll get in as soon as an admin approves it. Check back later; there&apos;s nothing else you need to do.</p>
        <div><Link className="btn" href="/onboarding">Check again</Link></div>
      </div>
    );
  }
  return (
    <form action={action} className="stack">
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 8 }}>Which prep level do you need?</legend>
        {levels.map((l) => (
          <label key={l.level} className="choice">
            <span className="row"><input type="radio" name="level" value={l.level} required /><span style={{ fontWeight: 600 }}>{l.icon} {l.name}</span></span>
            <span className="muted">{l.description}</span>
          </label>
        ))}
      </fieldset>
      <label>A short note for the admin (optional)
        <textarea name="note" rows={2} maxLength={500} placeholder="e.g. who you are, or who invited you" />
      </label>
      <div role="status" aria-live="polite">{state.error && <p className="error">{state.error}</p>}</div>
      <button className="btn primary" type="submit" disabled={isPending}>{isPending ? "Sending…" : "Ask for access"}</button>
    </form>
  );
}
