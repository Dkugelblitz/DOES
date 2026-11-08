"use client";
import { useActionState } from "react";
import { updateStudySettings, type SettingsState } from "@/app/progress-actions";

export function StudySettings({ hoursPerTopic, hoursPerDay, interviewDate }: { hoursPerTopic: number; hoursPerDay: number; interviewDate: string | null }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateStudySettings, {});
  return (
    <form action={action} className="settings">
      <label>Hours per topic
        <input name="hours_per_topic" type="number" min={0.5} max={40} step={0.5} defaultValue={hoursPerTopic} required />
      </label>
      <label>Study hours per day
        <input name="hours_per_day" type="number" min={0.5} max={24} step={0.5} defaultValue={hoursPerDay} required />
      </label>
      <label>Interview date
        <input name="interview_date" type="date" defaultValue={interviewDate ?? ""} />
      </label>
      <div className="row">
        <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Update plan"}</button>
        <span role="status" aria-live="polite">
          {state.error && <span className="error">{state.error}</span>}
          {state.saved && !pending && <span className="ok">Saved</span>}
        </span>
      </div>
    </form>
  );
}
