"use client";
import { useActionState, useRef } from "react";
import { bulkGrant, type ActionResult } from "../actions";

type Level = { level: number; name: string };

/** Wraps the users table so its checkboxes (name="ids") are submitted with the bulk controls. */
export function BulkGrantForm({ levels, children }: { levels: Level[]; children: React.ReactNode }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(bulkGrant, {});
  const form = useRef<HTMLFormElement>(null);
  const toggleAll = (on: boolean) => form.current?.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((c) => { c.checked = on; });

  return (
    <form ref={form} action={action}>
      <fieldset className="card bulk">
        <legend>Bulk: grant a level to the ticked users</legend>
        <div className="row">
          <label className="row inline-label">Level
            <select name="level" defaultValue="" required style={{ width: "auto" }}>
              <option value="" disabled>Choose…</option>
              {levels.map((l) => <option key={l.level} value={l.level}>{l.name}</option>)}
            </select>
          </label>
          <label className="row inline-label">Expires (optional)
            <input type="date" name="expires_on" style={{ width: "auto" }} />
          </label>
          <button className="btn primary" type="submit" disabled={pending}>{pending ? "Granting…" : "Grant to ticked"}</button>
          <button className="btn" type="button" onClick={() => toggleAll(true)}>Tick all on page</button>
          <button className="btn" type="button" onClick={() => toggleAll(false)}>Clear</button>
          <span role="status" aria-live="polite">
            {state.ok && !pending && <span className="ok">{state.ok}</span>}
            {state.error && !pending && <span className="error">{state.error}</span>}
          </span>
        </div>
      </fieldset>
      {children}
    </form>
  );
}
