"use client";
import { useActionState, useEffect, useState } from "react";
import { completeOnboarding, type OnboardingState } from "./actions";

type LevelOption = { level: number; name: string; icon: string; description: string };

export function OnboardingForm({ levels, defaultName, given = [] }: { levels: LevelOption[]; defaultName: string; given?: number[] }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(completeOnboarding, {});
  const [timezone, setTimezone] = useState("UTC");
  useEffect(() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), []);

  return (
    <form action={action} className="stack">
      <label>
        What should we call you?
        <input name="display_name" defaultValue={defaultName} maxLength={80} autoComplete="given-name" />
      </label>
      {given.length ? (
        <div className="stack">
          <p style={{ margin: 0, fontWeight: 600 }}>Your prep {given.length > 1 ? "levels are" : "level is"} ready</p>
          {levels.filter((l) => given.includes(l.level)).map((l) => (
            <div key={l.level} className="choice" style={{ cursor: "default" }}>
              <span style={{ fontWeight: 600 }}>{l.icon} {l.name}</span>
              <span className="muted">{l.description}</span>
            </div>
          ))}
          <input type="hidden" name="level" value={given[0]} />
        </div>
      ) : (
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
      )}
      <input type="hidden" name="timezone" value={timezone} />
      <p className="muted">
        {given.length ? "An admin set this up for you." : "You can request another level later from your Account page. An admin approves level changes."}
        Your timezone ({timezone}) is used for streaks and reminders.
      </p>
      <div role="status" aria-live="polite">{state.error && <p className="error">{state.error}</p>}</div>
      <button className="btn primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Start preparing"}</button>
    </form>
  );
}
