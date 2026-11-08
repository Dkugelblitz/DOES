"use client";
import { useActionState, useEffect, useState } from "react";
import { completeOnboarding, type OnboardingState } from "./actions";

type LevelOption = { level: number; name: string; icon: string; description: string };

export function OnboardingForm({ levels, defaultName }: { levels: LevelOption[]; defaultName: string }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(completeOnboarding, {});
  const [timezone, setTimezone] = useState("UTC");
  useEffect(() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), []);

  return (
    <form action={action} className="stack">
      <label>
        What should we call you?
        <input name="display_name" defaultValue={defaultName} maxLength={80} autoComplete="given-name" />
      </label>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 8 }}>Choose your prep level</legend>
        {levels.map((l) => (
          <label key={l.level} className="choice">
            <span className="row">
              <input type="radio" name="level" value={l.level} required />
              <span style={{ fontWeight: 600 }}>{l.icon} {l.name}</span>
            </span>
            <span className="muted">{l.description}</span>
          </label>
        ))}
      </fieldset>
      <input type="hidden" name="timezone" value={timezone} />
      <p className="muted">
        You can request another level later from inside the app. An admin approves level changes.
        Your timezone ({timezone}) is used for streaks and reminders.
      </p>
      <div role="status" aria-live="polite">{state.error && <p className="error">{state.error}</p>}</div>
      <button className="btn primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Start preparing"}</button>
    </form>
  );
}
